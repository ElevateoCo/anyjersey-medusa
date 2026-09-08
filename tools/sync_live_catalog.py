#!/usr/bin/env python3
"""Bring the catalog up to date with the live store.

    python3 tools/sync_live_catalog.py --fetch          # pull products.json (18 requests)
    python3 tools/sync_live_catalog.py                  # diff only, writes nothing
    python3 tools/sync_live_catalog.py --write          # emit the import payload

The 2026-08-18 archive that seeded this catalog is a point-in-time snapshot, and the shop
has kept trading. This closes the gap by reading the live store's public `products.json`,
diffing it against what is already imported, and emitting the *missing* rows in the same
shape `spike/backend/src/scripts/import-catalog.ts` already consumes.

**The diff is on `source_handle`, not on `handle`, and that is the whole trick.** Local
handles are Medusa-generated slugs and the duplicate merge in Step 10 changed a thousand of
them, so a naive handle comparison reported 2,152 missing products when the real number was
1,104 — it would have imported 1,048 duplicates of shirts already in the catalog.

Parsing reuses `extract.parse_title` and `extract.norm_size` rather than reimplementing
them. That is not laziness: those functions and the vocabularies behind them are what
classified the existing 3,155 products, they are covered by the tests in `tools/tests`, and
a second parser would drift from the first the first time a team name changed.

Images stay as absolute CDN URLs in the payload. The importer passes those through and
`ingest-remote-media.ts` pulls them into Postgres afterwards, so a slow or failed download
cannot block the catalog write.
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract import norm_size, parse_title, title_case, make_sku, norm  # noqa: E402
import describe  # noqa: E402

LIVE = 'https://cruxchristi.com'
SNAPSHOT = Path('tools/out/live-products.json')
DEST = Path('spike/backend/src/scripts/catalog-sync.json')

SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL', '7XL',
              '8XL', '9XL', '10XL', 'YS', 'YM', 'YL', 'YXL', 'Y2XL', 'ONE']
FIT_LABEL = {'unisex': 'Unisex', 'mens': "Men's", 'womens': "Women's", 'youth': 'Youth'}


def fetch_all() -> list:
    """Every published product, 250 at a time. Polite: one request every 400ms."""
    out, page = [], 1
    while True:
        url = f'{LIVE}/products.json?limit=250&page={page}'
        req = urllib.request.Request(url, headers={'User-Agent': 'anyjersey-catalog-sync/1.0'})
        with urllib.request.urlopen(req, timeout=45) as r:
            batch = json.load(r).get('products', [])
        if not batch:
            break
        out.extend(batch)
        print(f'  page {page}: {len(batch)} (total {len(out)})', flush=True)
        page += 1
        if page > 40:                       # a guard, not a limit anyone should hit
            print('  stopping at 40 pages — is the store paginating forever?')
            break
        time.sleep(0.4)
    return out


def _psql(sql: str) -> set:
    """Read a single column out of the catalog.

    Straight through psql rather than the API, because this runs before the backend is
    necessarily up and because `source_handle` is not exposed on any store endpoint.
    """
    import subprocess
    r = subprocess.run(
        ['docker', 'exec', 'aj-postgres', 'psql', '-U', 'aj', '-d', 'aj_store', '-t', '-A',
         '-c', sql],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise SystemExit(f'could not read the catalog: {r.stderr.strip()[:200]}')
    return {l.strip() for l in r.stdout.splitlines() if l.strip()}


def known_handles(stage: str) -> set:
    """What counts as "already done", which depends on which half of the import is next.

    An import is two writes: the product, then its `jersey_detail` and the link between
    them. They can be interrupted between the two — and were, on the custom-jersey import —
    so "already imported" has to mean different things at the two stages, or the second
    stage finds nothing to do and the details are silently never written.

    `products` — the handle exists at all. This is the diff for `import-catalog.ts`.
    `details`  — the handle exists *and* has a jersey_detail linked to it. This is the diff
                 for `populate-catalog-details.ts`, and it is deliberately the smaller set.
    """
    if stage == 'details':
        return _psql(
            "select p.handle from product p "
            "join product_product_catalog_jersey_detail l "
            "  on l.product_id = p.id and l.deleted_at is null "
            "where p.deleted_at is null "
            "union select d.source_handle from jersey_detail d "
            "  join product_product_catalog_jersey_detail l2 "
            "    on l2.jersey_detail_id = d.id and l2.deleted_at is null "
            "  where d.source_handle is not null"
        )
    return _psql(
        "select handle from product where deleted_at is null "
        "union select source_handle from jersey_detail where source_handle is not null"
    )


def size_option_values(product: dict) -> list:
    """The size option, whatever the source called it.

    The live store spells it SIZE, Size, size and Sizes across products — the same option
    under four names. Matching case-insensitively is what stops one shirt importing with an
    option Medusa treats as unrelated to every other shirt's.
    """
    for o in product.get('options') or []:
        if norm(o.get('name', '')).strip().lower().rstrip('s') in ('size', 'size'):
            return o.get('values') or []
    return []


def build_row(p: dict) -> tuple:
    """-> (row, issue). One of them is always None."""
    title = title_case(norm(p.get('title') or ''))
    if not title:
        return None, 'no title'

    values = size_option_values(p)
    if not values:
        return None, 'no size option'

    tax = parse_title(p.get('title') or '')

    # Variants, deduplicated by (size, fit) and ordered the way a human reads sizes. The
    # source frequently carries the same size twice under different spellings.
    seen, variants, fits = set(), [], set()
    for v in p.get('variants') or []:
        raw = v.get('option1') or v.get('title') or ''
        code, label, group, fit, recognised = norm_size(raw)
        if not recognised and code == 'UNKNOWN':
            continue
        key = (code, fit)
        if key in seen:
            continue
        seen.add(key)
        fits.add(fit)
        try:
            price = float(v.get('price') or 0)
        except (TypeError, ValueError):
            price = 0.0
        if price <= 0:
            continue
        variants.append({'code': code, 'label': label, 'fit': fit, 'price': price,
                         'source_id': str(v.get('id') or '')})

    if not variants:
        return None, 'no priced variants'

    variants.sort(key=lambda x: (SIZE_ORDER.index(x['code']) if x['code'] in SIZE_ORDER else 99,
                                 x['fit']))

    # Fit becomes an option only where the product actually offers more than one; otherwise
    # it is a single-value dropdown that says nothing.
    multi_fit = len(fits) > 1

    # **Each size listed once**, even where two fits offer it. An option's values are the
    # distinct choices, not one entry per variant — Medusa rejects the product outright with
    # "Product option value ... value: S, already exists", which is how 24 of these failed on
    # the first run. Order is preserved rather than sorted again: `variants` is already in
    # human size order and `dict.fromkeys` keeps first-seen order.
    size_values = list(dict.fromkeys(v['code'] for v in variants))
    options = [{'title': 'Size', 'values': size_values}]
    if multi_fit:
        options.append({'title': 'Fit', 'values': sorted({FIT_LABEL[v['fit']] for v in variants})})

    pid = str(p.get('id') or p.get('handle'))
    out_variants = []
    for v in variants:
        opts = {'Size': v['code']}
        if multi_fit:
            opts['Fit'] = FIT_LABEL[v['fit']]
        out_variants.append({
            'title': v['label'] if multi_fit else v['code'],
            'sku': make_sku(pid, v['code'] if not multi_fit else f"{v['code']}-{v['fit']}"),
            'options': opts,
            'price': v['price'],
        })

    # Description and SEO come from the same generator that wrote the existing catalog's, so
    # a synced product reads identically to one that arrived in the archive.
    dp = {
        'id': pid, 'sport': tax.get('sport'), 'garment': tax.get('garment') or 'jersey',
        'colourway': tax.get('colourway'), 'player': tax.get('player'),
        'team': tax.get('team'), 'season': tax.get('season'), 'edition': tax.get('edition'),
    }
    dvs = [{'size_code': v['code'], 'fit': v['fit']} for v in variants]
    try:
        description = describe.build(dp, dvs)
        seo_title, seo_description = describe.seo(dp, description)
    except Exception:
        description, seo_title, seo_description = '', None, None

    images = [i['src'] for i in (p.get('images') or []) if i.get('src')]

    # A blank shirt sold to be printed, not a player's shirt. Both signals must agree: the
    # title says CUSTOM and the price is the custom price. Either alone lets a mis-collected
    # player jersey through — three of them are in the source's own custom collection.
    is_custom = ('custom' in (p.get('title') or '').lower()
                 and any(abs(v['price'] - 89.99) < 0.005 for v in variants))

    needs_review = not tax.get('team') or not tax.get('garment')

    return {
        'handle': p['handle'],
        'title': title,
        'description': description or None,
        'status': 'published',
        'price': variants[0]['price'],
        'options': options,
        'variants': out_variants,
        'images': images,
        'taxonomy': {
            'sport': tax.get('sport'), 'league': tax.get('league'), 'team': tax.get('team'),
            'player': tax.get('player'), 'colourway': tax.get('colourway'),
            'season': tax.get('season'), 'edition': tax.get('edition'),
            'garment': tax.get('garment') or 'jersey',
        },
        'is_custom': is_custom,
        'seo': {'title': seo_title, 'description': seo_description},
        'needs_review': needs_review,
        'source_handle': p['handle'],
    }, None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--fetch', action='store_true', help='refresh the snapshot from the live store')
    ap.add_argument('--write', action='store_true', help='emit the import payload')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--stage', choices=['products', 'details'], default='products',
                    help='products: rows not imported at all. '
                         'details: rows imported but with no jersey_detail linked yet.')
    args = ap.parse_args()

    SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    if args.fetch or not SNAPSHOT.exists():
        print(f'fetching {LIVE}/products.json …')
        live = fetch_all()
        SNAPSHOT.write_text(json.dumps(live))
        print(f'  snapshot written to {SNAPSHOT} ({len(live)} products)')
    else:
        live = json.loads(SNAPSHOT.read_text())
        print(f'reading snapshot {SNAPSHOT} ({len(live)} products)')

    known = known_handles(args.stage)
    missing = [p for p in live if p.get('handle') and p['handle'] not in known]
    stale = known - {p['handle'] for p in live}

    rows, issues = [], []
    for p in missing:
        row, issue = build_row(p)
        if row:
            rows.append(row)
        else:
            issues.append((p.get('handle'), issue))

    if args.limit:
        rows = rows[:args.limit]

    counts = defaultdict(int)
    for r in rows:
        counts[r['taxonomy']['league'] or 'unclassified'] += 1

    print()
    print(f'  stage                {args.stage}')
    print(f'  live products        {len(live)}')
    print(f'  already done         {len(known)}')
    print(f'  missing              {len(missing)}')
    print(f'  importable           {len(rows)}')
    print(f'  skipped              {len(issues)}')
    print(f'  needs_review         {sum(1 for r in rows if r["needs_review"])}')
    print(f'  custom jerseys       {sum(1 for r in rows if r["is_custom"])}')
    print(f'  images               {sum(len(r["images"]) for r in rows)}')
    print()
    print('  by league: ' + ', '.join(f'{k} {v}' for k, v in
                                      sorted(counts.items(), key=lambda x: -x[1])[:9]))
    print()
    print(f'  in our catalog but not on the live store: {len(stale)}')
    print('    Not deleted here. The shop sources to order, so a delisted product is not')
    print('    necessarily an unsellable one — that is a merchandising decision, not a sync.')

    if issues:
        print()
        print(f'  skipped {len(issues)}:')
        for h, why in issues[:8]:
            print(f'    {h}: {why}')
        if len(issues) > 8:
            print(f'    … and {len(issues) - 8} more')

    if not args.write:
        print()
        print('  Diff only. Re-run with --write to emit the import payload.')
        return 0

    DEST.write_text(json.dumps(rows, indent=1))
    print()
    print(f'  wrote {len(rows)} rows to {DEST}')
    if args.stage == 'products':
        print('  next: npx medusa exec ./src/scripts/import-catalog.ts 0 50 catalog-sync.json')
        print('  then: --stage details, and populate-catalog-details.ts catalog-sync.json')
    else:
        print('  next: npx medusa exec ./src/scripts/populate-catalog-details.ts catalog-sync.json')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
