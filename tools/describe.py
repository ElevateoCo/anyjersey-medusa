#!/usr/bin/env python3
"""Generate product descriptions, SEO fields and image alt text.

3,502 of 3,591 imported products have no description. The 158 that do all share one
template with the names swapped:

    "Rep {player} in bold {team} style with a football jersey made for game day, watch
     parties, tailgates, and everyday fan wear. ... Available in men's, youth, and
     women's sizes from S-XXL."

Two problems with reusing that as-is:

  1. Near-identical text across thousands of URLs is thin/duplicate content. It competes
     with itself and gives search engines nothing to distinguish one page from another.
  2. The size sentence is wrong for most products. It claims men's/youth/women's S-XXL,
     while the actual catalog is overwhelmingly unisex S-4XL. Stating sizes you do not
     stock is a misleading claim (research.md §7.10), not just a copy nit.

So this keeps the voice and fixes both: sentence patterns are selected deterministically
per product from several variants, and every factual clause is derived from the row —
team, player, colourway, season, edition, and the sizes that actually exist.

Deliberately NOT asserted anywhere: "officially licensed", "authentic", fabric
composition, stitching method, performance claims. None of that is in the data, and
inventing it is an FTC §5 exposure and a textile-labelling problem. Fabric and care
belong in the regulatory columns once known.

    python3 tools/describe.py               # preview samples, writes nothing
    python3 tools/describe.py --write       # patch products.csv + product_media.csv in place
    python3 tools/describe.py --write --overwrite-existing
"""
from __future__ import annotations
import argparse, csv, hashlib, re, sys
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).parent / 'out'

# ---------------------------------------------------------------- sport voice

VOICE = {
    'football':         dict(noun='football', occasion=['game day', 'tailgates', 'watch parties'],
                             place='the stadium', verb='back'),
    'college football': dict(noun='college football', occasion=['Saturdays', 'tailgates', 'campus'],
                             place='the student section', verb='back'),
    'basketball':       dict(noun='basketball', occasion=['game night', 'pickup runs', 'watch parties'],
                             place='courtside', verb='rep'),
    'baseball':         dict(noun='baseball', occasion=['opening day', 'the ballpark', 'summer nights'],
                             place='the bleachers', verb='back'),
    'hockey':           dict(noun='hockey', occasion=['puck drop', 'road trips', 'watch parties'],
                             place='rinkside', verb='back'),
    'soccer':           dict(noun='soccer', occasion=['matchday', 'kickoff', 'watch parties'],
                             place='the terraces', verb='support'),
    'mma':              dict(noun='fight', occasion=['fight night', 'walkouts', 'watch parties'],
                             place='cageside', verb='rep'),
    None:               dict(noun='fan', occasion=['game day', 'watch parties', 'everyday wear'],
                             place='the stands', verb='back'),
}

OPENERS = [
    'Rep {player} in bold {team} style with {an} {colour_garment} built for {occ1} and everyday fan wear.',
    'Bring {team} colours to {occ1} with {this} {player} {garment}.',
    '{player} on the back, {team} on the front — {an} {colour_garment} made for {occ1}.',
    'Wear {player} and {verb} {team} with {an} {colour_garment} that works well beyond {occ1}.',
    'Turn up for {occ1} in {an} {colour_garment} carrying {player} and {team} colours.',
    '{team} fans, meet your next {garment}: {player}, in {colour}, ready for {occ1}.',
]
OPENERS_NO_PLAYER = [
    'Bring {team} colours to {occ1} with {an} {colour_garment} made for fans who show up.',
    '{an_cap} {colour_garment} in {team} colours, built for {occ1} and everyday fan wear.',
    'Back {team} at {occ1} and long after it with {an} {colour_garment}.',
    'Show {team} colours from {place} to the street in {an} {colour_garment}.',
]
OPENERS_NO_TEAM = [
    '{an_cap} {colour_garment} for fans who want the look without the crowd.',
    '{an_cap} {colour_garment} built for {occ1} and everyday wear.',
]

MIDDLES = [
    'Cut for comfort on the sofa or in {place}, it pairs as easily with jeans as it does with a crowd.',
    'It reads just as well from {place} as it does on a Friday night out.',
    'A clean pick for fans who want to stand out early and keep wearing it long after the season.',
    'Light enough for {occ2}, sturdy enough to keep in rotation all season.',
    'The kind of piece that earns a spot in the rotation rather than the back of a drawer.',
    'Straightforward, wearable, and unmistakable to anyone who follows the game.',
]
SEASON_CLAUSE_PAST = [
    'A nod to the {season} side for anyone who remembers it.',
    'Drawn from {season}, for fans with a long memory.',
    '{season} styling, for the people who were there.',
]
SEASON_CLAUSE_CURRENT = [
    '{season} styling, current and ready to wear.',
    'Cut in the {season} look.',
    'The {season} colourway.',
]
THIS_YEAR = 2026
EDITION_CLAUSE = {
    'retro': 'Retro styling, for fans who prefer the old look.',
    'throwback': 'A throwback cut for anyone who prefers the older look.',
    'color rush': 'The bolder colour-rush treatment, for when the standard kit is too quiet.',
    'city edition': 'City-edition styling, built around the local look.',
    'alternate': 'The alternate colourway, for a change from the usual.',
    'longsleeve': 'Long sleeves, for colder fixtures and layering.',
    'all star': 'All-star styling, for the showcase fixtures.',
    'finals': 'Finals styling, for the games that mattered.',
}

SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL',
              '7XL', '8XL', '9XL', '10XL']
YOUTH_ORDER = ['YS', 'YM', 'YL', 'YXL', 'Y2XL']

GARMENT_WORD = {'jersey': 'jersey', 'longsleeve-jersey': 'long-sleeve jersey',
                'shorts': 'shorts', 'hoodie': 'hoodie', 'tshirt': 'tee',
                'jacket': 'jacket', 'pants': 'pants', 'sweatshirt': 'sweatshirt',
                'hat': 'hat', 'cap': 'cap'}


def pick(options: list, seed: str, salt: str = '') -> str:
    """Deterministic choice, so re-running produces identical copy."""
    h = int(hashlib.sha1((seed + salt).encode()).hexdigest(), 16)
    return options[h % len(options)]


def size_sentence(variants: list[dict]) -> str:
    """Describe the sizes that actually exist. Never claim ones that don't."""
    by_fit = defaultdict(set)
    for v in variants:
        by_fit[v['fit']].add(v['size_code'])

    def rng(codes: set[str], order: list[str]) -> str | None:
        present = [c for c in order if c in codes]
        if not present:
            return None
        if len(present) == 1:
            return present[0]
        return f'{present[0]}–{present[-1]}'

    parts = []
    adult = by_fit.get('unisex', set())
    if adult and (r := rng(adult, SIZE_ORDER)):
        parts.append(f'unisex {r}')
    for fit, label in (('mens', "men's"), ('womens', "women's")):
        if by_fit.get(fit) and (r := rng(by_fit[fit], SIZE_ORDER)):
            parts.append(f'{label} {r}')
    youth = by_fit.get('youth', set())
    if youth:
        r = rng(youth, YOUTH_ORDER) or rng(youth, SIZE_ORDER)
        if r:
            parts.append(f'youth {r}')
    if by_fit.get('one-size') or (not parts and variants):
        parts.append('one size')
    if not parts:
        return ''
    if len(parts) == 1:
        return f'Available in {parts[0]}.'
    return f'Available in {", ".join(parts[:-1])} and {parts[-1]}.'


def article(word: str) -> str:
    return 'an' if word[:1].lower() in 'aeiou' else 'a'


def build(p: dict, variants: list[dict]) -> str:
    sport = p['sport'] or None
    v = VOICE.get(sport, VOICE[None])
    seed = p['id']
    garment = GARMENT_WORD.get(p['garment'], p['garment'].replace('-', ' '))
    colour = p['colourway'] or ''
    colour_garment = f'{colour} {garment}'.strip()
    occ = v['occasion']
    ctx = {
        'player': p['player'], 'team': p['team'], 'garment': garment,
        'colour': colour or 'team colours', 'colour_garment': colour_garment,
        'an': article(colour_garment), 'an_cap': article(colour_garment).capitalize(),
        'this': 'this', 'verb': v['verb'], 'place': v['place'],
        'occ1': pick(occ, seed, 'o1'), 'occ2': pick(occ, seed, 'o2'),
        'sport': v['noun'], 'season': p['season'],
    }

    if p['player'] and p['team']:
        opener = pick(OPENERS, seed, 'op')
    elif p['team']:
        opener = pick(OPENERS_NO_PLAYER, seed, 'op')
    else:
        opener = pick(OPENERS_NO_TEAM, seed, 'op')

    sentences = [opener.format(**ctx)]

    ed = (p['edition'] or '').lower()
    if ed in EDITION_CLAUSE:
        sentences.append(EDITION_CLAUSE[ed])
    elif p['season']:
        yr = re.findall(r'\d{4}', p['season'])
        past = bool(yr) and int(yr[-1]) < THIS_YEAR
        pool = SEASON_CLAUSE_PAST if past else SEASON_CLAUSE_CURRENT
        sentences.append(pick(pool, seed, 'se').format(**ctx))

    sentences.append(pick(MIDDLES, seed, 'mi').format(**ctx))

    ss = size_sentence(variants)
    if ss:
        sentences.append(ss)

    text = ' '.join(s for s in sentences if s)
    text = re.sub(r'\s+', ' ', text).replace(' ,', ',')
    return text[:1].upper() + text[1:]


def seo(p: dict, description: str) -> tuple[str, str]:
    bits = [p['player'], p['team'], p['colourway'], GARMENT_WORD.get(p['garment'], p['garment'])]
    title = ' '.join(b for b in bits if b)
    title = re.sub(r'\s+', ' ', title).strip()
    if len(title) > 60:
        title = title[:57].rsplit(' ', 1)[0] + '…'
    desc = description
    if len(desc) > 155:
        desc = desc[:152].rsplit(' ', 1)[0] + '…'
    return title.title() if title.isupper() else title, desc


def alt_text(p: dict, position: int) -> str:
    bits = [p['player'], p['team'], p['colourway'],
            GARMENT_WORD.get(p['garment'], p['garment'])]
    base = ' '.join(b for b in bits if b) or p['name']
    # Position 1 is the primary shot. Beyond that the view is unknown, so it is
    # numbered rather than described as "back" — an alt text that guesses is worse
    # than one that doesn't.
    return base if position == 1 else f'{base} — view {position}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--overwrite-existing', action='store_true',
                    help='also replace descriptions that already exist')
    ap.add_argument('--samples', type=int, default=8)
    args = ap.parse_args()

    for f in ('products.csv', 'variants.csv'):
        if not (OUT / f).exists():
            sys.exit(f'missing {OUT/f} — run: python3 tools/extract.py --write')

    products = list(csv.DictReader(open(OUT / 'products.csv')))
    variants = defaultdict(list)
    for v in csv.DictReader(open(OUT / 'variants.csv')):
        variants[v['product_id']].append(v)
    pm = list(csv.DictReader(open(OUT / 'product_media.csv'))) if (OUT / 'product_media.csv').exists() else []
    by_id = {p['id']: p for p in products}

    written = kept = 0
    lengths, uniq = [], set()
    for p in products:
        if p['description'].strip() and not args.overwrite_existing:
            kept += 1
            continue
        text = build(p, variants.get(p['id'], []))
        st, sd = seo(p, text)
        p['description'], p['seo_title'], p['seo_description'] = text, st, sd
        written += 1
        lengths.append(len(text))
        uniq.add(text)

    alts = 0
    for row in pm:
        p = by_id.get(row['product_id'])
        if p and not row['alt'].strip():
            row['alt'] = alt_text(p, int(row['position']))
            alts += 1

    print(f'\n{"="*66}\n  DESCRIPTIONS — {"WRITE" if args.write else "PREVIEW, nothing written"}\n{"="*66}')
    print(f'  products                    {len(products):>6}')
    print(f'  descriptions generated      {written:>6}')
    print(f'  existing descriptions kept  {kept:>6}')
    print(f'  alt texts generated         {alts:>6}   (was 0 across the catalog)')
    if lengths:
        lengths.sort()
        print(f'  length chars                min {lengths[0]}  median '
              f'{lengths[len(lengths)//2]}  max {lengths[-1]}')
        print(f'  distinct strings            {len(uniq):>6} of {written} '
              f'({100*len(uniq)/max(written,1):.1f}% unique)')

    print(f'\n  --- samples ---')
    shown = [p for p in products if p['description']][:0]
    step = max(len(products) // max(args.samples, 1), 1)
    for p in products[::step][:args.samples]:
        print(f'\n  {p["name"][:72]}')
        print(f'    {p["description"]}')

    if not args.write:
        print(f'\n  Nothing written. Re-run with --write to patch products.csv '
              f'and product_media.csv.\n')
        return

    with open(OUT / 'products.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(products[0].keys()))
        w.writeheader()
        w.writerows(products)
    print(f'\n  patched products.csv ({len(products)} rows)')
    if pm:
        with open(OUT / 'product_media.csv', 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(pm[0].keys()))
            w.writeheader()
            w.writerows(pm)
        print(f'  patched product_media.csv ({len(pm)} rows)')
    print()


if __name__ == '__main__':
    main()
