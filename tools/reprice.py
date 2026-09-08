#!/usr/bin/env python3
"""Set one flat price across the jersey catalog.

    python3 tools/reprice.py            # dry run, prints what would change
    python3 tools/reprice.py --apply    # rewrites the source JSON in place

Scope is the *jersey catalog* only. Two things are deliberately left alone:

  * **Custom blanks stay at $89.99.** A blank ships with the name and number included in
    the price, so pricing it the same as a plain shirt would make the $19.99
    personalisation bundle unsellable — the add-on and the blank are two different
    commercial shapes and both are meant to exist (personalisation-spec.md §1).
  * **Personalisation add-ons and shipping rates are untouched.** They are not catalog
    prices; the zone rate card is in `shipping-zones.ts` and is the single source of truth
    for both the storefront and checkout.

The blank test is a copy of the gate in `import-custom-jerseys.ts`: the title says CUSTOM
*and* the price is 89.99. Both signals are required there and both are required here, so
the two cannot drift apart. It matters more than it looks: 45 blanks live inside the main
catalog files with ordinary-looking handles (`philadelphia-phillies-red-jersey`) because
the blanks snapshot only covers the NFL collection. Matching on the handle would miss
every one of them and silently reprice the whole MLB blank line.
"""
import json
import re
import sys
from pathlib import Path

PRICE = 65.99
ROOT = Path(__file__).resolve().parent.parent
CATALOGS = [
    ROOT / 'spike/backend/src/scripts/catalog.json',
    ROOT / 'spike/backend/src/scripts/catalog-sync.json',
]
SPIKE_PRODUCT = ROOT / 'spike/backend/src/scripts/spike-product.json'

CUSTOM_TITLE = re.compile(r'\bCUSTOM\b', re.I)
BLANK_PRICE = 89.99


def is_blank(p: dict) -> bool:
    """Mirrors import-custom-jerseys.ts: title says CUSTOM *and* priced as a blank."""
    return bool(CUSTOM_TITLE.search(p.get('title') or '')) and p.get('price') == BLANK_PRICE


def reprice(path: Path, apply: bool) -> dict:
    products = json.loads(path.read_text())
    stat = {'total': len(products), 'repriced': 0, 'skipped_blank': 0,
            'variants': 0, 'was': {}}

    for p in products:
        if is_blank(p):
            stat['skipped_blank'] += 1
            continue
        old = p.get('price')
        if old != PRICE:
            stat['was'][old] = stat['was'].get(old, 0) + 1
        p['price'] = PRICE
        stat['repriced'] += 1
        for v in p.get('variants', []):
            v['price'] = PRICE
            stat['variants'] += 1

    if apply:
        # Trailing newline and 1-space indent match how these files were written.
        path.write_text(json.dumps(products, indent=1, ensure_ascii=False) + '\n')
    return stat


def main() -> int:
    apply = '--apply' in sys.argv
    print(f'{"APPLYING" if apply else "DRY RUN"} — flat price ${PRICE:.2f}\n')

    grand = {'repriced': 0, 'blanks': 0, 'variants': 0}
    for path in CATALOGS:
        s = reprice(path, apply)
        grand['repriced'] += s['repriced']
        grand['blanks'] += s['skipped_blank']
        grand['variants'] += s['variants']
        print(f'  {path.name}')
        print(f'    products      {s["total"]:>6}')
        print(f'    repriced      {s["repriced"]:>6}  ({s["variants"]} variants)')
        print(f'    left as blank {s["skipped_blank"]:>6}  @ ${BLANK_PRICE}')
        if s['was']:
            spread = ', '.join(f'${k}×{v}' for k, v in
                               sorted(s['was'].items(), key=lambda x: -x[1])[:8])
            print(f'    was           {spread}')
        print()

    # The spike seed jersey is an ordinary catalog product and must agree.
    sp = json.loads(SPIKE_PRODUCT.read_text())
    old_cents = sp.get('price_cents')
    sp['price_cents'] = int(round(PRICE * 100))
    if apply:
        SPIKE_PRODUCT.write_text(json.dumps(sp, indent=1, ensure_ascii=False) + '\n')
    print(f'  spike-product.json  price_cents {old_cents} -> {sp["price_cents"]}\n')

    print(f'  TOTAL  {grand["repriced"]} products / {grand["variants"]} variants '
          f'at ${PRICE:.2f}; {grand["blanks"]} blanks held at ${BLANK_PRICE}')
    if not apply:
        print('\n  nothing written — re-run with --apply')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
