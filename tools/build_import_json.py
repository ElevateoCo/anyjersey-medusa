#!/usr/bin/env python3
"""Turn tools/out/*.csv into a single import payload for Medusa.

Kept separate from the TS importer so the importer needs no CSV dependency, and so the
shape of what gets loaded is inspectable before anything touches the database.

Images are referenced by their local blob filename. The importer serves them from
backend/static/media, which is a symlink to the archive — no 3 GB copy.

    python3 tools/build_import_json.py            # writes spike/backend/src/scripts/catalog.json
"""
import csv, json, os, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vocab import fold  # noqa: E402

OUT = Path('tools/out')
ARCHIVE = Path('/Users/emil/Downloads/Anyjersey backup/Backup/backups/2026-08-18-FULL-anyjersey/media')
DEST = Path('spike/backend/src/scripts/catalog.json')

# sha256 -> blob filename, from the archive's own checksum file
sha_to_file = {}
for line in (ARCHIVE / 'checksums.sha256').read_text().splitlines():
    if '  ' in line:
        digest, rel = line.split('  ', 1)
        sha_to_file[digest.strip()] = os.path.basename(rel.strip())

products = list(csv.DictReader(open(OUT / 'products.csv')))
variants = defaultdict(list)
for v in csv.DictReader(open(OUT / 'variants.csv')):
    variants[v['product_id']].append(v)
media = {m['id']: m for m in csv.DictReader(open(OUT / 'media.csv'))}
pmedia = defaultdict(list)
for r in csv.DictReader(open(OUT / 'product_media.csv')):
    pmedia[r['product_id']].append(r)

SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL', '7XL',
              '8XL', '9XL', '10XL', 'YS', 'YM', 'YL', 'YXL', 'Y2XL', 'ONE']
FIT_LABEL = {'unisex': 'Unisex', 'mens': "Men's", 'womens': "Women's", 'youth': 'Youth'}

out, skipped = [], []
for p in products:
    vs = variants.get(p['id']) or []
    if not vs:
        skipped.append((p['slug'], 'no variants'))
        continue

    # Medusa needs one option per varying dimension. Fit only becomes an option when the
    # product actually offers more than one — otherwise it is noise in the UI.
    fits = sorted({v['fit'] for v in vs})
    multi_fit = len(fits) > 1

    seen, vout = set(), []
    for v in sorted(vs, key=lambda x: (SIZE_ORDER.index(x['size_code'])
                                       if x['size_code'] in SIZE_ORDER else 99,
                                       x['fit'])):
        key = (v['size_code'], v['fit']) if multi_fit else (v['size_code'],)
        if key in seen:
            continue
        seen.add(key)
        opts = {'Size': v['size_code']}
        if multi_fit:
            opts['Fit'] = FIT_LABEL.get(v['fit'], v['fit'])
        vout.append({
            'title': v['size_code'] + (f" / {FIT_LABEL.get(v['fit'], v['fit'])}" if multi_fit else ''),
            'sku': v['sku'],
            'options': opts,
            'price': int(v['price_cents']) / 100 if v['price_cents'] else int(p['price_cents']) / 100,
        })

    imgs = []
    for r in sorted(pmedia.get(p['id']) or [], key=lambda x: int(x['position'])):
        m = media.get(r['media_id'])
        fn = sha_to_file.get(m['sha256']) if m else None
        if fn:
            imgs.append(fn)

    sizes = []
    for v in vout:
        if v['options']['Size'] not in sizes:
            sizes.append(v['options']['Size'])
    options = [{'title': 'Size', 'values': sizes}]
    if multi_fit:
        options.append({'title': 'Fit', 'values': [FIT_LABEL.get(f, f) for f in fits]})

    out.append({
        'handle': p['slug'],
        # The stable identity. Slugs are derived from parsed fields, so a parser
        # improvement changes them — which is free on a greenfield store but means
        # re-syncs must key on something that does not move.
        'source_handle': p['source_handle'],
        'title': p['name'],
        'description': p['description'] or None,
        'status': 'published' if p['status'] == 'active' else 'draft',
        'price': int(p['price_cents']) / 100,
        'options': options,
        'variants': vout,
        'images': imgs,
        # the derived taxonomy — becomes the catalog module in step 2
        'taxonomy': {k: (p[k] or None) for k in
                     ('sport', 'league', 'team', 'player', 'colourway', 'season', 'edition', 'garment')},
        'search_text': fold(p['team'], p['player'], p['colourway'], p['season'],
                            p['league'], p['garment']),
        'seo': {'title': p['seo_title'] or None, 'description': p['seo_description'] or None},
        'needs_review': p['needs_review'] == 'true',
    })

DEST.parent.mkdir(parents=True, exist_ok=True)
DEST.write_text(json.dumps(out))
print(f'products      {len(out)}')
print(f'variants      {sum(len(p["variants"]) for p in out)}')
print(f'images        {sum(len(p["images"]) for p in out)}')
print(f'multi-fit     {sum(1 for p in out if len(p["options"]) > 1)}')
print(f'no images     {sum(1 for p in out if not p["images"])}')
print(f'skipped       {len(skipped)}')
print(f'wrote         {DEST}  ({DEST.stat().st_size/1e6:.1f} MB)')
