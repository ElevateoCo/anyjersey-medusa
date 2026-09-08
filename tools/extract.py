#!/usr/bin/env python3
"""Turn the Shopify archive into the own-stack catalog schema.

Reads the 2026-08-18 full backup (products_full.jsonl is authoritative — it has
descriptions, SKUs and real option data the CSV exports lack) and emits CSVs matching
tools/schema.sql, plus a data-quality report.

Report-only by default. Pass --write to emit the CSVs.

    python3 tools/extract.py                     # profile + report, writes nothing
    python3 tools/extract.py --write             # emit CSVs to tools/out/
    python3 tools/extract.py --write --include-drafts
"""
from __future__ import annotations
import argparse, csv, hashlib, json, os, re, sys, unicodedata
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from vocab import (TEAMS, LEAGUE_SPORT, EDITIONS, COLOURS, GARMENTS, SIZE_MAP,
                   NATIONS, FIT_PREFIXES, ALIASES, CITY_SPORT)

BACKUP = Path('/Users/emil/Downloads/Anyjersey backup/Backup/backups/2026-08-18-FULL-anyjersey')
OUT = Path(__file__).parent / 'out'

# team lookup, longest name first so "Chicago White Sox" beats "Chicago Cubs"
TEAM_INDEX: list[tuple[str, str, str]] = []
for _league, _blob in TEAMS.items():
    for _name in (n.strip() for n in _blob.replace('\n', '').split('|')):
        if _name:
            TEAM_INDEX.append((_name.lower(), _name, _league))
# aliases join the same index, so longest-match-first handles precedence naturally
for _alias, _canon, _league in ALIASES:
    TEAM_INDEX.append((_alias.lower(), _canon, _league))
TEAM_INDEX.sort(key=lambda t: -len(t[0]))

NATION_INDEX = sorted(
    ((n.strip().lower(), n.strip()) for n in NATIONS.replace('\n', '').split('|') if n.strip()),
    key=lambda t: -len(t[0]))


def norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '')
    return re.sub(r'\s+', ' ', s).strip()


def title_case(s: str) -> str:
    """Source titles are SHOUTED. Display needs sentence-ish case."""
    small = {'of', 'the', 'and', 'a', 'an', 'de', 'da'}
    keep = {'FC', 'AC', 'SC', 'CF', 'USA', 'UFC', 'NFL', 'NBA', 'MLB', 'NHL', 'NCAA',
            'II', 'III', 'IV', 'JR', 'SR'}
    lower_num = {'76ERS': '76ers', '49ERS': '49ers'}
    out = []
    for i, w in enumerate(norm(s).split()):
        u = w.upper().strip('.,')
        if u in lower_num:
            out.append(lower_num[u])
        elif u in keep:
            out.append(u if u not in ('JR', 'SR') else u.title() + '.')
        elif w.lower() in small and i:
            out.append(w.lower())
        elif re.fullmatch(r"[A-Z]?\d+[A-Za-z]*", w):
            out.append(w.upper())
        else:
            out.append(w[:1].upper() + w[1:].lower())
    return ' '.join(out)


def slugify(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode()
    return re.sub(r'-{2,}', '-', re.sub(r'[^a-z0-9]+', '-', s.lower())).strip('-')


def parse_title(title: str) -> dict:
    """Recover team / player / colourway / edition / season / garment from a title."""
    t = norm(title)
    low = t.lower()
    out: dict = {'season': None, 'garment': None, 'edition': None, 'team': None,
                 'league': None, 'colourway': None, 'player': None}
    consumed: list[tuple[int, int]] = []

    def take(m):
        consumed.append((m.start(), m.end()))

    m = re.search(r'\b(1[89]\d{2}|20\d{2})\s*[-/]\s*(1[89]\d{2}|20\d{2})\b', low)
    if not m:
        m = re.search(r'\b(1[89]\d{2}|20\d{2})\b', low)
    if m:
        out['season'] = m.group(0).replace(' ', '')
        take(m)

    for phrase, code in GARMENTS:
        m = re.search(r'\b' + re.escape(phrase) + r'\b', low)
        if m:
            out['garment'] = code
            take(m)
            break

    for phrase in EDITIONS:
        if out['garment'] and phrase.replace(' ', '') in out['garment'].replace('-', ''):
            continue
        m = re.search(r'\b' + re.escape(phrase) + r'\b', low)
        if m:
            out['edition'] = phrase.replace('-', ' ')
            take(m)
            break

    for needle, name, league in TEAM_INDEX:
        i = low.find(needle)
        if i >= 0:
            out['team'], out['league'] = name, league
            consumed.append((i, i + len(needle)))
            break

    if not out['team']:
        # "TEAM <nation>" first, then a bare nation name
        m = re.search(r'\bteam\s+([a-z][a-z ]{2,22}?)\s+(?='
                      + '|'.join(COLOURS) + r'|jersey|shorts|longsleeve|jacket|\d|$)', low)
        cand = None
        if m:
            cand = m.group(1).strip()
        if cand:
            for needle, name in NATION_INDEX:
                if needle == cand or cand.startswith(needle):
                    out['team'], out['league'] = name, 'SOCCER'
                    i = low.find(needle)
                    consumed.append((i, i + len(needle)))
                    break
        if not out['team']:
            for needle, name in NATION_INDEX:
                i = low.find(needle)
                if i >= 0 and re.match(r'\b', low[i:]) and (
                        i == 0 or not low[i-1].isalpha()) and (
                        i + len(needle) >= len(low) or not low[i + len(needle)].isalpha()):
                    out['team'], out['league'] = name, 'SOCCER'
                    consumed.append((i, i + len(needle)))
                    break

    # "<city> baseball" with no team name — resolved only where the city has exactly one
    # franchise in that sport. Ambiguous cities stay unresolved rather than guessed.
    if not out['team']:
        for (city, sport), (name, lg) in CITY_SPORT.items():
            if re.search(r'\b' + re.escape(city) + r'\b', low) and re.search(r'\b' + sport + r'\b', low):
                out['team'], out['league'] = name, lg
                i = low.find(city)
                consumed.append((i, i + len(city)))
                break

    if not out['league']:
        for word, lg in (('baseball', 'MLB'), ('basketball', 'NBA'),
                         ('hockey', 'NHL'), ('football', 'NFL'), ('soccer', 'SOCCER')):
            if re.search(r'\b' + word + r'\b', low):
                out['league'] = lg
                break

    # consume EVERY colour mention, not just the first, so a second colour does not
    # leak into the player name. The first (longest) match is the colourway.
    for c in COLOURS:
        for m in re.finditer(r'\b' + c.replace(' ', r'\s+') + r'\b', low):
            if out['colourway'] is None:
                out['colourway'] = 'grey' if c == 'gray' else c
            take(m)

    # whatever is left, in order, is the player name
    mask = [True] * len(t)
    for a, b in consumed:
        for i in range(a, min(b, len(t))):
            mask[i] = False
    residual = norm(''.join(ch if keep else ' ' for ch, keep in zip(t, mask)))
    drop = {'team', 'jersey', 'jerseys', 'shorts', 'mens', 'men', 'womens', 'women',
            'kids', 'youth', 'nike', 'adidas', 'puma', 'reebok', 'world', 'cup',
            'edition', 'player', 'custom', 'and', 'the', 'with', 'new', 'official',
            'stitched', 'sewn', 'football', 'basketball', 'baseball', 'hockey',
            'soccer', 'shirt', 'hoodie', 'set', 'size', 'sizes'}
    words = [w for w in residual.split() if w.lower().strip('.,') not in drop
             and not re.fullmatch(r'[\d\W]+', w)]
    if 1 <= len(words) <= 4:
        out['player'] = title_case(' '.join(words))
    out['sport'] = LEAGUE_SPORT.get(out['league'] or '')
    return out


def norm_size(raw: str) -> tuple[str, str, str, str, bool]:
    """-> (code, label, group, fit, recognised)

    Fit is separate from size: a product offering "Mens S" and "Womens S" has two
    real variants, not one duplicate.
    """
    r = norm(raw)
    k = re.sub(r'[\s._-]+', ' ', r.lower()).strip()
    k = re.sub(r'^(size|sizes)\s+', '', k)
    k = k.rstrip(" '\u2019")
    fit = 'unisex'
    for prefix, f in FIT_PREFIXES:
        if k.startswith(prefix + ' ') or k == prefix or (
                k.startswith(prefix) and len(k) > len(prefix) and not k[len(prefix)].isalpha()):
            fit = f
            k = k[len(prefix):].strip()
            break
        if k.startswith(prefix) and re.fullmatch(r'\d?x?l?', k[len(prefix):]):
            fit = f
            k = k[len(prefix):].strip()
            break
    for key in (k, k.replace(' ', '')):
        if key in SIZE_MAP:
            code, group = SIZE_MAP[key]
            if fit == 'youth' and group == 'adult':
                code, group = 'Y' + code, 'youth'
            # A youth size implies a youth fit. Without this, bare "YS" came back as
            # group=youth/fit=unisex while "Youth S" came back as youth/youth — so a
            # product carrying both listed YS under the Unisex fit option.
            if group == 'youth':
                fit = 'youth'
            label = code if fit in ('unisex', 'youth') else f'{fit.title()[:-1]}\u2019s {code}'
            return code, label, group, fit, True
    return r.upper() or 'UNKNOWN', r or 'Unknown', 'adult', fit, False


def make_sku(source_product_id: str, size_code: str) -> str:
    h = hashlib.sha1(source_product_id.encode()).digest()
    b32 = ''.join('0123456789ABCDEFGHJKMNPQRSTVWXYZ'[b % 32] for b in h[:5])
    return f'AJ-{b32}-{size_code}'


def cents(price: str | None) -> int | None:
    try:
        return int(round(float(price) * 100))
    except (TypeError, ValueError):
        return None


def load_backup():
    products, variants, media, metafields = {}, defaultdict(list), defaultdict(list), defaultdict(dict)
    with open(BACKUP / 'products_full.jsonl') as f:
        for line in f:
            o = json.loads(line)
            k = o.keys()
            if 'handle' in k:
                products[o['id']] = o
            elif 'selectedOptions' in k:
                variants[o['__parentId']].append(o)
            elif 'image' in k:
                media[o['__parentId']].append(o)
            elif 'namespace' in k:
                metafields[o['__parentId']][f"{o['namespace']}.{o['key']}"] = o['value']

    manifest = json.loads((BACKUP / 'media_manifest.json').read_text())
    checksums = {}
    for line in (BACKUP / 'media' / 'checksums.sha256').read_text().splitlines():
        if '  ' in line:
            digest, path = line.split('  ', 1)
            checksums[os.path.basename(path.strip())] = digest.strip()

    collections, membership = {}, defaultdict(list)
    with open(BACKUP / 'collections_membership.jsonl') as f:
        for line in f:
            o = json.loads(line)
            if '__parentId' in o:
                membership[o['__parentId']].append(o['id'])
            elif 'title' in o:
                collections[o['id']] = o
    return products, variants, media, metafields, manifest, checksums, collections, membership


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true', help='emit CSVs to tools/out/')
    ap.add_argument('--include-drafts', action='store_true')
    ap.add_argument('--allow-zero-price', action='store_true')
    args = ap.parse_args()

    P, V, M, MF, manifest, checksums, COLS, MEMB = load_backup()
    files = manifest['files']
    product_images = manifest['product_images']

    # dimensions keyed by filename, from the Admin API media records
    dims = {}
    for ms in M.values():
        for m in ms:
            url = (m.get('image') or {}).get('url') or ''
            fn = os.path.basename(url.split('?')[0])
            if fn:
                dims[fn] = ((m['image'] or {}).get('width'), (m['image'] or {}).get('height'),
                            m.get('alt') or None)

    rows_p, rows_v, rows_m, rows_pm, issues = [], [], [], [], []
    sku_seen: dict[str, int] = {}

    def unique_sku(existing: str, pid: str, key: str) -> str:
        """Existing Shopify SKUs collide across products, so they are used only when free."""
        for cand in ((existing or '').strip(), make_sku(pid, key)):
            if cand and cand not in sku_seen:
                sku_seen[cand] = 1
                return cand
        base = make_sku(pid, key)
        n = sku_seen.get(base, 1)
        while f'{base}-{n}' in sku_seen:
            n += 1
        sku_seen[base] = n + 1
        sku_seen[f'{base}-{n}'] = 1
        stat['sku_collision_resolved'] += 1
        return f'{base}-{n}'
    media_by_sha: dict[str, dict] = {}
    slugs: dict[str, int] = {}
    stat = Counter()
    unparsed_sizes, no_team = Counter(), []

    for pid, p in sorted(P.items(), key=lambda kv: kv[1]['handle']):
        status = (p.get('status') or 'DRAFT').lower()
        status = {'unlisted': 'draft', 'archived': 'archived'}.get(status, status)
        notes: list[str] = []
        stat['products_seen'] += 1

        if status != 'active' and not args.include_drafts:
            stat[f'skipped_{status}'] += 1
            continue

        title = norm(p.get('title') or '')
        if not title or title.lower().startswith('untitled'):
            notes.append('placeholder title')
            stat['placeholder_title'] += 1

        parsed = parse_title(title)
        if not parsed['team']:
            notes.append('team not recognised')
            no_team.append(title)
        if not parsed['garment']:
            parsed['garment'] = 'jersey'
            notes.append('garment defaulted to jersey')

        # league fallback: productType, then collection membership
        if not parsed['league']:
            pt = (p.get('productType') or '').lower()
            for key, lg in (('soccer', 'SOCCER'), ('baseball', 'MLB'),
                            ('basketball', 'NBA'), ('hockey', 'NHL'), ('football', 'NFL')):
                if key in pt:
                    parsed['league'] = lg
                    parsed['sport'] = LEAGUE_SPORT[lg]
                    break

        vs = sorted(V.get(pid, []), key=lambda v: v.get('position') or 0)
        prices = [cents(v.get('price')) for v in vs]
        prices = [x for x in prices if x is not None]
        if not prices:
            issues.append((p['handle'], title, 'no priced variant — skipped'))
            stat['skipped_no_price'] += 1
            continue
        base = Counter(prices).most_common(1)[0][0]
        if base <= 0:
            if not args.allow_zero_price:
                issues.append((p['handle'], title, f'base price {base} — skipped'))
                stat['skipped_zero_price'] += 1
                continue
            notes.append('zero price allowed by flag')

        # slug: regenerate from parsed fields. This is a greenfield store, so there is no
        # redirect obligation and 124 "untitled-*" handles do not need preserving.
        parts = [parsed['team'], parsed['player'], parsed['colourway'],
                 parsed['edition'], parsed['garment']]
        raw_slug = slugify(' '.join(x for x in parts if x)) or slugify(title) or slugify(p['handle'])
        seen_tok, toks = set(), []
        for tok in raw_slug.split('-'):
            if tok and tok not in seen_tok:
                seen_tok.add(tok)
                toks.append(tok)
        cand = '-'.join(toks)
        if cand in slugs:
            slugs[cand] += 1
            slug = f'{cand}-{slugs[cand]}'
        else:
            slugs[cand] = 1
            slug = cand

        pk = f'p_{hashlib.sha1(pid.encode()).hexdigest()[:16]}'
        desc = norm(re.sub(r'<[^>]+>', ' ', p.get('descriptionHtml') or ''))
        if not desc or desc.lower() == title.lower():
            desc = None
            stat['missing_description'] += 1

        rows_p.append({
            'id': pk, 'slug': slug, 'name': title_case(title), 'status': status,
            'sport': parsed['sport'], 'league': parsed['league'], 'team': parsed['team'],
            'player': parsed['player'], 'colourway': parsed['colourway'],
            'season': parsed['season'], 'edition': parsed['edition'],
            'garment': parsed['garment'],
            'price_cents': base, 'compare_at_cents': '', 'currency': 'USD',
            'taxable': 'true' if vs[0].get('taxable', True) else 'false',
            'requires_shipping': 'true',
            'description': desc or '', 'seo_title': '', 'seo_description': '',
            'manufacturer_name': '', 'manufacturer_address': '', 'eu_responsible_person': '',
            'country_of_origin': '', 'fibre_composition': '', 'care_instructions': '',
            'safety_information': '', 'hs_code': '',
            'source_platform': 'shopify', 'source_id': pid, 'source_handle': p['handle'],
            'needs_review': 'true' if notes else 'false',
            'review_notes': '{' + ','.join('"%s"' % n for n in notes) + '}',
        })
        if notes:
            stat['needs_review'] += 1

        seen_sizes = set()
        pos = 0
        for v in vs:
            raw = (v['selectedOptions'][0]['value'] if v.get('selectedOptions')
                   else (v.get('title') or ''))
            code, label, group, fit, ok = norm_size(raw)
            if not ok:
                unparsed_sizes[raw] += 1
            if (code, fit) in seen_sizes:
                stat['duplicate_size_dropped'] += 1
                continue
            seen_sizes.add((code, fit))
            pos += 1
            vc = cents(v.get('price'))
            inv = v.get('inventoryItem') or {}
            wt = ((inv.get('measurement') or {}).get('weight') or {})
            grams = int(round((wt.get('value') or 0) * (453.592 if wt.get('unit') == 'POUNDS' else 1000)))
            rows_v.append({
                'id': f'v_{hashlib.sha1((pid + code + fit).encode()).hexdigest()[:16]}',
                'product_id': pk,
                'sku': unique_sku(v.get('sku') or '', pid,
                                  code + ('' if fit == 'unisex' else '-' + fit[:1].upper())),
                'size_code': code, 'size_label': label, 'size_group': group, 'fit': fit,
                'position': pos,
                'price_cents': vc if vc and vc != base and vc > 0 else '',
                'barcode': v.get('barcode') or '',
                'weight_grams': grams or '',
                'track_inventory': 'true' if inv.get('tracked') else 'false',
                'inventory_policy': 'deny' if (v.get('inventoryPolicy') or '') == 'DENY' else 'continue',
                'source_id': v['id'],
            })

        # media: content-addressed, deduped globally
        mpos = 0
        for fn in product_images.get(p['handle'], []):
            sha = checksums.get(fn)
            meta = files.get(fn) or {}
            if not sha:
                issues.append((p['handle'], title, f'no checksum for {fn}'))
                continue
            ext = os.path.splitext(fn)[1].lower().lstrip('.') or 'jpg'
            w, h, alt = dims.get(fn, (None, None, None))
            if sha not in media_by_sha:
                media_by_sha[sha] = {
                    'id': f'm_{sha[:16]}', 'sha256': sha,
                    'storage_key': f'originals/{sha}.{ext}',
                    'mime': meta.get('mime') or 'image/jpeg',
                    'width': w or '', 'height': h or '',
                    'bytes': meta.get('expected_size') or 0,
                }
            mpos += 1
            rows_pm.append({'product_id': pk, 'media_id': media_by_sha[sha]['id'],
                            'position': mpos, 'alt': alt or ''})
        if mpos == 0:
            stat['products_without_media'] += 1
        elif mpos == 1:
            stat['products_with_one_image'] += 1

    rows_m = list(media_by_sha.values())

    # collections
    rows_c, rows_cp = [], []
    pk_by_source = {r['source_id']: r['id'] for r in rows_p}
    for cid, c in COLS.items():
        kind = ('league' if c['handle'] in {'nfl', 'nba', 'hockey', 'baseball-1', 'ncaa-football'}
                else 'event' if 'world-cup' in c['handle'] or 'ufc' in c['handle']
                else 'merchandising')
        rows_c.append({'id': f'c_{hashlib.sha1(cid.encode()).hexdigest()[:12]}',
                       'slug': c['handle'], 'name': title_case(c['title']),
                       'kind': kind, 'position': '', 'source_id': cid})
        for i, prod_gid in enumerate(MEMB.get(cid, []), 1):
            if prod_gid in pk_by_source:
                rows_cp.append({'collection_id': f'c_{hashlib.sha1(cid.encode()).hexdigest()[:12]}',
                                'product_id': pk_by_source[prod_gid], 'position': i})

    # ---------------------------------------------------------------- report
    print(f'\n{"="*66}\n  CATALOG EXTRACT — {"WRITE" if args.write else "DRY RUN, nothing written"}\n{"="*66}')
    print(f'source: {BACKUP.name}\n')
    print(f'  products in archive        {stat["products_seen"]:>6}')
    for k in ('skipped_draft', 'skipped_archived', 'skipped_no_price', 'skipped_zero_price'):
        if stat[k]:
            print(f'  {k:<25} {stat[k]:>6}')
    print(f'  products emitted          {len(rows_p):>6}')
    print(f'  variants emitted          {len(rows_v):>6}')
    print(f'  distinct media            {len(rows_m):>6}   ({len(rows_pm)} product-image links)')
    print(f'  collections               {len(rows_c):>6}   ({len(rows_cp)} memberships)')

    print(f'\n  --- parse quality ---')
    tot = max(len(rows_p), 1)
    for f in ('team', 'player', 'league', 'colourway', 'season', 'edition'):
        n = sum(1 for r in rows_p if r[f])
        print(f'  {f:<12} resolved  {n:>6}  ({100*n/tot:.0f}%)')
    print(f'  needs_review            {stat["needs_review"]:>6}  ({100*stat["needs_review"]/tot:.0f}%)')

    print(f'\n  --- blockers for the storefront plan (research.md §12.7) ---')
    print(f'  products with NO image    {stat["products_without_media"]:>6}')
    print(f'  products with ONE image   {stat["products_with_one_image"]:>6}   (PDP design wants 6)')
    print(f'  products with NO copy     {stat["missing_description"]:>6}')
    print(f'  regulatory fields empty   {len(rows_p):>6}   (GPSR + fibre composition: blocks EU sales)')
    print(f'  compare-at prices set          0   (no reference price exists yet — start it clean)')

    if unparsed_sizes:
        print(f'\n  --- unrecognised sizes ({len(unparsed_sizes)} distinct) ---')
        for s, c in unparsed_sizes.most_common(30):
            print(f'    {s[:34]:<36} {c}')
    if stat['sku_collision_resolved']:
        print(f'\n  SKU collisions resolved (source SKUs are not unique): '
              f'{stat["sku_collision_resolved"]}')
    if stat['duplicate_size_dropped']:
        print(f'\n  collapsed duplicate sizes after normalisation: {stat["duplicate_size_dropped"]}')
    if no_team:
        print(f'\n  --- sample titles where team did not resolve ({len(no_team)}) ---')
        for t in no_team[:10]:
            print(f'    {t[:70]}')
    if issues:
        print(f'\n  --- {len(issues)} rejected rows (first 8) ---')
        for h, t, why in issues[:8]:
            print(f'    {h[:30]:<32} {why}')

    if not args.write:
        print(f'\n  Nothing written. Re-run with --write to emit CSVs to {OUT}/\n')
        return

    OUT.mkdir(exist_ok=True)
    for name, rows in (('products', rows_p), ('variants', rows_v), ('media', rows_m),
                       ('product_media', rows_pm), ('collections', rows_c),
                       ('collection_products', rows_cp)):
        if not rows:
            continue
        with open(OUT / f'{name}.csv', 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f'  wrote {name}.csv  ({len(rows)} rows)')
    with open(OUT / 'issues.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['source_handle', 'title', 'issue'])
        w.writerows(issues)
    print(f'  wrote issues.csv  ({len(issues)} rows)')
    print(f'\n  Load order: products -> variants -> media -> product_media -> collections'
          f' -> collection_products\n  psql -c "\\copy products from \'{OUT}/products.csv\' csv header"\n')


if __name__ == '__main__':
    main()
