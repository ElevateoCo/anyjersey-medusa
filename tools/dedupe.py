#!/usr/bin/env python3
"""Merge duplicate-title products in tools/out/.

The source catalog carries 328 exact duplicate titles across 764 products — the same
shirt listed several times, usually at the same price but with *different* photographs.
Left alone they split reviews, compete with each other on facets, and inflate the catalog
by a fifth.

This merges rather than deletes: one survivor per title keeps its taxonomy and copy, and
the other listings' images and sizes are folded into it. Three listings with two photos
each become one product with up to six — which is the cheapest available improvement on
the one-image decision (research.md §13.6), since it needs no photography.

Non-destructive to the source: re-running tools/extract.py --write regenerates the
un-merged CSVs.

    python3 tools/dedupe.py            # report only
    python3 tools/dedupe.py --write    # rewrite the CSVs in place
"""
import argparse, csv, collections
from pathlib import Path

OUT = Path('tools/out')
SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL', '7XL', '8XL',
              '9XL', '10XL', 'YS', 'YM', 'YL', 'YXL', 'Y2XL', 'ONE']


def read(name):
    with open(OUT / f'{name}.csv') as f:
        return list(csv.DictReader(f))


def write(name, rows):
    if not rows:
        return
    with open(OUT / f'{name}.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    args = ap.parse_args()

    products = read('products')
    variants = read('variants')
    pmedia = read('product_media')
    media = {m['id']: m for m in read('media')}
    colprods = read('collection_products')

    by_pid_variants = collections.defaultdict(list)
    for v in variants:
        by_pid_variants[v['product_id']].append(v)
    by_pid_media = collections.defaultdict(list)
    for r in pmedia:
        by_pid_media[r['product_id']].append(r)

    groups = collections.defaultdict(list)
    for p in products:
        groups[p['name'].strip().lower()].append(p)

    dupe_groups = {k: v for k, v in groups.items() if len(v) > 1}

    def score(p):
        """Survivor: most images, then most sizes, then most complete taxonomy."""
        return (
            len(by_pid_media.get(p['id'], [])),
            len(by_pid_variants.get(p['id'], [])),
            sum(1 for f in ('team', 'player', 'colourway', 'season', 'edition') if p[f]),
            len(p['description'] or ''),
        )

    survivors, dropped = {}, {}
    for title, items in dupe_groups.items():
        best = max(items, key=score)
        survivors[best['id']] = best
        for other in items:
            if other['id'] != best['id']:
                dropped[other['id']] = best['id']

    # ---- fold images in, deduped by sha256, ordered survivor-first ----
    new_pmedia, imgs_gained = [], 0
    media_by_pid = collections.defaultdict(list)
    for r in pmedia:
        media_by_pid[r['product_id']].append(r)

    for p in products:
        if p['id'] in dropped:
            continue
        seen_sha, rows = set(), []
        for r in sorted(media_by_pid.get(p['id'], []), key=lambda x: int(x['position'])):
            sha = media[r['media_id']]['sha256']
            if sha not in seen_sha:
                seen_sha.add(sha)
                rows.append(r)
        before = len(rows)
        for other_id, keep_id in dropped.items():
            if keep_id != p['id']:
                continue
            for r in sorted(media_by_pid.get(other_id, []), key=lambda x: int(x['position'])):
                sha = media[r['media_id']]['sha256']
                if sha not in seen_sha:
                    seen_sha.add(sha)
                    rows.append({**r, 'product_id': p['id']})
        imgs_gained += len(rows) - before
        for i, r in enumerate(rows, 1):
            new_pmedia.append({**r, 'product_id': p['id'], 'position': i})

    # ---- fold sizes in, keeping the survivor's SKU where a size already exists ----
    new_variants, sizes_gained = [], 0
    for p in products:
        if p['id'] in dropped:
            continue
        have, rows = set(), []
        for v in by_pid_variants.get(p['id'], []):
            have.add((v['size_code'], v['fit']))
            rows.append(v)
        before = len(rows)
        for other_id, keep_id in dropped.items():
            if keep_id != p['id']:
                continue
            for v in by_pid_variants.get(other_id, []):
                key = (v['size_code'], v['fit'])
                if key not in have:
                    have.add(key)
                    rows.append({**v, 'product_id': p['id']})
        sizes_gained += len(rows) - before
        rows.sort(key=lambda v: (SIZE_ORDER.index(v['size_code'])
                                 if v['size_code'] in SIZE_ORDER else 99, v['fit']))
        for i, v in enumerate(rows, 1):
            new_variants.append({**v, 'product_id': p['id'], 'position': i})

    # ---- collection membership follows the survivor ----
    seen_cp = set()
    new_colprods = []
    for r in colprods:
        pid = dropped.get(r['product_id'], r['product_id'])
        key = (r['collection_id'], pid)
        if key in seen_cp:
            continue
        seen_cp.add(key)
        new_colprods.append({**r, 'product_id': pid})

    kept = [p for p in products if p['id'] not in dropped]

    # provenance: record what was folded into what
    merge_log = [
        {'survivor_id': keep, 'survivor_slug': next(p['slug'] for p in kept if p['id'] == keep),
         'merged_id': other,
         'merged_source_handle': next(p['source_handle'] for p in products if p['id'] == other)}
        for other, keep in sorted(dropped.items(), key=lambda kv: kv[1])
    ]

    img_counts_before = collections.Counter(len(v) for v in media_by_pid.values())
    after = collections.defaultdict(int)
    for r in new_pmedia:
        after[r['product_id']] += 1
    img_counts_after = collections.Counter(after.values())

    print(f'\n{"="*66}\n  DEDUPE — {"WRITE" if args.write else "REPORT ONLY, nothing written"}\n{"="*66}')
    print(f'  duplicate-title groups   {len(dupe_groups)}')
    print(f'  products before          {len(products)}')
    print(f'  products removed         {len(dropped)}')
    print(f'  products after           {len(kept)}')
    print(f'  variants  {len(variants)} -> {len(new_variants)}   (+{sizes_gained} sizes folded in)')
    print(f'  images    {len(pmedia)} -> {len(new_pmedia)}   (+{imgs_gained} folded onto survivors)')
    print()
    print('  images per product:')
    buckets = [(1, 1), (2, 2), (3, 5), (6, 10), (11, 999)]
    for lo, hi in buckets:
        b = sum(c for n, c in img_counts_before.items() if lo <= n <= hi)
        a = sum(c for n, c in img_counts_after.items() if lo <= n <= hi)
        label = f'{lo}' if lo == hi else (f'{lo}-{hi}' if hi < 999 else f'{lo}+')
        arrow = '' if b == a else ('  ' + ('+' if a > b else '') + str(a - b))
        print(f'    {label:>6} image(s)  {b:>5} -> {a:>5}{arrow}')
    three_b = sum(c for n, c in img_counts_before.items() if n >= 3)
    three_a = sum(c for n, c in img_counts_after.items() if n >= 3)
    print(f'    3 or more     {three_b:>5} -> {three_a:>5}')
    print(f'    max on one product: {max(img_counts_before, default=0)} -> '
          f'{max(img_counts_after, default=0)}')
    one_b = img_counts_before.get(1, 0) / max(len(products), 1)
    one_a = img_counts_after.get(1, 0) / max(len(kept), 1)
    print(f'    single-image share: {100*one_b:.0f}% -> {100*one_a:.0f}%')

    if not args.write:
        print(f'\n  Nothing written. Re-run with --write to apply.\n')
        return

    write('products', kept)
    write('variants', new_variants)
    write('product_media', new_pmedia)
    write('collection_products', new_colprods)
    write('merge_log', merge_log)
    print(f'\n  wrote products.csv ({len(kept)}), variants.csv ({len(new_variants)}),')
    print(f'        product_media.csv ({len(new_pmedia)}), collection_products.csv '
          f'({len(new_colprods)}), merge_log.csv ({len(merge_log)})')
    print('  media.csv unchanged — it is the global deduped image table.\n')


if __name__ == '__main__':
    main()
