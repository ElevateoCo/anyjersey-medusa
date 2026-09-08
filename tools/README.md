# Catalog tooling

Turns the Shopify archive into the own-stack catalog schema, and puts the images where
images belong. Both scripts are **report-only by default** — neither writes anything or
touches the network until you pass an explicit flag.

```
tools/
  schema.sql        Postgres DDL for the target catalog
  vocab.py          parsing vocabularies (teams, nations, colours, sizes, editions)
  extract.py        archive -> CSVs matching schema.sql, plus a data-quality report
  upload_media.py   images -> Cloudflare R2, content-addressed and idempotent
  build_import_json.py  out/*.csv -> backend/src/scripts/catalog.json
  sync_live_catalog.py  live store -> catalog-sync.json (the gap since the archive)
  out/              generated CSVs (gitignored)
```

## Why the schema doesn't match Shopify's

No field *naming* is legally mandated, so the schema is designed for this store rather
than inherited from the export format. What **is** mandated is that certain
*information* exists before you can lawfully sell into some markets, so those live as
first-class columns instead of metafields:

| Column | Why |
|---|---|
| `manufacturer_name`, `manufacturer_address` | GPSR traceability |
| `eu_responsible_person` | GPSR — no EU sales without one (research.md §7.8) |
| `fibre_composition` | EU Textile Regulation |
| `country_of_origin`, `hs_code` | customs on cross-border orders |
| `care_instructions`, `safety_information` | GPSR product information |

All are empty after import. That is not a cosmetic gap: **it blocks EU orders**, and
the index `products_eu_ready_idx` exists so the application can enforce that rather
than trusting a spreadsheet.

Other deliberate departures from the source shape:

- **Money as integer cents** plus explicit `currency`. Never floats (research.md §6.2).
- **Derived taxonomy columns** — `sport`, `league`, `team`, `player`, `colourway`,
  `season`, `edition`. The source has none worth using: 4,014 of 4,205 products carry
  the single tag `jersey`, and the `custom.team`/`player`/`sport` metafields are set on
  60 products. These columns are what navigation and faceted search are built on.
- **`fit` as its own dimension** on variants. A product offering `Mens S` and
  `Womens S` has two real variants, not one duplicate.
- **Media deduped globally** by `sha256`, with `product_media` as the join. The archive
  holds 6,323 blobs for 4,635 distinct images in use.
- **`needs_review` + `review_notes[]`** on products, so unparseable rows are flagged
  rather than silently guessed.
- **`jersey_requests` as a first-class table.** "Can't find your jersey? Request it" is the
  store's actual differentiator (research.md §12.1); requests are parsed with the same
  vocabulary as the catalog so the queue sorts by real demand, not arrival order.
- **Titles stored Title Case**, uppercased in the display layer. The live store stores them
  shouted, which breaks search, alt text and structured data.

## extract.py

Reads `products_full.jsonl` from the 2026-08-18 full backup — authoritative, and richer
than the CSV exports, which have no SKUs, no descriptions and inconsistent option names.

```bash
python3 tools/extract.py                    # profile + report, writes nothing
python3 tools/extract.py --write            # emit CSVs to tools/out/
python3 tools/extract.py --write --include-drafts
python3 tools/extract.py --write --allow-zero-price   # not recommended
```

What it does beyond copying fields:

- **Parses titles** into team / player / colourway / season / edition / garment.
  Currently resolves team on 94% and league on 95% of products; the rest are flagged.
- **Normalises 143 raw size values** onto a canonical set (`XS…10XL`, `YS…Y2XL`, `ONE`),
  splitting fit out of the size string.
- **Generates deterministic SKUs** — `AJ-<hash of source id>-<size>`. Source SKUs are
  used only where they are unique, because 819 of them collide across products.
- **Rejects $0.00 products** rather than importing something that would sell for nothing.
- **Regenerates slugs** from parsed fields. This is a greenfield store, so there is no
  redirect obligation, and 124 source handles are `untitled-*`.

Load order (every uniqueness constraint in `schema.sql` is satisfied by the output):

```bash
psql -f tools/schema.sql
for t in products variants media product_media collections collection_products; do
  psql -c "\copy $t from 'tools/out/$t.csv' csv header"
done
```

## upload_media.py

```bash
python3 tools/upload_media.py                # dry run: resolve, checksum, plan
python3 tools/upload_media.py --verify-only  # checksum the whole archive, no network
python3 tools/upload_media.py --upload       # needs R2_* env vars
```

Keys are `originals/<sha256>.<ext>`, which makes the upload idempotent — re-running
uploads nothing. Objects are written with `Cache-Control: immutable` because
content-addressed bytes can never change.

**Originals are private; never link them.** Put an image transform layer in front
(Cloudflare Images, or R2 + a Worker) and serve derivatives — resized, WebP/AVIF, per
breakpoint. That is the reason bytes are not in Postgres: the ~4,635 originals become
tens of thousands of derivatives, which should be generated on demand and stored
nowhere.

Current state: 4,635 images, **3.09 GB**, all resolved locally, zero missing, integrity
verified against the archive's own `checksums.sha256`.

## describe.py

Generates descriptions, SEO fields and image alt text for products that lack them.

```bash
python3 tools/describe.py                          # preview samples, writes nothing
python3 tools/describe.py --write                   # patch products.csv + product_media.csv
python3 tools/describe.py --write --overwrite-existing
```

The 89 pre-existing descriptions are kept and used as the voice model, not copied — they
are one template with names swapped, and duplicating that across 3,502 URLs is thin
content. The generator composes several sentence patterns, selected deterministically per
product, producing **98.7% distinct strings**. Deterministic means re-running yields
identical copy, so descriptions do not churn between runs.

Two things it fixes rather than inherits:

- **Sizes come from the variant rows.** The original template claimed "men's, youth, and
  women's sizes from S-XXL" on every product; the catalog is overwhelmingly unisex S–4XL.
  Advertising sizes you do not stock is a misleading claim (research.md §7.10).
- **No unverifiable claims.** Nothing asserts "officially licensed", "authentic", fabric
  composition or stitching method — none of it is in the data, and inventing it is an FTC
  §5 and textile-labelling problem.

Alt text names player, team, colourway and garment. Images beyond the first are numbered
rather than described as "back", since the view is unknown.

## Pipeline

```bash
python3 tools/extract.py --write      # 3,591 products, 23,997 variants, 4,635 media
python3 tools/describe.py --write     # 3,502 descriptions, 4,853 alt texts
python3 tools/upload_media.py         # dry run; --upload when R2_* is set
python3 tools/build_import_json.py    # -> spike/backend/src/scripts/catalog.json
```

Then, to close the gap between the archive snapshot and the live store:

```bash
python3 tools/sync_live_catalog.py --fetch    # pull the live products.json
python3 tools/sync_live_catalog.py            # diff only, writes nothing
python3 tools/sync_live_catalog.py --write    # -> catalog-sync.json
```

### The import payloads are not in the repo

`catalog.json` (6.3 MB) and `catalog-sync.json` (2.3 MB) are gitignored, so a fresh clone
has neither and **cannot seed until they are rebuilt** with the two commands above.

Rebuilding needs the full backup archive, which lives outside the repo and is currently a
hardcoded absolute path in `build_import_json.py`:

    /Users/emil/Downloads/Anyjersey backup/Backup/backups/2026-08-18-FULL-anyjersey/media

On any other machine that path has to be edited or the script will fail on the checksum
file. `upload_media.py` and the `backend/static/media` symlink depend on the same archive.

## Known gaps this tooling cannot fix

| Gap | Count | Note |
|---|---|---|
| Products missing the regulatory block | 3,591 (all) | Blocks EU sales; US-only launch unaffected |
| Products flagged `needs_review` | 262 | Team or title unresolved |
| Second product image | 2,607 | **Accepted** — one image per product is the decision (research.md §13.6) |
