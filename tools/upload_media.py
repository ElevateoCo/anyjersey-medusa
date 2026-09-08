#!/usr/bin/env python3
"""Upload catalog images to Cloudflare R2, content-addressed.

Bytes belong in object storage, not Postgres (research.md §6). Keys are
originals/<sha256>.<ext>, so this is idempotent: re-running uploads nothing, and the
6,631 archived blobs collapse onto the ~4,635 images actually referenced.

Originals are private. Serve derivatives (resized, WebP/AVIF) through an image
transform layer in front of the bucket — never link the original.

    export R2_ACCOUNT_ID=...  R2_ACCESS_KEY_ID=...  R2_SECRET_ACCESS_KEY=...  R2_BUCKET=...

    python3 tools/upload_media.py                 # dry run: verify + plan, uploads nothing
    python3 tools/upload_media.py --verify-only   # checksum the local archive, no network
    python3 tools/upload_media.py --upload        # do it
    python3 tools/upload_media.py --upload --workers 16
"""
from __future__ import annotations
import argparse, csv, hashlib, os, sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BACKUP = Path('/Users/emil/Downloads/Anyjersey backup/Backup/backups/2026-08-18-FULL-anyjersey')
BLOBS = BACKUP / 'media' / 'blobs'
MEDIA_CSV = Path(__file__).parent / 'out' / 'media.csv'

MIME = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
        'webp': 'image/webp', 'gif': 'image/gif', 'avif': 'image/avif'}


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def load_local_index() -> dict[str, Path]:
    """sha256 -> local blob path, from the archive's own checksum file."""
    idx: dict[str, Path] = {}
    cs = BACKUP / 'media' / 'checksums.sha256'
    for line in cs.read_text().splitlines():
        if '  ' not in line:
            continue
        digest, rel = line.split('  ', 1)
        p = BACKUP / 'media' / rel.strip()
        if p.exists():
            idx.setdefault(digest.strip(), p)
    return idx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--upload', action='store_true', help='actually upload (default: dry run)')
    ap.add_argument('--verify-only', action='store_true', help='checksum local files, no network')
    ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--verify-sample', type=int, default=200,
                    help='how many local files to re-checksum in a dry run (0 = all)')
    args = ap.parse_args()

    if not MEDIA_CSV.exists():
        sys.exit(f'missing {MEDIA_CSV} — run: python3 tools/extract.py --write')

    wanted = list(csv.DictReader(open(MEDIA_CSV)))
    local = load_local_index()
    print(f'\n{"="*66}\n  MEDIA UPLOAD — {"LIVE" if args.upload else "DRY RUN"}\n{"="*66}')
    print(f'  images referenced by catalog   {len(wanted):>6}')
    print(f'  blobs in local archive         {len(local):>6}')

    plan, missing, total_bytes = [], [], 0
    for row in wanted:
        p = local.get(row['sha256'])
        if not p:
            missing.append(row)
            continue
        size = p.stat().st_size
        total_bytes += size
        plan.append((row['sha256'], row['storage_key'], p, size,
                     row.get('mime') or MIME.get(row['storage_key'].rsplit('.', 1)[-1], 'application/octet-stream')))

    print(f'  resolved to a local file       {len(plan):>6}')
    print(f'  MISSING locally                {len(missing):>6}')
    print(f'  total bytes                    {total_bytes/1e9:.2f} GB')
    if missing:
        print('\n  first missing:')
        for r in missing[:5]:
            print(f'    {r["sha256"][:16]}…  {r["storage_key"]}')

    # integrity: does the archive's checksum still match the bytes on disk?
    sample = plan if (args.verify_only or args.verify_sample == 0) else plan[:args.verify_sample]
    if sample:
        bad = []
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(sha256_file, p): (sha, p) for sha, _k, p, _s, _m in sample}
            for fut in as_completed(futs):
                sha, p = futs[fut]
                if fut.result() != sha:
                    bad.append(p)
        print(f'\n  integrity check                {len(sample)} files, '
              f'{"OK" if not bad else str(len(bad)) + " MISMATCH"}')
        for p in bad[:5]:
            print(f'    corrupt: {p.name}')
        if bad:
            sys.exit('  aborting: local archive does not match its checksums')

    if args.verify_only:
        print('\n  verify-only: no network calls made.\n')
        return

    if not args.upload:
        print(f'\n  Dry run. Would upload {len(plan)} objects '
              f'({total_bytes/1e9:.2f} GB) to originals/<sha256>.<ext>.')
        print('  Re-run with --upload once R2_* env vars are set.\n')
        return

    need = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
    absent = [k for k in need if not os.environ.get(k)]
    if absent:
        sys.exit(f'  missing env: {", ".join(absent)}')
    try:
        import boto3
        from botocore.config import Config
        from botocore.exceptions import ClientError
    except ImportError:
        sys.exit('  pip install boto3')

    bucket = os.environ['R2_BUCKET']
    s3 = boto3.client(
        's3',
        endpoint_url=f'https://{os.environ["R2_ACCOUNT_ID"]}.r2.cloudflarestorage.com',
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        config=Config(retries={'max_attempts': 5, 'mode': 'standard'}, region_name='auto'),
    )

    counts = {'uploaded': 0, 'skipped': 0, 'failed': 0}

    def put(item):
        sha, key, path, size, mime = item
        try:
            try:
                head = s3.head_object(Bucket=bucket, Key=key)
                if head['ContentLength'] == size:
                    return 'skipped', key, None
            except ClientError as e:
                if e.response['Error']['Code'] not in ('404', 'NoSuchKey', '403'):
                    raise
            with open(path, 'rb') as f:
                s3.put_object(
                    Bucket=bucket, Key=key, Body=f, ContentType=mime,
                    # content-addressed, so the bytes at this key can never change
                    CacheControl='public, max-age=31536000, immutable',
                    Metadata={'sha256': sha},
                )
            return 'uploaded', key, None
        except Exception as e:                                  # noqa: BLE001
            return 'failed', key, str(e)

    print(f'\n  uploading to r2://{bucket}/ with {args.workers} workers…')
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for i, fut in enumerate(as_completed([ex.submit(put, it) for it in plan]), 1):
            status, key, err = fut.result()
            counts[status] += 1
            if err:
                print(f'    FAILED {key}: {err}')
            if i % 250 == 0:
                print(f'    {i}/{len(plan)}  uploaded={counts["uploaded"]} '
                      f'skipped={counts["skipped"]} failed={counts["failed"]}')

    print(f'\n  uploaded {counts["uploaded"]}  skipped {counts["skipped"]}  '
          f'failed {counts["failed"]}')
    if counts['failed']:
        sys.exit(1)
    print('  Originals are private. Put an image transform layer in front for derivatives.\n')


if __name__ == '__main__':
    main()
