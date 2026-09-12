# Spike — Phase 0 payment path + full catalog + storefront shell

Four things, built in order:

| | | Status |
|---|---|---|
| **0** | Payment path proven end to end, no browser involved | 7 of 8 steps — last needs a Stripe test key |
| **1** | Full catalog imported at scale | ✅ 3,591 products, 23,997 variants, 34s, 0 failures |
| **2** | Catalog module: derived taxonomy, regulatory block, jersey requests | ✅ indexed, linked, facet API live |
| **3** | Storefront shell: homepage, faceted PLP, PDP | ✅ Next.js on :3000 |
| **4** | Spike fixes: webhook-secret guard, single sales channel | ✅ |
| **5** | Cart and checkout UI | ✅ up to the card field — needs a Stripe key |
| **6** | Admin sourcing queue for jersey requests | ✅ |
| **7** | Accessibility pass | ✅ 0 mechanical issues across 7 pages |
| **8** | Node repair · SQL facet pushdown · vocabulary fix | ✅ |
| **9** | Zone-based shipping rates | ✅ 5 zones live |
| **10** | Duplicate listings merged | ✅ 3,591 → 3,155 products |
| **11** | Bug sweep | ✅ 4 fixed, incl. one that silently truncated every listing |
| **12** | Resend email (placeholder keys) | ✅ 3 templates, safe without a key |
| **13** | Unit tests | ✅ **136 tests** across 3 suites |
| **14** | Search, sort, pagination | ✅ the gap anyjersey.com exposed |
| **15** | Admin gaps filled | ✅ reports, abandoned carts, integrations |
| **16** | Catalog admin page | ✅ four gaps in one screen |
| **17** | Autocomplete · notify-me · order tracking | ✅ storefront UX gaps |
| **18** | Mobile filters · reviews · cart drawer | ✅ |
| **19** | Integration tests | ✅ **57** against a real database |
| **20** | Images into Postgres | ✅ 4,635 assets, 515 MB WebP, 0 failures |
| **21** | Tax · fulfilment · observability | ✅ 3 modules, no SDK |
| **22** | Personalisation | ✅ per `personalisation-spec.md`, 45 unit tests |
| **23** | The nine storefront gaps closed | ✅ SEO · policies · accounts · discounts · regions · CSP · returns · reviews · a11y |
| **24** | Custom jerseys, from the live store | ✅ 66 products, printing included, $89.99 |
| **25** | The missing pages, in the live store's own words | ✅ contact · privacy choices · newsletter — **and a returns policy reversal** |
| **26** | Catalog re-sync + curated collections | ✅ 3,222 → **4,324 products**, 11 collections, 1,782 images |
| **42** | The NFL Shop layout, built | ✅ 5 bands · 12 nav slots · mega-panels · phone drawer · team colours |
| **43** | The demo concept's functionality, integrated | ✅ sport rail · recently viewed · multi-select filters |
| **44** | Consent by jurisdiction | ✅ opt-in where the law asks, notice where it tells — California included |
| **45** | The rest of the policy follows the visitor | ✅ rights · deadlines · DSAR routes · the retention row that is not ours to set |
| **46** | Campaign banner | ✅ full-bleed 8:3 video or still, pause control, reduced-motion, dev-only placeholder |

**Tests now: 459 backend unit, 385 backend integration against a real database, 107
storefront, 82 python** — plus a contrast audit, a 25-page accessibility audit, and a
self-test proving the accessibility checks can actually fail.

## What is running

| | |
|---|---|
| Backend | Medusa **2.18.0**, `backend/`, port **9000** — admin at `/app` |
| Storefront | Next.js, `storefront/`, port **3000** |
| Postgres | Docker `aj-postgres`, port **5433** |
| Redis | Docker `aj-redis`, port **6380** |
| Node | **22.23.2** via `/opt/homebrew/opt/node@22/bin` — Medusa requires 20/22 LTS, this machine's default Node 25 is unsupported |

Everything is local. No cloud resources, no real money, no production credentials.

## Verified so far

```
1. region              United States / usd
2. product             Buffalo Bills Josh Allen Blue Jersey
                       variant L · AJ-M09FD-L · $64.99 · manage_inventory=False
                       images: 1 (one, by decision)
3. cart                created
4. add line item       subtotal $64.99 — client sent only variant_id + quantity
5. addresses           shipping and billing set
6. shipping method     Standard Shipping $4.99
7. totals              $69.98 — matches the unit economics in §9.1
8. Stripe session      BLOCKED: needs STRIPE_API_KEY
```

Real catalog data, not demo fixtures: the product, its description, its SKUs and its
single image all come from `tools/out/`.

## Finish it — three steps

**1. Add your Stripe test keys.** In `backend/.env`:

```
STRIPE_API_KEY=sk_test_...          # dashboard.stripe.com, TEST mode, Developers > API keys
STRIPE_WEBHOOK_SECRET=whsec_...     # printed by `stripe listen` below
```

Restart the backend after editing.

**2. Forward webhooks.** In a second terminal:

```bash
stripe listen --forward-to localhost:9000/hooks/payment/stripe_stripe
```

**3. Run the flow, pay, and complete without a browser:**

```bash
cd spike
python3 verify_flow.py                     # prints a PaymentIntent id
stripe payment_intents confirm pi_... --payment-method pm_card_visa
python3 verify_flow.py --complete cart_...
```

Watch the backend log for the `ORDER CREATED VIA WEBHOOK` banner. That banner is printed
by `src/subscribers/order-placed.ts`, which fires off Medusa's `order.placed` event —
reached through the webhook, never through a success redirect. **No browser is involved at
any point**, which is precisely the failure mode §5.2 rule 2 is about.

## Two findings worth acting on

**1. Medusa's Stripe provider is PaymentIntents + Elements, not Checkout Sessions.**

`research.md` §5.1 recommends Checkout Sessions. Medusa 2.18 does not offer that path: its
provider creates a PaymentIntent, hands the storefront a `client_secret`, and the
storefront confirms it with Stripe's `PaymentElement`. Consequences:

- **PCI scope moves from SAQ A to SAQ A-EP** (§7.5). The card fields are an iframe on
  *your* domain, so your checkout page is in scope and requirements 6.4.3 (script
  inventory and integrity) and 11.6.1 (tamper detection) get materially heavier.
- **The functional argument for Checkout Sessions mostly evaporates**, because Medusa
  already owns cart, tax, discounts, shipping and addresses. That was the reason to prefer
  Checkout — not to rebuild it in your own code. Medusa *is* the thing that owns it.
- **What you give up**: Stripe-hosted conversion tuning, Link, and Adaptive Pricing.

Options: accept Elements and budget the script-control work; or write a custom Medusa
payment provider that redirects to Stripe Checkout and keeps SAQ A, which is more work and
off the ecosystem's beaten path. Recommendation and reasoning are in §5.1.

**2. With `STRIPE_WEBHOOK_SECRET` empty, the webhook endpoint accepts unsigned payloads.**

Measured, not assumed:

```
POST /hooks/payment/stripe_stripe  (no signature)       -> HTTP 200
POST /hooks/payment/stripe_stripe  (bogus signature)    -> HTTP 200
```

No order was created — the fake payload resolves to no payment session — but the endpoint
acknowledged it rather than rejecting it. The secret must be set before this is ever
exposed to the internet. This is §5.2 rule 3 demonstrated rather than asserted.

## Layout

```
spike/
  backend/
    medusa-config.ts                 Stripe provider registration
    .env                             local only, gitignored
    src/subscribers/order-placed.ts  proves webhook -> order; where fulfilment hangs
    src/scripts/seed-spike.ts        US region, $4.99 shipping, one real jersey
    src/scripts/state.ts             writes spike-state.json (idempotent)
    static/jersey.jpg                the product's single image
  verify_flow.py                     drives the purchase path via the Store API
  spike-state.json                   generated ids, so nothing is hardcoded
```

## Running it again from scratch

```bash
docker start aj-postgres aj-redis
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
cd spike/backend
npx medusa db:migrate
npx medusa exec ./src/scripts/seed-spike.ts     # once; errors on re-run (duplicate handle)
npx medusa exec ./src/scripts/state.ts          # any time
npm run dev
```

Stop everything: `docker stop aj-postgres aj-redis` and kill the `npm run dev` process.
Reset the database completely: `docker rm -f aj-postgres` then recreate it.

## Deliberate choices

- **`manage_inventory: false`.** The live store shows "Variant sold out or unavailable" on
  every size because inventory is untracked yet quantity is 0 with a deny policy (§12.1).
  On a sourcing model the product should always be buyable and the honest signal is a lead
  time, not a stock count.
- **No storefront.** The flow is driven through the Store API, which proves the payment
  path rather than a UI and makes the closed-browser case trivial to test. The storefront
  is the next phase, not this one.
- **One image**, per §13.6.

## Known rough edges

- Variants come back from the API **unordered** (`XL, L, S, M, 2XL, 3XL`). The storefront
  must sort by the canonical size order — `tools/out/variants.csv` carries `position` for
  exactly this.
- Product `metadata` set at seed time did not come back on the store endpoint. Irrelevant
  here: the real schema uses first-class columns (`team`, `league`, `player`) rather than
  metadata, which is also what makes facets indexable.
- The publishable key is linked to two sales channels (`Default` and `Web`), so cart
  creation must pass `sales_channel_id`. Worth collapsing to one channel in the real build.


---

## Step 1 — full catalog import

```bash
python3 tools/build_import_json.py                              # from repo root
cd spike/backend
npx medusa exec ./src/scripts/import-catalog.ts                 # idempotent by handle
```

**3,591 products, 23,997 variants, 4,853 images, 0 failures, 34.2 seconds.** Every SKU
unique, every uniqueness constraint satisfied.

Images are **not copied**: `backend/static/media` is a symlink to the archive's blob
directory, so 3 GB stays where it is and Medusa serves it at
`/static/media/<filename>`. In production these move to R2 behind an image transform
layer (§13.2).

The 106 multi-fit products came through correctly — `Fit: Unisex/Youth` as a real option
alongside `Size`, rather than collapsing two genuine variants into one.

## Step 2 — the catalog module

Medusa stays the source of truth for commerce entities. A custom module carries what
Medusa has no place for, as **real indexed columns** rather than metadata — metadata is
not indexable, so facets built on it cannot scale.

```
src/modules/catalog/models/jersey-detail.ts    taxonomy + regulatory block + SEO
src/modules/catalog/models/jersey-request.ts   the request mechanic (§12.1)
src/links/product-jersey-detail.ts             product <> jersey_detail
src/api/store/facets/route.ts                  GET  /store/facets
src/api/store/jerseys/route.ts                 GET  /store/jerseys?league=&team=&q=
src/api/store/jersey-requests/route.ts         POST /store/jersey-requests
```

```bash
npx medusa db:generate catalog && npx medusa db:migrate
npx medusa exec ./src/scripts/populate-catalog-details.ts       # 3,591 in 1.5s
```

Verified against the database: `team=Dallas Cowboys` → 144, `q=allen` → 38,
`league=SOCCER&colourway=yellow` → 14, `league=NFL` → 2,186 with correct paging.
`EXPLAIN` confirms `Bitmap Index Scan on IDX_jersey_detail_team`. EU-ready products: **0
of 3,591**, by design (§13.5).

## Step 3 — storefront shell

```bash
cd spike/storefront && npm run dev            # http://localhost:3000
```

Brand from anyjersey.com, structure from the reference (§12.5, §12.8): **Oswald**
uppercase display, **Inter** body, `#F9E806` as the single action colour, `#108474`,
`#121212` on white.

| Route | What |
|---|---|
| `/` | Announcement, FIND ANY JERSEY hero, trust row, shop-by-league and shop-by-team facets, NFL and Soccer grids, request block |
| `/jerseys` | Faceted listing — league, team, colour, type — with active-filter chips, clear-all and paging |
| `/jerseys/[handle]` | Single image, size **buttons** (unavailable combinations disabled, not hidden), generated description, spec table, related-by-team, request block prefilled |
| `/request` | Standalone request page |

Two details worth keeping:

- **`sortSizes()` is not optional.** The API returns variants unordered (`XL, L, S, M…`).
- **Unavailable size/fit combinations are disabled rather than hidden.** A product with
  Unisex S–2XL plus Youth YS–Y2XL lists all ten values on the `Size` option, so
  Unisex/YS is selectable and does not exist. Hiding it makes the grid jump; disabling it
  explains itself.

Everything blocked on an external input is rendered as a **visible dashed placeholder**
rather than quietly omitted — the personalisation module, the fit guide, the delivery
promise and per-product reviews all say what they need.

## Step 4 — spike fixes

- **Webhook-secret startup guard** (risk #19). `medusa-config.ts` now refuses to boot
  outside development without `STRIPE_WEBHOOK_SECRET`, and warns loudly in development.
  The measured behaviour it prevents: unsigned and forged payloads returning HTTP 200.
- **Single sales channel.** `fix-sales-channels.ts` removed "Default Sales Channel"
  (refusing to delete any channel with products attached). Carts no longer need an
  explicit `sales_channel_id` — verified.
- **Size ordering** handled in the storefront via `sortSizes()`.

## Running the whole thing

```bash
docker start aj-postgres aj-redis
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
cd spike/backend    && npm run dev     # :9000, admin at /app
cd spike/storefront && npm run dev     # :3000
```

## Still open

Kept honest as things closed. Struck-through items are done; see Step 23 for the detail.

| | Needs |
|---|---|
| ~~Cart and checkout UI~~ | ~~Nothing~~ — built (Step 5) |
| Personalisation **print file** | Supplier print-file format. The customer-facing module is built (Step 22) |
| ~~Fit guide~~ | Built at `/size-guide` (Step 23). The **measurements** still need one supplier email, and the page says so rather than inventing a chart |
| ~~Delivery and returns copy~~ | Built at `/shipping` and `/returns` (Step 23), reading the live zone rate card |
| ~~Per-product reviews~~ | Migrated (Step 23) — and the answer was not what this line assumed: **only 17 of the 84 could be attached to a product**, because 39 name none and 28 name shirts we no longer stock |
| Regulatory block | One supplier email (§13.5) — gates EU sales |
| Three EU appointments | IOSS, GDPR Art. 27, GPSR responsible person. Not engineering work; the region picker now shows Europe as unavailable **with the reason** until they exist |


---

## Step 5 — cart and checkout

| Route | What |
|---|---|
| `/cart` | Line items with quantity and remove, **free-shipping progress bar**, totals |
| `/checkout` | Details step (email + US address, autocomplete tokens, real labels) → payment step |
| `/order/[id]` | Confirmation with line breakdown |

Cart id lives in an `httpOnly` cookie; mutations are server actions. **Only `variant_id`
and `quantity` ever cross the wire** — the price is the server's (§5.2 rule 1).

**Free shipping over $75** rather than a percentage code. §9.1 is the reason: a 20% code
gives away $13.00 *and* raises the effective card rate, because the fixed $0.30 does not
shrink with the discount. Free shipping costs $4.99 and protects the processed amount.
The threshold is a placeholder in `lib/cart.ts` until the real number is decided.

Verified with a real cart: 2 × $64.99 → subtotal **$129.98**, free shipping unlocked,
total at the payment step **$134.97** with shipping applied.

The payment step renders Stripe's `PaymentElement`. Without keys it shows a plain
explanation of what is missing rather than an error. With them:

```
storefront/.env.local   NEXT_PUBLIC_STRIPE_PK=pk_test_…
backend/.env            STRIPE_API_KEY=sk_test_…  STRIPE_WEBHOOK_SECRET=whsec_…
```

Note what `StripePayment.tsx` does **after** a successful confirm: it calls
`completeAction()` to give the customer their confirmation page — but the order itself is
created by the webhook. If that call never happens because the tab closed, the order still
exists. That is §5.2 rule 2, in the code rather than in a comment.

## Step 6 — admin sourcing queue

`http://localhost:9000/app/jersey-requests`

A captured request is only worth something if somebody works it, so the admin page is the
queue **plus a demand ranking**: open requests grouped by team and player, ordered by how
many people asked. Verified with seeded data — three separate requests for Randy Moss from
three different sources (`product`, `search_empty`, `collection`) aggregate to
`3× Randy Moss · Minnesota Vikings`.

```
GET  /admin/jersey-requests?status=new     queue + counts + demand ranking
POST /admin/jersey-requests/:id            move status (400 on an invalid one)
```

Admin login for the spike: `admin@anyjersey.local` / `spike1234`.

## Step 7 — accessibility

`python3 spike/a11y_check.py [cart_id]` — a static audit over the rendered pages. It
catches the mechanical failures that are cheap to regress on: missing alt text,
unlabelled controls, heading-order jumps, duplicate ids, icon-only links.

**0 issues across 7 pages.** Fixed in the process:

- `--ink-3` was `#7B7B7B` (4.5:1 on white, borderline) → `#6A6A6A` (5.4:1)
- Disabled size buttons were `color: var(--rule)` — struck through at roughly 1.5:1, which
  tells a sighted user nothing. Now legible, with an `aria-label` explaining *why* it is
  unavailable rather than just that it is
- Size and fit groups are `role="group"` with `aria-labelledby`, plus an `aria-live`
  region announcing the current selection
- Facet links carry `aria-current` and descriptive `aria-label`s including the count; the
  result count is announced via `aria-live`
- Footer section labels were `h3` directly after an `h1` on pages with no `h2` — a real
  heading-order break, fixed at the source rather than by suppressing the warning
- Skip link, one `h1` per page, `<main>` landmark, labelled facet `<nav>`

**Still required by hand**, and not claimed here: keyboard traversal, a screen-reader pass
on the buy box, and colour-contrast verification across every state. WCAG 2.1 AA is a
launch requirement (§7.9), and a static checker is the floor, not the ceiling.


---

## Step 8 — debt paid down

**Global Node repaired.** `brew install node@22` had pulled a newer `simdjson` and left
Node 25 linked against a dylib that no longer existed. `brew reinstall node` fixed it
(and moved it to v26.7.0). The spike still runs on node@22, which is what Medusa
supports.

**Facet filtering pushed into SQL.** `/store/jerseys` was loading all 3,591
`jersey_detail` rows per request and filtering in memory. Now `listAndCountJerseyDetails`
does filtering, counting and pagination in the database, with `$ilike` across the parsed
fields for free text. Identical counts (144 / 38 / 14 / 3,591) and 20 deep-offset
requests in 0.585s total. Free text still cannot use an index — that is what Typesense
is for (§4).

**Vocabulary fix — and the reason the 221 were unresolved is not what I assumed.** They
are mostly **misspellings in the source catalog**:

| In the catalog | Should be | Products |
|---|---|---|
| Philidelphia Eagles | Philadelphia Eagles | 35 |
| Norte Dame Fighting Irish | Notre Dame Fighting Irish | 33 |
| Boston Red Socks | Boston Red Sox | 13 |
| Tejas Rangers | Texas Rangers | 7 |
| Flordia Gators | Florida Gators | 7 |

Those titles are misspelled for customers and for search engines too, so they are worth
fixing at source. Until then `vocab.py` maps them. Added alongside: historic franchises
(Houston Oilers, St. Louis Rams), programme names without the mascot ("Arizona State"),
and a `CITY_SPORT` map for titles like "Adley Rutschman Baltimore Baseball Jersey" —
resolved **only** where a city has exactly one franchise in that sport, so New York, Los
Angeles and Chicago baseball stay unresolved rather than guessed.

Result: team **94% → 98%**, league **95% → 98%**, `needs_review` **262 → 128**.

`sync-catalog-details.ts` propagates a parser change into the database, writing only rows
that actually differ and never touching the regulatory columns. Two bugs surfaced doing
it:

- **Slugs move when the parser improves** — 1,411 of 3,591 no longer equal the original
  Shopify handle. Free on a greenfield store, but it means a re-sync cannot key on
  handles.
- **The original populate script wrote the *slug* into `source_handle`** instead of the
  Shopify handle, so that column was not a stable key either. Repaired on 1,525 rows.
  The sync now joins on **title**, which comes from the source and does not move.

Database and CSV now agree exactly: 128 needs_review, 87 without a team, 3,591 total.

### A finding worth acting on: 21% of the catalog is duplicated

**328 exact duplicate titles covering 764 products.** "Las Vegas Raiders Black Shorts"
exists 6 times; "2026 World Cup Lionel Messi Team Argentina Blue Jersey" 5 times. 314 of
the 328 groups share an identical price, and **313 have *different* image sets**.

Two consequences, one of them useful:

- Duplicates split reviews, compete with each other in search and on facets, and inflate
  the catalog count by roughly a fifth.
- **Merging them would give 764 products more images without any photography** — three
  listings with two photos each become one product with up to six. That is the single
  cheapest route to improving on the one-image decision (§13.6).

**Done in step 10.**

## Step 9 — shipping zones

```bash
npx medusa exec ./src/scripts/seed-shipping-zones.ts     # idempotent
```

| Zone | Region | Rate | Free over |
|---|---|---|---|
| 1 | United States | $4.99 | $75 |
| 2 | Canada | $19.99 | $150 |
| 3 | United Kingdom · Europe (27) | $24.99 | $175 |
| 4 | Asia Pacific (6) | $29.99 | $200 |

Verified with a Berlin address: only the Europe option is offered, at $24.99, cart total
$89.98. Rates are freight only — import VAT and the €3 EU customs duty are separate
checkout lines via IOSS (§7.2), so nobody is ambushed on delivery.

The numbers behind the rate card, and why $4.99 cannot be extended internationally, are
in **research.md §14**. The headline: a 1 lb parcel to the EU costs $25–37, which is
38–57% of the product price, and a $64.99 jersey lands at about **$112** in Germany once
VAT and duty are added.


---

## Step 10 — duplicates merged

```bash
python3 tools/dedupe.py                 # report only
python3 tools/dedupe.py --write         # rewrite the CSVs
python3 tools/build_import_json.py
cd spike/backend
npx medusa exec ./src/scripts/apply-dedupe.ts                    # dry run
APPLY=1 npx medusa exec ./src/scripts/apply-dedupe.ts
APPLY=1 npx medusa exec ./src/scripts/prune-orphan-details.ts
```

| | Before | After |
|---|---|---|
| Products | 3,591 | **3,155** |
| Variants | 23,997 | 21,188 |
| Duplicate titles | 328 | **0** |
| One image | 2,607 (73%) | 2,174 (69%) |
| 3+ images | 130 | **247** |

Merged, not deleted: one survivor per title keeps its taxonomy and copy, and the other
listings' images and sizes fold into it, deduplicated by `sha256`.
`tools/out/merge_log.csv` records all 436 merges, and re-running `tools/extract.py --write`
regenerates the un-merged CSVs — so this is reversible.

Verified after: 3,155 products, 3,155 `jersey_detail` rows, **0 duplicate titles**, facets
recounted (NFL 2,237 → 2,018; Dallas Cowboys 144 → 98), storefront healthy.

**Two bugs found and fixed while doing it:**

- **Deleting a Medusa product does not cascade to a linked custom module.** 436
  `jersey_detail` rows were orphaned, which silently inflated every facet count —
  `/store/facets` kept reporting 3,591. `prune-orphan-details.ts` fixes it and should run
  after any bulk product delete.
- **`dedupe.py`'s histogram only printed buckets 1–6**, hiding a tail that goes up to 26
  images on one product. It briefly looked like the image update had double-applied; it
  had not — the database matched the CSV exactly. Fixed so the tail cannot hide again.

**On the size of the win, honestly:** 649 images were redistributed and products with 3+
images went from 130 to 247, but the single-image share only fell from 73% to 69%. Merging
was worth doing for its own reasons — duplicates split reviews and inflated the catalog by
a fifth — but roughly seven products in ten still have one image. It does not solve the
photography gap.


---

## Spike vs production — what still separates them

A spike proves the pieces connect. It is not a smaller version of production; it is a
different thing with different goals. This one did its job: it found five real bugs and
overturned three assumptions I had written into the research before building anything.

What it is **not** is roughly 70% of the work, and almost none of that 70% is interesting.

### Infrastructure

| Spike | Production |
|---|---|
| Postgres and Redis in Docker on one laptop | Managed Postgres with automated backups, point-in-time recovery and a **tested** restore drill |
| Images served from a symlink into `~/Downloads` | R2 behind an image transform layer, immutable cache headers |
| `.env` files | A secret manager, rotation policy, no live keys on a laptop |
| `npm run dev` | CI, staging, reversible migrations, a rollback you have practised |
| Node 22 via a `PATH` export | Pinned in a container or `.nvmrc`, enforced in CI |
| Nothing watching | Sentry, uptime alerts, log aggregation, an on-call rotation |

~~Medusa says it out loud on every boot: *"Local Event Bus installed. This is not
recommended for production."* Jobs run in-process, so a restart loses queued work.~~
**Fixed.** `medusa-config.ts` registers `event-bus-redis`, `cache-redis`,
`workflow-engine-redis` and `locking-redis` whenever `REDIS_URL` is set, and production
refuses to boot without it. Setting `projectConfig.redisUrl` — which was what had been
done — does not switch any of them, which is why the announcement kept appearing next to a
configured Redis.

### Correctness

- ~~There are no tests. Zero.~~ **201 tests**: 144 unit and **57 integration against a
  real database**, including the checkout path end to end (steps 13 and 19).
- ~~The facet cache lives in process memory, so two app instances would disagree.~~
  **Fixed.** Facets, the sitemap, curated collections and store reviews all read through
  `src/cache.ts` onto Medusa's cache module — in-memory on one instance, Redis on several.
- ~~`/store/jersey-requests` has no rate limit — a public POST endpoint that writes rows.~~
  **Fixed**, and then extended: every unauthenticated write is limited, plus
  `/store/order-lookup`, which is a read that walks a sequential id space.
- ~~Free-text search is `ILIKE '%…%'`, which cannot use an index.~~ **Indexed.**
  `Migration20260905101500` adds `pg_trgm` and a GIN index on `search_text`; the planner
  moves from a sequential scan to a bitmap index scan on any query of three characters or
  more, verified with `EXPLAIN` against Postgres 17. Typesense is still the better answer
  at 40,000 products (§4), and is no longer the *only* answer.
- Scripts are idempotent by convention, not by constraint.

### Commerce

Written when almost none of this existed. Kept, with what happened, because the shape of what
remains is more useful than a clean list.

| | |
|---|---|
| ~~**Transactional email**~~ | 8 templates, wired to 6 triggers. Needs `RESEND_API_KEY` (Step 12, 23) |
| ~~**Fulfilment**~~ | Rating is live off our own rate card; labels and tracking need `SHIPPO_API_KEY` (Step 21) |
| ~~**Returns and exchanges**~~ | Built end to end, customer-initiated, with an admin queue (Step 23) |
| ~~**Tax**~~ | `tax-stripe` module written and tested; needs `STRIPE_TAX_ENABLED` and an account (Step 21) |
| ~~**Personalisation**~~ | Built per the spec. Only the production print file is blocked, on the supplier's format (Step 22) |
| ~~**Customer accounts**~~ | Login, registration, order history, password reset (Step 23) |
| ~~**Region switching**~~ | Five regions live in the storefront, with the two EU-gated ones shown as unavailable and why (Step 23) |
| ~~**Discounts**~~ | Codes applied through Medusa's promotion engine; free-shipping thresholds remain the preferred mechanic per §9.1 (Step 23) |
| ~~**Abandoned cart**~~ | Capture and a recovery email (Step 15) |
| **Inventory** | Still `manage_inventory: false` everywhere — a decision, not yet a system |

### Compliance — most of §7 is now implemented; the rest is not engineering

| | |
|---|---|
| ~~Cookie consent, Global Privacy Control~~ | Opt-in, GPC honoured silently and without a banner (Step 21) |
| ~~PCI SAQ A-EP script controls~~ | CSP with every entry justified, now environment-derived rather than pinned to localhost (Step 21, 23) |
| ~~Privacy policy, terms, refund policy~~ | Published, with outstanding trader details shown as gaps rather than guessed. **Unreviewed drafts** until a lawyer reads them (Step 23) |
| ~~Contrast audit~~ | Automated and in CI; found and fixed one real 1.27:1 failure on form control borders (Step 23) |
| **Manual screen-reader pass** | Still outstanding. The mechanical audit now covers 18 pages and landmark/grouping/live-region behaviour, which narrows what a human has to listen for |
| **Invoice generation** | Only required for EU B2C; a US-first launch does not need it |
| **IOSS registration** | Not engineering. Gates EU revenue |
| **GDPR Article 27 representative** | Not engineering. Gates EU revenue |
| **GPSR responsible person** | Not engineering. Without it, apparel cannot lawfully be placed on the EU market at all |

The last three are appointments, they can start today, and the storefront now refuses EU
addresses and says which of them is missing rather than quietly accepting an order it cannot
lawfully ship.

### Data

128 products still flagged `needs_review`; 69% have one image; the regulatory columns are
empty on all 3,155; and the licensing position is unresolved.

~~No reviews migrated~~ — 84 imported (Step 23), of which 17 attach to a product. 56 titles
also carried an invisible U+FFFC from the Shopify export and have been cleaned.

### How far along is it, honestly

§9.4 estimated 21 engineer-weeks to launch. This paragraph said **5–6 of those** when the
list above was accurate; email, fulfilment, tax, personalisation, returns, accounts, the
storefront compliance surface and 460 tests have since been built, which is most of what it
named.

What is left is a different kind of work, and worth being precise about, because none of it
is the interesting part:

| | |
|---|---|
| **Infrastructure** | Managed Postgres with a *tested* restore drill, a secret manager, CI-to-staging, a practised rollback, uptime alerting. Nothing here exists |
| **Keys** | Stripe, Resend, Shippo, Stripe Tax. Every module behind them is written and tested; five of nine integrations block a production boot |
| **R2** | ~~Marked critical in production and **not implemented**~~ — **built.** `src/object-store.ts` writes and reads through the S3 API, `MEDIA_BACKEND` is read by `src/media-store.ts`, and the `R2_*` keys are critical exactly when that flag selects them. Postgres remains the default; the switch is now a decision after a restore drill rather than a project |
| **Search** | Typesense is listed with no code behind it. Free-text search is `ILIKE '%…%'` and now has a trigram index behind it, so it is a bitmap index scan rather than a sequential one |
| **Supplier inputs** | Print-file format, fibre composition, country of origin, HS codes, size measurements. One email, and it unblocks EU sales, the size guide and personalisation printing |
| **Legal appointments** | IOSS, Article 27, GPSR. Not engineering, can start today, and they gate EU revenue |
| **Licensing** | Unresolved, and printing a player's name makes the §13.9 question sharper rather than softer |
| **By hand** | A screen-reader pass and a keyboard traversal |

**What the spike bought**, which is the point of building one: it proved the payment path
before any design work, established that Medusa's Stripe provider forces SAQ A-EP rather
than SAQ A (§5.1 — a conclusion that changes the compliance budget), measured that an
unsigned webhook returns HTTP 200 when the secret is unset, and surfaced that 21% of the
catalog was duplicated. Every one of those was cheaper to learn now than in month four.


---

## Step 11 — bug sweep

Four fixed. The first was live and silent.

**1. Listings returned fewer products than they claimed.** `/store/jerseys` joined
`jersey_detail.source_handle` to `product.handle`. Those diverged the moment
`source_handle` was repaired to hold the true Shopify handle, because product handles are
generated slugs — only **2,035 of 3,155 matched**. Nothing errored: the count was correct
and the grid was short. The homepage showed 6 cards instead of 12, `/jerseys` 11 instead
of 24, and pagination skipped rows. Now the route filters through the product ↔
jersey_detail **link**, which is what the link is for. Verified: every query returns as
many products as it claims, at every offset.

The lesson, twice learned: **slugs are derived data and must never be a join key.**

**2. The cart promised free shipping it could not honour.** `FREE_SHIPPING_OVER = 75` and
`money(4.99)` were hardcoded in the storefront, so a European cart would have offered free
shipping over $75 on an order costing $24.99 to ship. There is now one source of truth
(`backend/src/shipping-zones.ts`), a `/store/shipping-zones` route, and the cart reads its
region's rate and threshold.

**3. Facets recomputed on every request** — all 3,155 rows, every call. Now cached for five
minutes with an `x-facet-cache` header. The real answer is a search engine that computes
facets natively (§4), said so in the code rather than left to be discovered.

**4. A youth size did not imply a youth fit.** Bare `YS` returned
`group=youth, fit=unisex` while `Youth S` returned `youth/youth`, so a product carrying
both listed YS under the **Unisex** option — a customer picking Unisex saw a youth size as
available. 215 variants across 54 products. Caught by a unit test, not by looking.

## Step 12 — Resend email

```
src/modules/resend/
  templates/index.ts   order-placed · request-received · request-sourced
  service.ts           the provider
  index.ts             ModuleProvider registration
```

**Safe without credentials.** With `RESEND_API_KEY` empty the provider renders the email,
logs a summary, and reports success — no network call. That keeps the spike runnable, and
more usefully a missing key in staging produces a visible log line instead of a crashed
checkout.

It refuses to be silent where it matters: **outside development a missing key throws at
boot**, because quietly discarding order confirmations is worse than failing to start.
`RESEND_REDIRECT_TO` routes every message to one inbox for staging.

Wired into three places, each wrapped so a failed send can never fail the thing that
matters:

| Trigger | Template |
|---|---|
| `order.placed` (reached via the Stripe webhook) | `order-placed`, with the zone's lead time |
| `POST /store/jersey-requests` | `request-received` |
| Admin moves a request to `fulfilled` | `request-sourced`, only on the transition |

Templates are plain functions returning `{ subject, html, text }`. Every one ships a text
part — transactional mail without one lands in spam more often. None of them claims a
delivery date, a fabric, or a licence (§7.10).

Placeholders live in `backend/.env`:

```
RESEND_API_KEY=
RESEND_FROM=orders@findanyjersey.example
RESEND_REPLY_TO=support@findanyjersey.example
# RESEND_REDIRECT_TO=you@example.com
```

## Step 13 — unit tests

```bash
./test.sh          # everything
```

**145 unit tests, three runners, because three languages.** Integration tests are step 19.

| Suite | Runner | Tests | Covers |
|---|---|---|---|
| `tools/tests/` | python unittest | **76** | title parsing, size normalisation, SKU generation, description and SEO generation, duplicate merging |
| `spike/backend/src/**/__tests__/` | jest | **45** | email templates, Resend provider behaviour, shipping zone rate card |
| `spike/storefront/lib/` | vitest | **23** | size ordering, money formatting, listing query building |

The tests are written around invariants that have already broken in this project, not
around whatever the code currently returns:

- **Sizes** — `Mens S` and `Womens S` must stay two variants; junk like `A` or `YLYXL`
  must be flagged rather than guessed; a youth size implies a youth fit.
- **SKUs** — deterministic, and 12,000 generated ones must contain no collision.
- **Money** — `cents('19.99')` is 1999, not 1998; `money(null)` is an em dash, because
  showing `$0.00` for "unknown" is a pricing bug on the page.
- **Descriptions** — deterministic per product, ~99% distinct across a sample, and they
  must **never claim a size the product does not stock**, which is a misleading-claim
  problem rather than a copy nit.
- **Merging** — no image lost, no SKU collision, positions contiguous, collection
  membership follows the survivor, and running it twice changes nothing.
- **Shipping zones** — no country in two zones, thresholds rise with the rate, the UK is
  separate from the EU, and every international zone tells the customer that duties are
  collected at checkout.
- **`sortSizes`** — because the API genuinely returns variants unordered.

Three bugs were found by writing these, not by reading the code: the youth-fit
inconsistency above, `money(69.985)` rendering `$69.98` because `toFixed` delegates
rounding to binary floating point, and two of my own assertions that were wrong rather
than the code — `width="100%"` in an email table is not a fabric claim, and not every
sentence template mentions the colourway.

**What these tests do not cover**, stated plainly: nothing touches a database, nothing
exercises checkout end to end, and there is no test that a real Stripe payment produces an
order. Those are integration tests, and they are still missing.


---

## Step 14 — search, sort and pagination

Decided by looking at anyjersey.com's collection page again, which turned out to be the
most useful comparison available.

### What that page shows

`/collections/find-any-player` lists **3,636 products across 228 pages of 16**, with
Shopify-native filters offering **Sport: Baseball 23, Basketball 4**. Out of 3,636. Those
filters run on the metafields that are populated on ~60 products, so filtering by sport
surfaces **under 1% of the catalog**. There are still "sold out" badges on the grid.

So the live store is ahead in two places and far behind in two others:

| | anyjersey.com | this build |
|---|---|---|
| Facets that cover the catalog | Sport: 27 of 3,636 | NFL 2,018, teams 100+ each |
| Per page | 16, across 228 pages | 24, windowed |
| **Sort** | **8 options** | **was: none** |
| **Search** | **in the nav** | **was: none** |
| Sold out shown | yes | never |
| Products with a description | ~178 | 3,155 |

The glaring one is search. **A store called Find Any Jersey had no search box** — the API
supported `q` and nothing in the UI used it. That decided what came next.

### Built

- **Search box** in the header, in the hero (as the primary action, because finding *is*
  the proposition) and on the listing page. A plain GET form, so it works before
  hydration and produces a shareable URL.
- **Sort** — Featured, Newest, Oldest, Name A–Z, Name Z–A. An unknown value falls back to
  Featured rather than erroring. **No price sort**, deliberately: 1,037 of 1,084 products
  share the $64.99 price point, so ordering by price would be theatre. It goes in the day
  the catalog has real price spread.
- **Windowed pagination** — `← Prev 1 … 49 50 51 52 53 … 85 Next → 1201–1224 of 2,018`.
  A 228-page list with no window is unusable past page three.
- **Empty results route into the request block** with `source=search_empty`, so a miss
  becomes a demand signal rather than a dead end.

### The bug that mattered more than the feature

`q=romario` returned nothing. Postgres `ILIKE` does not match `romario` against
`Romário`, and **nobody types the accent**. Nine products were affected — but they are
José Altuve, Julio Rodríguez, Ronald Acuña Jr. and Romário, which is precisely who gets
searched for.

Fixed with a folded `search_text` column on `jersey_detail`: accent-stripped, lowercased,
holding team + player + colourway + season + league + garment, folded once at write time
rather than on every query. Six unit tests cover it, including names the catalog will grow
into — Mbappé, Müller, Özil, Håland.

It also made multi-word search work, which it had not before: one folded haystack instead
of four separate ILIKEs, so `q=buffalo bills` now returns 68 rather than 0.

| Query | Before | After |
|---|---|---|
| `romario` | 0 | 1 |
| `jose altuve` | 0 | 6 |
| `acuna` | 0 | 6 |
| `rodriguez` | 0 | 13 |
| `buffalo bills` | 0 | 68 |
| `allen` | 35 | 35 |

### One RSC mistake worth recording

I passed a URL-builder function from the server-rendered listing page into the client-side
sort control. React Server Components forbid that, and the whole route 500'd. The control
now reads `useSearchParams` and builds its own URL. Functions do not cross that boundary.


---

## Step 15 — filling the admin gaps

§15.3 of research.md listed what Medusa's admin does not have. Three of those are now
built, plus the fixture tooling to prove they work.

### Reports — the gap §15.3 calls the big one

`/app/reports` · `GET /admin/reports/overview?days=30`

Stat tiles for the headline figures — revenue, orders, AOV, units, shipping and tax
collected — because a single number does not need a plot. Then orders per day as a bar
chart, and ranked horizontal bars for **revenue by league, team and colourway**.

That last breakdown only exists because the taxonomy was derived in §13.3. **The same
report on the live Shopify store would be blank**: those fields are populated on ~60 of
3,636 products there.

It also surfaces the request queue as *"Source these next"* — open requests ranked by how
many people asked. No conventional store can show that, because the mechanic does not
exist there.

Chart decisions, made by procedure rather than taste:

- **One series, so no legend** — the heading names it.
- The data hue is **`#0E9E88`**, not the brand's `#108474`. The brand teal fails the
  chroma floor at 0.097 and reads grey as a data mark; `#0E9E88` is the same family and
  validates clean against **both** the light and dark admin surfaces. Checked with a
  validator rather than eyeballed.
- Thin bars anchored to the baseline, 4px rounded data-ends, a 2px gap, a recessive
  baseline and no gridlines behind 30 bars. Hit targets are full-height, larger than the
  marks.
- Every bar carries a `<title>`, so hover and screen readers get the same value, and a
  **View as table** toggle gives a non-visual reading of the series.
- Empty days are rendered as zero rather than skipped, so the chart cannot lie by omission.

### Abandoned carts — native in Shopify, absent in Medusa

`/app/abandoned-carts` · `GET /admin/abandoned-carts?hours=1` ·
`POST /admin/abandoned-carts/:id/recover`

Carts with items, an email, no completed order, idle longer than the window. **66 carts,
$8,473.70 recoverable** against the seeded fixtures. Recovery sends once and stamps the
cart; a second attempt returns 409 unless forced — a duplicate "you left something behind"
email is a good way to lose the customer you were recovering.

The email carries **no countdown, no invented scarcity and no discount** nobody decided to
give. Those are blacklisted outright in the EU and actionable in the US (§7.10), and six
unit tests assert their absence. It points at the request mechanic instead.

### Integrations — placeholders, visibly

`/app/integrations` · `GET /admin/integrations`

Ten external services, every key a placeholder in `.env`, each one showing what it does
and which variables are missing. **5 of 10 block production** under the Postgres media
default — Stripe, Resend, Stripe Tax, Shippo and Redis — and six when `MEDIA_BACKEND=r2`
selects Cloudflare R2.

The rule, in `src/integrations.ts`:

- **Missing in development** → the feature degrades visibly and logs what it would have
  done. Nothing silently no-ops.
- **Missing in production** → `assertConfigured()` throws at boot for anything critical. A
  key that quietly disables order confirmations, tax calculation or fraud screening is
  worse than a container that refuses to start.

`assertConfigured()` is called from `instrumentation.ts`, which Medusa invokes at the top of
`medusa start`. It spent a long time being exported and called from nowhere — the rule above
was documentation rather than a control, and `criticalInProduction: true` changed one number
on the admin dashboard and nothing else. The gap was invisible because two module
constructors guard themselves, so boot *did* fail without Stripe or Resend; it would have
started perfectly happily with no Stripe Tax and no Shippo, and taken orders with tax
uncalculated and no way to buy a label.

This exists so "is Stripe Tax on?" is answerable without reading a `.env` over somebody's
shoulder.

### Fixtures

```bash
ORDERS=40 ABANDONED=12 npx medusa exec ./src/scripts/seed-orders.ts
```

Creates completed orders through the **system payment provider**, so no Stripe key is
needed, plus abandoned carts. Fixtures, not a simulation — the point is enough shape in
the data that a broken report looks broken.

### Five bugs found doing this

**1. Two shipping profiles.** 3,154 products on one, one product and a stray option on
another. A cart cannot be fulfilled by an option on a different profile, which is what
*"The cart items require shipping profiles that are not satisfied by the current shipping
methods"* means — **39 of 40 seeded orders failed on it.** Consolidated by
`fix-shipping-profiles.ts`.

**2. That fix left one product with no profile at all**, because `shipping_profile_id` is
not filterable on `product` in `query.graph`, so the count came back 0 and nothing moved.
An unfulfillable product that would have failed at checkout. `fix-orphan-profiles.ts`
detects it by asking which products have no *live* profile.

**3. `Number(x) || fallback` is wrong when 0 is legitimate.** `hours=0` on the abandoned
carts endpoint silently became `hours=1` and returned **3 carts instead of 66**.

**4. Medusa returns order totals as decimal strings** (`"69.980000000000000000"`), so
`revenue += total` was string concatenation. The report showed **$204.59 — exactly the
shipping total — as revenue.** Every numeric is coerced now. The JS-side echo of §6.2.

**5. Computed fields do not resolve when requested individually.** `items.quantity` and
`items.subtotal` come back empty unless you ask for `items.*`, and cart item subtotals
need the cart's own totals requested too. Both failed silently, as zeros.

Two more that cost time without being bugs: order queries need `version` in the field list
or they fail with *"Shipping method version is required to load adjustments"*, which names
nothing useful; and a test I wrote caught my own later change, when adding the
`cart-recovery` template broke the registry assertion. That is the test suite doing its job.


---

## Step 41 — an order register, and two bugs it found

Medusa has an orders screen. What it has no answer for is the question a register exists to
answer — *show me every order in a period, with the money broken out and the things that stop
it shipping visible* — and it has no export at all, which is the half a bookkeeper and a
picker both need.

Same routing call as Step 40, for the same reason: this is **`/admin/order-list`**, not
`/admin/orders`. A route file of ours on Medusa's path registers a second handler, one of the
two wins on load order, and whichever loses is the admin's own orders screen rendering blank
columns. The screen is labelled *Order register* rather than *Orders*, because Medusa's screen
is still there and is still where an order is actually worked.

### Status is derived, and that is the whole risk

`payment_status` and `fulfillment_status` are computed properties on Medusa's order DTO, and a
computed field that does not resolve through `query.graph` comes back `undefined` rather than
erroring — the trap this README records at every layer, and the one that once produced a cart
page showing $0.00 above a $4.99 total. So both are derived from `payment_collections` and
`fulfillments`, which are ordinary relations.

A derivation is only better than the trap if it is checked, and this one was written against a
database that had already gone unreachable. Checking it is what found the two bugs below.

### Bug one: the refund branch could never fire

`paymentState()` summed `captured_amount` and `refunded_amount` off each **payment**:

```
const captured = payments.reduce((s, p) => s + num(p.captured_amount ?? 0), 0)
const refunded = payments.reduce((s, p) => s + num(p.refunded_amount ?? 0), 0)
if (refunded > 0 && captured > 0 && refunded >= captured) return 'refunded'
```

`payment` has no such columns. Checked against the running database:

```
              Table "public.payment"
 id | amount | currency_code | provider_id | data | captured_at | canceled_at | ...
```

On the Payment model both figures are *computed* from the `captures` and `refunds` relations,
so neither arrives through `query.graph` even under `.*`. Both sums were therefore always 0,
the branch was unreachable, and **a fully refunded order reported as `paid`** — on the screen
a bookkeeper reconciles from, and worse because Step 38 made refunds actually execute.

`payment_collection` carries `authorized_amount`, `captured_amount` and `refunded_amount` as
ordinary stored numeric columns. The totals now come off the collection, and the branch has
six unit tests including a partial refund, a refund with nothing captured behind it, and the
`numeric`-as-string case.

### Bug two: the Subtotal column double-counted shipping

The money is broken out because a total is not what anybody reconciles against — tax,
shipping and discount each land in a different place in a bookkeeper's month. The register
asked Medusa for `subtotal` and `shipping_total`. Measured against a real two-item order:

| Field | Value |
|---|---|
| `item_subtotal` | 129.98 |
| `shipping_subtotal` | 4.99 |
| `subtotal` | **134.97** |
| `total` | 134.97 |

**Medusa's `subtotal` already includes the shipping.** So the export invited exactly the
addition it was built to prevent: 134.97 + 4.99 = 139.96 against a total of 134.97, wrong by
the shipping on every row of every month. It now reads `item_subtotal` and
`shipping_subtotal` — both net of tax, which is why `tax_total` is a column of its own and the
four add up. An integration test asserts the identity rather than the columns:
items + shipping + tax − discount = total.

### What the verification established

| | |
|---|---|
| **`authorized`, not `paid`** | `@medusajs/payment`'s system provider authorises and does not capture, so a completed test order lands on `authorized`. Stripe's provider captures on confirm and reads `paid`. The assertion that carries the weight is that it is **not** `not_paid` — the column default, and exactly what a failed resolution produces, silently |
| **The parcel lifecycle** | unfulfilled → fulfilled → shipped → delivered, driven through Medusa's own admin endpoints against real fulfilments. `delivered` outranks `shipped` deliberately: a partly delivered order is still in motion |
| **Personalisation is upper-cased at capture** | the line export carries `name: ALLEN`, not `name: Allen`. A print file is not the place to preserve the casing somebody happened to type, and the export is what a printer works from |
| **The two shapes stay different** | one row per order reconciles a month; one row per line picks and packs. The order-level money is absent from the line file, asserted on the header, because summing it would double-count shipping on every row |

### Two exports, deliberately

`?rows=orders` is one row per order. `?rows=items` is one row per line — what a shop picks
and packs from, and what Shopify's own order export produces. Neither substitutes for the
other, and the line file carries the personalisation on the line it gets printed on; a picker
holding only the register has to open every order to find it.

Both are **`privacy:read`**, owner-only, and the list is `order:read`, which Staff already
has for the revenue report. A register carries every customer's name, address and phone
arranged differently — the same personal data the customer export does — so gating it on
`order:read` would give the bulk extract a second door with a weaker lock. `rbac.spec.ts`
asserts both halves of that split, next to the customer-list pair.

### A note for whoever writes the next suite

**The integration runner truncates the database between tests.** Measured, not assumed: an
order created in one test is gone by the next, and `/admin/orders` agrees with the register on
that at every step. Three tests in the first draft of `orders.spec.ts` asserted on "the orders
that exist" and read 0 or 1 — which looks exactly like a broken endpoint and cost an hour of
chasing one. Every test builds the orders it counts. The comment in `customers.spec.ts` saying
data is kept across a file is misleading; its own tests are all self-sufficient, which is why
they pass.

---

## Step 40 — a customers screen with the numbers on it

Medusa ships a customers screen. It lists the `customer` table, and everything an operator
opens a customer *for* — how much they have spent, how many orders, when they first bought,
whether they may be marketed to — lives in three other modules and is on none of it.

### Not `/admin/customers`

The obvious path is Medusa's. A route file of ours there registers a second handler on it, one
of the two wins depending on load order, and whichever loses is the admin's own customers
screen rendering blank columns — a failure that reads as missing data rather than a routing
collision. So this is `/admin/customer-list`, the same call the storefront's
`curated-collections` makes for the same reason. Medusa's screen still works; this is the one
with the numbers.

### Guests are customers, and that changes the whole shape

The shop has no account requirement (§12.1), so a list filtered to real accounts hides almost
every buyer. Medusa does create a `customer` row for a guest checkout — but it does **not**
copy the order's shipping address into `customer_address`, and a guest row carries no
`first_name` either. The first version read only `customer.addresses` and produced a screen
where most rows had a blank name and a blank location.

So the address is the saved one where there is a saved one, and the most recent order's
otherwise. Shopify shows a guest's address on the same screen for the same reason: it is the
address a courier used, which is the one somebody is asking about.

### Three marketing states, not a checkbox

| | |
|---|---|
| **Subscribed** | A newsletter signup that has not been withdrawn. Consent. |
| **Soft opt-in** | Has ordered, never signed up. PECR reg. 22(3): receives the cart-recovery email and nothing else. |
| **Unsubscribed** | Withdrew, anywhere. Suppression is marketing-wide by design, so one refusal covers every commercial message. |

Shopify shows subscribed or not. This shop actually sends on two different bases, and
flattening them into one flag is precisely how somebody ends up mailing a person who opted out.

### The export is a different act from the list, and is gated as one

Reading the list is `customer:read` and Staff has it — answering "where is my order" starts
with finding the person, and a role that cannot do that is not a role.

The CSV is **`privacy:read`**, owner-only. Taking every customer's name, address, phone and
email off the system in one file is the same act `/admin/privacy/subject` is owner-only for,
and reusing that permission rather than inventing an `export` operation keeps *one* answer to
"who can extract customer data in bulk" instead of two that drift apart. It is logged with who
took it and how many rows — Art. 5(2) is accountability, and a bulk extract with no record of
who took it is the gap that turns a lost laptop into an unanswerable question. And it exports
the **selection**, not the base: narrowing the filters narrows the file, which is the Art.
5(1)(c) half.

### Two things that are always wrong in a hand-written CSV

**Escaping**, which is not an edge case here — addresses contain commas and names contain
apostrophes, so it is most of the file. RFC 4180: quote on comma, quote, newline or
surrounding space; double an embedded quote.

**Formula injection**, which is worse. A cell beginning `=`, `+`, `-` or `@` is executed when
the file opens in Excel or Sheets — and the customer chooses their own name and address. That
makes the export a stored-injection sink pointed at whoever opens it, and the shop would never
see it happen. A leading tab neutralises it and is invisible in the cell. There is an
integration test that puts `=HYPERLINK("http://evil","click")` through the storefront as a
name and asserts no cell in the resulting file starts a formula.

### Three things the tests found

**Amount spent is computed, not stored.** Medusa v2 has no `order.total` column — totals live
in `order_summary.totals` as JSON whose shape is an internal detail. Aggregation goes through
`query.graph` like `/admin/reports/overview`, and carries the same honest `_performance` note
about where that stops being free.

**A total across currencies is a wrong number, not a rounded one.** Multi-currency is deferred,
so in practice every order is USD — but "in practice" is how wrong totals ship. A customer with
orders in more than one currency gets `amount_spent: null`, rendered "—" and left blank in the
CSV. A spreadsheet sums that column, and a fabricated zero is a wrong total nobody questions.

**Two orders can share a `created_at` to the millisecond.** When they do, a timestamp-only sort
is stable and keeps the query's order — which put the *older* order first and made the screen
report a customer's last order as their first. A test placing two orders back to back caught
it; `display_id` settles the tie.

Missing values sort last in **both** directions, for the same class of reason. A customer who
has never ordered has no last-order date, and treating that as a very old one puts them at the
top of "oldest last order" — an answer that reads as real and is not one.

### One test that was passing for the wrong reason

The paging test asserted a page of one against whatever customers earlier tests had left
behind. It passed. Run alone it failed against an empty base, for no visible reason. It creates
its own two customers now.

Two more asserted things that were never this code's to get right: the BOM check was reading
a body axios had already stripped the BOM from (`utils.stripBOM`), so it was testing axios
against a server that was sending it correctly — it reads the raw bytes now; and the
mixed-currency check searched the whole line for `0.00`, which a timestamp contains.

---

## Step 39 — rate limiting that is a limit

The application had thirteen rate limits. Two things were wrong with them, and the second one
was worse than having none.

### The counter was per process

Stated honestly in the file and left open, because the deferral had a real reason: Medusa's
`ICacheService` has `get`, `set` and `invalidate` and no atomic increment, so a counter built
on it is a read-modify-write that undercounts exactly when it is under load. The note also
said what a correct version wants — `INCR`/`EXPIRE` against ioredis — and Redis has since been
registered for four other jobs, so the reason had expired.

One Lua script, one round trip:

```lua
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}
```

`INCR` then `EXPIRE` as two commands leaves a window where a crash between them produces a key
with no expiry, and that key refuses its caller forever. `PTTL` is in the same script so
`Retry-After` describes the window the count actually belongs to.

Three deliberate choices around it. The window is **fixed**, matching the in-process version
exactly — a sliding window is more accurate at the seam and costs a sorted set per caller, and
two backends disagreeing about what a budget means would be worse than either. Redis is
**excluded in test**, mirroring `medusa-config.ts`, because `__reset()` clears a local map and
not somebody else's Redis and the suites would become order-dependent. And when Redis is
unreachable the limiter **falls back to the local counter** rather than failing open: a real
local limit beats no limit, and a Redis blip should not close the shop. `enableOfflineQueue:
false` is what makes that work — the default queues commands while disconnected, which would
turn every limited request into a hang with nothing to fall back *from*.

### The key was the storefront, not the customer

This is the one that mattered.

Almost nothing this storefront does reaches the backend from a browser. The session token is
httpOnly and never enters client JavaScript, so every authenticated call is made server-side;
so is every cart mutation and the whole of checkout. From the backend's side all of it arrives
on one socket from one address.

A per-IP budget applied to traffic that has one IP is not a limit on an attacker. It is a
global cap on the shop, and it fails as a 429 on checkout for customers who did nothing. Two
existing limits were already in that state — `/store/order-claims` at six a minute and
`/store/personalisation/attach` at thirty, both storefront-wide rather than per customer.

`x-forwarded-for` cannot fix it. A proxy in front of the backend *overwrites* that header —
which is exactly what makes it trustworthy there — and the backend is directly reachable by
the ten client components that post to it anyway. A header any caller can set is not an
identity.

So the storefront names the customer in `x-client-ip` and proves its right to with
`INTERNAL_API_SECRET`, compared in constant time and length-checked first. Missing secret means
the header is ignored entirely, which degrades to the old behaviour — visible, and the same
safe direction `TRUST_PROXY` defaults to. It is `criticalInProduction`, because a production
boot without it silently collapses the login and checkout limits onto one bucket.

### The five limits that were missing were all on somebody else's routes

Credential stuffing and card testing do not go through routes this application wrote.

| Route | Budget | Why |
|---|---|---|
| `/auth/{customer,user}/emailpass` | 10/min | Ten wrong passwords is generous for a person and useless to a script. Both actors — `user` is the admin login. |
| `…/register`, `…/reset-password`, `…/update` | 5/min shared | One abuse, one budget. Reset **sends mail to an address the caller chose**, which makes an unlimited one a way to post mail at somebody using this shop's domain. |
| `POST /store/customers` | 5/min | |
| `POST /store/carts` | 30/min | A row per call, otherwise free. |
| `…/payment-collections/:id/payment-sessions` | 20/min | Where the PaymentIntent appears. |
| `POST /store/carts/:id/complete` | 10/min | |

The last two are card testing, and the reason is not the database. A checkout that accepts
unlimited attempts is a free card-validity oracle; Stripe charges for every declined
authorisation and eventually acts on the decline rate. A shop used this way finds out from its
processor, not its logs.

### The trap in attaching a rule to somebody else's route

The first version used `matcher: '/auth/:actor/:provider'`, which is correct as a path pattern
and **did nothing at all**.

Medusa sorts middleware and routes together through `RoutesSorter` before handing them to
Express, in the order `global, wildcard, regex, static, params`. That matcher lands in
*params*; the route it guards, `/auth/customer/emailpass`, is *static*. Static registers first,
Express runs handlers in registration order, and the middleware is never reached. Nothing warns.

The rule, written into the file for whoever adds the next one: **a middleware's matcher must
land in the same bucket as its route's, or an earlier one.** `/store/carts/:id/complete` works
as a params matcher because the route it guards is a params route too. `/auth/...` has to be
spelled out, both actors, all four paths.

The only reason that was caught is an integration test that sends eleven logins and expects the
eleventh to be refused. A limit that silently does nothing is worse than no limit, because it
is written down.

### What is deliberately not limited

`/store/suggest` gets a real per-customer budget: it is fetched from the browser, so the key is
a real address. `/store/sitemap` gets ten a minute — the storefront asks hourly and caches, so
this stops a loop, not a person.

`/store/jerseys` and `/store/facets` get generous ceilings and an honest comment. They are
called server-side through cached fetches, so nearly all legitimate traffic is one caller with
no forwarded identity — and a budget that clears the whole shop's revalidation traffic does not
meaningfully constrain a determined scraper hitting the route directly. It constrains a runaway
client. That is the claim, and it is the whole claim.

The trivial cached reads — `/store/checkout-settings`, `/store/shipping-zones`,
`/store/curated-collections` — get nothing. A limit there would be a global cap with no
attacker to stop.

### One fixture had to become honest

The reporting tests place a dozen orders inside a single `it`, and started failing with 429 on
the eleventh. That is the limit working. Each simulated purchase is a different shopper, so the
fixture now forwards a distinct identity per buy — counted rather than randomised, because a
random address collides often enough at that sample size to make a failure look intermittent.

---

## Step 38 — the last four codeable things

Everything remaining that could be closed in code rather than by a decision, a key or a domain.

### Proxy trust is now stated, not assumed

`clientKey` trusted `x-forwarded-for` unconditionally. That is correct behind a proxy that
overwrites it and **forgeable by one header** if the app is ever exposed directly — one forged
header per request gives every request its own bucket and voids every rate limit in the
application, silently.

`TRUST_PROXY` decides it, defaults to **false** (the loud failure: rate-limiting every
customer as one caller, visible and fixed by one variable), and is `criticalInProduction` — so
a production container cannot start without somebody having answered the question. That was the
last item on the security map.

### Refunds execute, with the guarantee in the row

The returns queue recorded decisions and moved no money because a retry whose response was lost
refunds twice. Medusa's `refundPaymentWorkflow` **takes no idempotency key** — its Stripe
provider passes one from a payment context the workflow does not expose — so the protection
could not live in the call.

It lives in `refunded_at`: checked first, written as part of issuing, and a second attempt
returns what the first one did rather than refunding again. Stripe swallowing
`CHARGE_ALREADY_REFUNDED` sits underneath as a second layer, but it protects the money and not
the record, and an operator who clicks twice deserves to be told the first click worked.

Three refusals, each for a reason:

| | |
|---|---|
| Not `received` yet | Under a final-sale policy the goods coming back is the thing being verified. |
| No amount given | There is **no default**. A return is usually one item out of several, and defaulting to the order total is a mistake nobody notices until it has happened. |
| More than was captured | Obvious, and cheap to check. |

Validation runs before the order lookup — a test caught the first version reporting "that order
has no captured payment" for a request that never carried an amount, which describes the state
of something the caller never reached.

**Labels are still not bought.** Shippo's idempotency contract could not be confirmed from
their documentation, and guessing at the semantics of a call that spends money is not a guess
worth making. That is the one item on this list that stays open on a fact rather than on effort.

### Two scripts for decisions that were waiting on numbers

`scripts/verify-redirects.ts` walks the real catalogue rather than a fixture and reports what a
seeded test cannot contain: a `source_handle` on two products (resolves arbitrarily), one that
collides with a live handle (redirects a working URL away), rows with no source handle at all,
and details whose product is missing or unpublished. Read-only, and worth running before DNS
moves — the last moment any of it is cheap to fix.

`restore-drill.sh` dumps and restores into a scratch database and prints how long each half
takes **with and without the image bytes**. That difference is the number the R2 decision has
been waiting on since the images went into Postgres: the trigger was always stated as restore
time, and nobody had ever measured it.

---

## Step 37 — a phone number at checkout, and one settings table

Checkout collected no phone number at all. It does now, required by default, with a switch in
the admin.

### The switch made the settings table honest

`message_setting` was never message-specific in anything but its name — `key`, `enabled`,
`disabled_at`, `disabled_by`, `reason` describes any toggle. The moment a second kind appeared,
the choice was a second table with the same five columns or one table that says what it is. A
second would have ended with two admin screens, two audit trails and two places to look when
somebody asks why a toggle did nothing.

So it is `store_setting` with a `group`, the unique index moved to `(group, key)`, and
`/app/messages` became `/app/settings` with a section per group. `src/message-settings.ts`
survives as a thin facade over `src/settings.ts`, because renaming the import in nine send
sites would have been churn for no behavioural change and `shouldSend` reads better at those
call sites than `checkSetting`.

### Enforced at completion, not by an attribute

`required` on an input is a hint to a browser. Anybody posting to `/store/carts/:id/complete`
directly ignores it, and a rule that only holds for people using the form is not a rule — so
the check is a middleware on that route. It is the last point at which the order does not yet
exist, which is what makes it the right one: refusing there costs a customer a field, refusing
later would mean unwinding a payment.

Checked against the **shipping** address specifically. The carrier needs it, and a personalised
shirt returned as undeliverable is a total loss rather than restock.

**Loose on format, strict on presence.** Six digits after stripping punctuation. The five
regions this ships to format numbers a dozen ways, and a regex that rejects a valid
international number costs an order — while an obviously empty field costs nothing to refuse.
`+44 (0)20 7946 0958` passes; `n/a` does not.

### On by default, with the default in the code

No row means on. A fresh database requires a phone number with nothing seeded, and
`isSettingEnabled` fails open — a database blip asks for one extra field rather than silently
dropping a requirement somebody chose.

Switching it off names the cost: more undeliverable parcels, and the only contact route that
still works when somebody mistypes their email.

### What the test run caught

Adding the requirement turned **35 tests across five suites** red at once — every fixture that
completes a cart. That is the feature working: those fixtures simulate real checkouts, and a
real checkout now carries a phone number. They were updated rather than the rule weakened.

---

## Step 36 — closing the Shopify gaps that could be closed

Four items came out of the comparison as "before a first order". Two are now built, one had its
blockers removed, and one stays deliberately manual. Everything not built is in
[`DEFERRED.md`](DEFERRED.md) with the reason attached, because a reason is the part that gets
lost first.

### Old URLs now resolve — a third of the catalogue needed it

The import generated fresh slugs: **1,083 of 3,155 products** came out with a handle different
from the one the live store has been ranked for, and Shopify serves products at `/products/…`
where this store serves them at `/jerseys/…`. Both halves of that move now work.

- `app/products/[handle]/page.tsx` resolves the old slug and answers **308**, which Google
  treats as 301.
- `/jerseys/<old-handle>` tries the same lookup **before** 404ing, so old slugs work on the new
  path shape too — and it costs nothing on the happy path, because it only runs when the page
  was going to 404 anyway.
- `next.config.ts` maps Shopify's fixed paths: `/policies/privacy-policy` → `/policies/privacy`,
  `/pages/request-a-jersey` → `/request`, and the rest. Collections needed nothing — they were
  imported keeping the live store's handles.

The mapping was already in the database. `jersey_detail.source_handle` has held the true Shopify
handle for every product since the import, and nothing read it.

### Saved addresses, and guest orders that join an account

Both APIs have been in Medusa since the account routes shipped and neither had a caller.
`/account/addresses` is the address book; `/account/claim` attaches a past guest order.

**The claim needed a new endpoint, and the reason is worth keeping.** Medusa's transfer route
takes an order id, and the only way a customer could obtain one is `/store/order-lookup` —
which deliberately returns **no internal ids**, "only fields the customer already knows".
Adding the id there to make this work would have quietly undone that decision for every caller.
So `/store/order-claims` does the lookup and the transfer request together, server-side, and the
id never reaches the browser.

Three things make it safe, and all three are needed: the requester must be **signed in**; the
**email and order number** are checked together with the same generic refusal and the same
delay as the public lookup; and the **confirmation goes to the address on the order**, not to
the account asking. Knowing somebody's order number and email is not enough, because the link
lands in their inbox.

A test caught the interesting bug: *"guest order" does not mean "no customer"*. Medusa creates a
customer record for every checkout email, so a guest order still carries a `customer_id` — of a
customer whose `has_account` is false. Checking ownership on `customer_id` alone refused every
genuine guest order.

### Express checkout: the blockers removed, the wiring not done

Two **silent** blockers, both fixed against Stripe's documented requirements rather than from
memory:

- The CSP allowed `js.stripe.com` only. Stripe's guide is explicit that `*.js.stripe.com` is
  what lets Stripe.js start frames on sibling origins — the mechanism the wallet buttons and
  Link use. A blocked frame produces no error a customer can see; the button simply never
  appears.
- `Permissions-Policy` carried no `payment` directive, which disables the Payment Request API
  both wallets go through. Also silent.

The Element itself is not wired, and that is a judgement rather than an omission: there is no
Stripe test key here, the integration suite completes carts through the system provider with no
browser involved, and Apple Pay needs a domain that does not exist. Shipping an unverifiable
wallet flow onto the one page that takes money is the same call already made about executing
refunds. `DEFERRED.md` has the four steps to finish it.

---

## Step 35 — consent and unsubscribe on the one commercial email

Nine of the ten templates are transactional — a receipt, an acknowledgement, a reset — and
need neither consent nor an opt-out. The cart-recovery email is the exception: it goes to
somebody who did **not** buy, to persuade them to. That changes the rules completely, and none
of them were being met.

### The basis, and what it costs

The address was given during a checkout — negotiations for a sale of a similar product — which
is what PECR reg. 22(3) soft opt-in and the CAN-SPAM existing-business-relationship carve-out
both turn on. What that basis *requires* is a simple means of refusing, offered in **every**
message. So the unsubscribe link is not a nicety here; it is the condition the legitimacy
rests on. The route refuses to send when it cannot build one.

Three checks now run before a recovery email goes out, all of them **before** sending rather
than degrading, because an email cannot be unsent:

| | |
|---|---|
| **Suppression** | Marketing-wide, not per-list. Somebody who left the newsletter has refused marketing, and sending them a basket reminder because it arrived through a different code path is a distinction only the sender can see. |
| **An unsubscribe link** | No `STOREFRONT_URL`, no link, no legal basis, no send. |
| **A postal address** | `SHOP_POSTAL_ADDRESS`, required by CAN-SPAM. Refusing without it is the same call this codebase makes about every pending trader field: a missing regulatory value is not a formatting problem, and inventing one is a false statement. |

**`?force=true` does not override suppression.** That flag exists to resend to somebody who did
not reply; it is not a way past somebody who said no.

### `suppression` is a third kind of inbound message

Not a `newsletter` row with `unsubscribed_at` set. Somebody who clicks unsubscribe in a basket
reminder may never have signed up for anything — recording their refusal as a newsletter
unsubscribe would misstate where the address came from, and the whole point of `consented_at`
and `source` is that the defensible record is *when and where*. A refusal deserves the same
honesty. One click stamps every list the address is on.

### The link, and the two ways it is used

An HMAC over the address, so it works from a two-year-old email with one click and cannot be
edited to unsubscribe somebody else — asserted by a test that forges exactly that.

- **A person** lands on `/unsubscribe`, which confirms the token and shows a masked address
  before doing anything. Two steps on purpose: a corporate mail gateway follows every URL in an
  incoming message, and a link that acts on `GET` unsubscribes people who never opened the
  email.
- **A mail provider** never reaches that page. `List-Unsubscribe` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) let Gmail and Yahoo `POST`
  straight to the endpoint — which is why it takes the token from the query string as well as
  the body, and why the header exists at all: both now require it of bulk senders.

Templates can return `headers` for this, and a test asserts that **only** cart-recovery sets
any. Putting an unsubscribe header on a receipt invites people to opt out of their own
receipts.

### One deliberate inversion

`isSuppressed` **fails closed** — an unreachable database means "do not send". It is the only
place in the codebase that does. Everywhere else a failed lookup means send anyway, because
not sending a receipt is worse than sending one. Here it is the other way round: not sending a
marketing email costs a basket; sending one to somebody who opted out is a breach and a
complaint.

---

## Step 34 — switching the automatic emails off

`/app/messages` switches each automatic customer email on or off, with a confirmation dialog
that states what the switch actually costs.

### Only the automatic ones

Manual sends are absent, and that is deliberate: pressing the button is already the switch, so
a setting on top of it would mean "the button does nothing", and a button that silently does
nothing is worse than no button. Operator notifications are absent too — the recipient list
already controls them per address and per event, and a global override on top of a per-address
list is two places to look when somebody stops receiving mail.

### The dialog is the feature

Every one of these has a consequence invisible from inside the admin: an order confirmation
that stopped going out looks exactly like one that is going out. So the dialog names the cost
in the message's own terms, and the two critical ones ask the operator to type the name of what
they are switching off.

| Message | Severity | What switching it off costs |
|---|---|---|
| Order confirmation | **critical** | Customers pay and receive nothing. In the EU and UK, confirmation of the contract on a durable medium is required by the CRD — not optional. |
| Password reset | **critical** | Anyone who forgets their password is locked out permanently. There is no admin "send reset" button and no other route back in. |
| Jersey request ack | serious | Somebody asks you to source a shirt and hears nothing. The proposition failing at the first step. |
| Return ack | serious | A customer reporting a fault gets silence while the 30-day window runs. |
| Contact ack | low risk | The only one that costs politeness alone — the message is still stored and the operator notification still fires. |

Switching something **off** requires a typed reason, recorded with the actor and the
timestamp: "order confirmations have been off since Tuesday" is a question somebody asks after
a week of support tickets, and a timestamp with no reason answers half of it. Switching **on**
asks nothing — restoring the default should never be the harder direction.

### Fails open, on purpose

`isMessageEnabled` answers `true` when the table is missing, the database is unreachable, or
the row has never been written. Sending a receipt that was not strictly wanted is a nuisance;
failing to send one because a settings lookup errored is a customer who paid and heard nothing,
caused by an outage that had nothing to do with them. Only an explicit stored `false` suppresses
anything.

A suppressed send logs at `warn` **every time**, with the order number or address attached.
Noisy on purpose: it is an abnormal state somebody chose, and the log is where it should be
visible while it lasts.

### The bug this nearly shipped with

The first pass put the check at the top of each route's send block as
`if (!(await shouldSend(…))) return`. That returns from the **route handler**, not from the
send — so a suppressed acknowledgement would have skipped `res.json()` and left every contact
form submission, jersey request and return request hanging until the client timed out. The
switch would have looked like it worked and taken the store down with it.

It is an `if`-wrap now, and the test that covers it asserts the three things a suppressed send
must not break: the row is still written, the response is still 201, and nothing else stops
sending.

---

## Step 33 — the shop finds out

Every one of the nine emails this store sends addresses **the customer**. Somebody wrote in
through the contact form, the shop replied "we got your message" automatically, and no human
was told a message had arrived. Same for a paid order, a sourcing request and a return.
Nothing was lost — the rows were in the database and the admin screens read them — but every
piece of inbound work arrived silently and had to be discovered by going to look.

`/app/notifications` is the list of addresses that now get told, backed by
`notification_recipient` with full CRUD.

### A table, not an environment variable

Two reasons, and the second is the one that matters. Adding a colleague should not be a
redeploy; and one address for everything means whoever handles returns also receives every
order confirmation, which is how a notification address becomes a folder nobody opens. Each
row subscribes to any of four events independently.

| | |
|---|---|
| `order_placed` | fires off the same `order.placed` the customer confirmation does — the Stripe webhook, not the browser |
| `contact_received` | the clearest gap: an auto-reply went out and nobody was told |
| `jersey_request` | demand is the whole proposition, and nobody was told when somebody asked |
| `return_request` | the 30-day fault window runs whether or not the queue was opened |

### Four decisions

**Owner-only, and that is security rather than tidiness.** What arrives at these addresses is
customer data — an order notification carries a name and a total, a contact notification
carries what somebody wrote. Letting Staff add an address would be letting them forward
customer records to any inbox they choose. It is its own RBAC resource for that reason.

**The screen leads with coverage, not with the list.** The question an operator has is "is
anyone watching returns?", not "who is on the list". An event nobody receives renders as a red
badge at the top, and removing the last person watching orders says so in the toast.

**Pause is not delete.** Somebody on holiday should not have to be removed and re-added, which
loses what they were subscribed to. `active: false` stops the mail and keeps the row; delete is
hard, because the row is an address and four checkboxes and there is nothing worth preserving
once the person has gone.

**The address cannot be edited in place.** Changing which address receives customer
notifications is not an edit — it is one person off the list and another on, and doing it in
place loses the record that the first was ever there.

### It cannot fail what it announces

`notifyOps` never throws and is never awaited in a way that can fail the caller. The order is
paid and recorded before it runs; the contact row is written before it runs. A notification
that cannot be sent is a support inconvenience, and letting it roll back the thing it was
announcing would be absurd. Sends are individual, so one bad address does not take the other
three with it.

The operator template is deliberately not the customer one. A customer email reassures; this
exists to make somebody act — so it leads with what happened and what it is worth, carries a
link straight into the admin screen that owns it, and quotes only as much customer data as the
decision needs. An inbox is a worse place to keep a customer's address than the database is.

---

## Step 32 — notifying a demand group

The sourcing queue has always ranked demand: twelve people asking for the same Kobe shirt are
one row, ranked above a shirt one person asked about. Acting on that row was the part that did
not exist — marking a request `fulfilled` emailed exactly one person, so sourcing a shirt
twelve people wanted meant opening twelve rows and sending twelve emails by hand.

**And the email had nowhere to go.** `request-sourced` renders a "View it" button when given a
`url`, and no route ever passed one. The one message whose entire job is to turn a sourcing
request into a purchase arrived with no way to purchase.

`POST /admin/jersey-requests/notify` takes a product and either a demand group
(`team` + `player`, matched the same way the queue groups them) or an explicit list of `ids`.

### What it refuses to do

| | |
|---|---|
| **No product** | The message exists to say the jersey is buyable. An announcement with nothing to buy spends the one moment these people are paying attention. |
| **A draft product** | Checked before a single email goes out. "We found it" linking to a draft is the same failure one step later, and it cannot be unsent. |
| **No `STOREFRONT_URL`** | The email would have no link in it. |
| **More than 500 matches** | A send that large is worth doing deliberately rather than by a mistyped filter. |
| **Anyone already told** | Only `new` and `sourcing` are notified. Clicking twice must not email twelve people twice. |

### Four details

**One message per person, never one message to many.** A bulk notification with everybody in
the recipient list is the classic way to disclose one customer's address to another, and these
people have no relationship with each other — they happen to want the same shirt. Individual
sends, no batching API, worth the extra calls.

**Somebody who asked three times gets one email**, and all three of their requests are closed,
because all three of them are.

**A failed send leaves its request open.** The other eleven still hear about the shirt, and a
retry picks up only the one that bounced rather than emailing everyone again.

**`dry_run: true`** returns the count and the masked addresses without sending. Confirming the
size of a send does not require reading the list, and this response is the kind of thing that
gets pasted into a chat window.

The email now names the product, repeats the size they asked about, quotes their own sentence
back to them — a bulk send is only reassuring if it repeats what *they* typed rather than a
description of the product — and carries both a button and a pasteable URL for clients that
strip buttons. No urgency, no invented scarcity: same rule as the cart-recovery email.

The single-request path gained the same link, optionally, via `product_id`.

---

## Step 31 — privacy by design

The privacy policy has promised specific retention periods since the day it shipped —
*"Jersey requests: two years"*, *"Server logs: 90 days"*, *"We respond within 30 days"* — and
nothing in the application enforced any of them. Every row ever written was still there, and
answering a subject-access request meant hand-written SQL across eight tables and knowing
which eight.

That is the gap, stated plainly: **the policy page was a set of sentences the code did not
honour.** This codebase already refuses that arrangement elsewhere — `/store/return-requests`
carries the comment *"the storefront cannot describe a policy the API does not enforce"* — and
the privacy policy was the one place it had not been applied.

### The register

`src/privacy.ts` enumerates every store of personal data: the columns, the lawful basis under
Article 6, the retention period, and what erasure does to it. It is **executable** — the
nightly retention job prunes from it, the subject-access endpoint walks it, and a unit test
reads the published table off `storefront/lib/policies.ts` and fails if a period there is not
the period the job will apply. Same arrangement as `TERMS` and the refund policy, for the same
reason.

Erasure is three different obligations, and collapsing them is the usual mistake:

| | |
|---|---|
| `delete` | the row **is** the personal data — a contact message is an address and a sentence, and a soft delete leaves the address in the table |
| `anonymise` | the record outlives the relationship — a return decision is evidence for a refusal, so the decision stays and the address goes |
| `retain` | erasure does not apply and the reason is stated — orders are a tax record for seven years, which is Article 17(3)(b) |

Exactly one store is `retain`, and a test asserts that. If a second appears, somebody has
decided inconvenience is a legal basis.

### What is now enforced

- **`GET /admin/privacy/subject?email=`** — Articles 15 and 20 in one response. Every store,
  each with its basis, its retention and what erasure would do — and an explicit list of the
  stores that *cannot* be searched by email, so an export cannot claim a completeness it does
  not have.
- **`DELETE /admin/privacy/subject`** — Article 17 across eight tables, reporting deleted,
  anonymised and retained separately. An erasure that quietly skipped the orders would be
  worse than one that refused, because the subject would believe it was done.
- **`src/jobs/retention.ts`** — nightly, dry by default. `PRIVACY_RETENTION_APPLY=true` makes
  it act. The first run against a real database is the one that removes two years of history
  in a transaction nobody watched.
- **Owner-only.** `privacy` is its own RBAC resource rather than folded into `order:read` — it
  is the one endpoint that reads every customer's data in one call.

### Three details worth keeping

**A printed name is kept for two years, not seven.** The order line proves what was sold; the
rendered preview is chargeback evidence and a chargeback cannot be raised that late. The
decisive argument is that the name on a shirt is frequently a *third party's* — a player's, or
a gift recipient's — who never dealt with us at all.

**Logs are a data surface too.** The order-placed block was printing the customer's address
into a log retained for ninety days and shipped wherever the platform sends logs. It is masked
now: `a***@example.com` is enough for an operator with the customer on the phone and not
enough to be a mailing list. The erasure endpoint masks in its own audit line, because writing
an address into a log while deleting it from the database is self-defeating.

**Three stores have no period, and that is reported rather than defaulted.** Customer
accounts, product reviews and imported reviews. Picking a number would put a retention period
into effect that appears in no policy — the same defect as a policy period that appears in no
code, pointing the other way. The job prints them every run.

The published table gained three rows in the process — messages, return requests, printed
names, abandoned baskets — because it covered five categories and the database holds eight. A
category the policy does not mention is one nobody promised to delete, **which is how "we keep
it forever" happens without anyone deciding it.** Worth a lawyer's eye before launch.

---

## Step 30 — authorisation, and a complete environment

### Roles

Authentication was never the gap — Medusa applies `authenticate('user', …)` to the whole
`/admin` prefix at the router, so every custom route was already behind the login.
Authorisation was: there was one privilege level and it was "everything".

**Owner and Staff.** Owner is Medusa's own built-in `Super Admin` role, adopted rather than
duplicated — its RBAC module seeds a `*:*` role and policy at fixed ids on first boot, so
creating a second identical one would clash on the unique policy key and put two
indistinguishable entries in the role list. Staff is defined by its exclusions: **no deletes
anywhere**, no product creation, no media writes, no integrations screen. What is left is the
daily work — answer contact, move returns and requests along, moderate reviews, approve what
gets printed, correct a product's copy and taxonomy.

**On in production, off in dev and test**, resolved exactly as Medusa resolves it —
`MEDUSA_FF_RBAC` beats the project config, which is how you rehearse enforcement locally and
how you turn it off in an emergency.

### Three things that are not obvious

**Policies are inert without the flag.** `http/router.js` only wraps a handler with the
permission check when `rbac` is enabled. Declaring `policies` on every route achieves exactly
nothing on its own — which is why the enforcement test sets the flag, and why it is the only
place in the repository where any of this is actually exercised. Without it the whole feature
would be `assertConfigured()` again: declared, documented, called from nowhere.

**Enabling it without seeding locks everybody out.** The check rejects a user holding *no*
roles before it consults a single policy, so an empty assignment means every admin request
answers 403 and nobody can grant themselves anything through the UI. `seed-rbac.ts` fixes it;
`/health/ready` refuses to report ready in that state, so a production container never enters
rotation locked out. That readiness gate is where the guard lives because
`instrumentation.ts` — the only hook Medusa calls before the server exists — runs with
`skipDbConnection` and cannot ask the question. It is the right shape anyway: §8.4's "up and
cannot serve".

**Roles reach the token at sign-in, not at assignment.** User-to-role is a link
(`user_rbac_role`) that `generate-jwt-token` reads when issuing a token. A session that
predates the assignment carries no roles and is refused everywhere, so anyone newly granted a
role has to sign out and back in.

### The coverage guard

Medusa's default is the wrong way round: a route with no `policies` block is authenticated and
otherwise unrestricted, and nothing fails when one is added without a rule — it simply works
for everyone, which is indistinguishable from working. So `policy-coverage.unit.spec.ts` reads
the route files off disk and the matchers out of `middlewares.ts` and fails if a handler has
no rule covering it. Verified by deleting a rule and watching it go red.

### Environment

Every variable the code reads is now in a file. The audit found **77 distinct variables** and
24 missing from `backend/.env`, 11 from `storefront/.env.local`, 25 from the backend template
and 34 from the deploy template — including all seven `SHIP_FROM_*` fields, without which a
label cannot be bought, and the entire media and RBAC groups.

Existing values were preserved; only missing keys were appended. `backend/.env.template` marks
which variables block a production boot rather than leaving that to be discovered at deploy
time, and `storefront/.gitignore` gained a negation so `.env*` stops swallowing its own
template.

---

## Step 29 — closing the CRUD gaps

The data-layer map listed every table against every reader and writer, which made the holes
obvious: rows that could be created and never corrected, and one table the admin could not
read at all. `Migration20260905170000` carries the schema half.

### What had no path

| Table | Was | Now |
|---|---|---|
| `inbound_message` | **write-only** — the contact form wrote rows nothing in the admin read | `/admin/inbound-messages` · list, filter by kind, work the queue, erase |
| `curated_collection` · `collection_membership` | script-only. Adding one product to Best Sellers meant editing JSON and running a script against production | `/admin/curated-collections` · create, edit, add/remove/reorder products, delete |
| `store_review` | 84 reviews published on the storefront with no update or delete anywhere | `/admin/store-reviews` · re-attach to a product, take down |
| `product_review` | reject only | plus delete, for the cases rejection cannot answer |
| `jersey_request` | no erasure path | delete |
| `return_request` | no removal path | **soft** delete — see below |
| `media_asset` | nothing ever deleted a row | `/admin/media/orphans` sweep · `/admin/media/:sha` delete |

### Three decisions inside that table

**Deletes are hard where the row *is* the personal data, soft where it is a commercial
record.** `inbound_message` and `jersey_request` hold an address someone typed into a form,
so "deleted" has to mean deleted — a soft delete leaves the address in the database and does
not answer an erasure request. A `return_request` is the evidence for a refusal under a
final-sale policy, so it hides and survives; erasing that customer is an order-level
operation, because the same address is on the order regardless.

**Store reviews can be re-attached but not rewritten.** The storefront says these are shown
as written and unfiltered. An endpoint that can edit the body makes that sentence false, and
misrepresenting what reviewers said is the thing the FTC rule is actually about. So
`product_id` is editable, the words are not, and a review that is wrong gets deleted rather
than corrected. Deleting one warns that re-running `import-reviews.ts` restores it — the
importer de-duplicates on `fingerprint` and the fingerprint goes with the row.

**The orphan sweep is two verbs.** `GET` shows what would go; `DELETE` takes an explicit list
of content addresses. Between the two calls somebody may have attached one to a product, so
the delete re-derives the orphan set and skips anything that has since been referenced —
named in the response, not just counted. It deletes image bytes that exist nowhere else.

### Bugs fixed alongside

- **`media_asset` is in the migration history.** It was created by `CREATE TABLE IF NOT
  EXISTS` from application code, so `medusa db:migrate` did not produce it and a fresh
  database's schema depended on which endpoint was called first. `ensureTable()` stays as a
  safety net for the ingest scripts and is now a no-op on any migrated database.
- **`/health/ready` no longer returns the database error.** It answered with
  `(e as Error).message` on an unauthenticated endpoint — a connection failure carries host,
  port, database and role. The reason goes to the log; the probe gets the status code and
  which check failed.
- **The dead B-tree on `search_text` is dropped.** A leading-wildcard `ILIKE` cannot use it,
  so it never served a query it was created for; the trigram GIN has done that work since
  `Migration20260905101500`. It was pure write cost on a table every catalog sync rewrites.
- **The orphan query joins `image`, not `product_images`.** The latter is the join table and
  holds only ids — getting that wrong would have reported every asset in the catalogue as an
  orphan.

---

## Step 28 — two defects the data-layer map found

Mapping every table against every reader and writer turned up two rows that were queried and
never written, and one rule with nothing enforcing it. Both are fixed;
`Migration20260905143000` carries the schema half.

### Personalisation never reached the order

`line_personalisation.order_id` and `order_line_id` were indexed, read in two places and
**written by nothing**. A cart line's id does not survive checkout — Medusa builds fresh
order line items — so there was no way back from a paid order to the name to be printed.

The visible consequence was worse than an empty print queue. `GET /store/return-requests`
decides whether a line is made-to-order by looking for personalisations carrying that
`order_id`; it always found none, so the storefront offered a refund on a shirt with
someone's name printed on it.

The fix is the one field that *does* cross that boundary. `prepareLineItemData` copies a cart
line's `metadata` verbatim onto the order line, so `attach` now writes a ref there
(server-side — a client would only have to forget it once) and stores the same ref on the
row. `order.placed` joins on it. Two useful side effects:

- Medusa merges cart lines by variant **and metadata**, so a personalised line can no longer
  be merged with a plain one of the same variant — two differently-printed shirts in the
  same size stay two lines instead of one name overwriting the other.
- The `items.*` fix below means the confirmation email stops saying `undefined×`.

### `items.quantity` was silently undefined

Found while debugging the above, and older than it. The subscriber requested
`items.quantity`, `items.subtotal` and `items.metadata` individually; Medusa does not resolve
computed line-item fields that way and returns them empty. Every order log line and every
confirmation email has been printing `undefined× SKU`, and the email's line subtotals were
zero. `items.*` fixes all three. §15's note about this trap was written about the reports
endpoint — the same mistake was sitting in the subscriber.

### "One review per email per product" was a race

Enforced by a read followed by a write, which is not a rule. Six simultaneous submissions all
passed the check and all inserted. There was also no index on `email` at all, so the check
itself was a sequential scan on every review posted.

Now a unique partial index on `(product_id, email)`, and the route catches the violation and
answers with the same 409 as the ordinary duplicate — the caller cannot tell which path
refused them. The migration soft-deletes the later member of any pre-existing duplicate pair
before creating the index, keeping the earliest review; verified against a table seeded with
a duplicate pair, a duplicate triple and an already-soft-deleted row.

The concurrency test earned its place immediately: the first version of the violation
detector looked for Postgres `23505` and the constraint name, and neither arrives — Medusa
rewrites it as `invalid_data`, *"Product review with product_id: …, email: …, already
exists."* Five concurrent submissions were getting a bare 400 quoting an internal product id
while the sequential path next to them answered 409.

---

## Step 27 — creating a jersey from the admin

`/app/jerseys` · `POST /admin/jerseys` · `GET|POST|DELETE /admin/jerseys/:id` ·
`POST /admin/media/upload`

### The gap it closes

"Medusa has a product page" is true and was not the whole story. Three things were missing,
and the first two are the kind that look fine until a customer cannot find something.

**1. The stock product screen creates half a jersey.** A Medusa product carries no
`jersey_detail`, and that row is what holds team, league, player, colourway and
`search_text`. `/store/jerseys` filters *through* the product↔detail link, so a product
created on the stock screen appears in no facet, no league listing, no team listing and no
search result — while looking completely healthy in the admin dashboard. It exists and no
customer can reach it. So this endpoint writes both halves in one call, and rolls the
product back by hand if the detail fails, because the half-created state is precisely the
one worth avoiding.

**2. The stock product screen cannot upload an image at all.** Uploads go through Medusa's
**File module**, which has no default provider and is not registered here — so the control
has nothing behind it. Every image in the catalogue arrived through
`scripts/ingest-media.ts`, from a folder on a laptop.

`POST /admin/media/upload` runs that script's pipeline over HTTP instead: WebP at q78
capped at 1400px, hashed, stored once per distinct result. What that buys over simply
registering `file-local` is the part worth keeping — every image the admin adds is
optimised, content-addressed, immutable, served with `?w=` derivatives, and lands in
`media_asset` alongside the other 4,300 rather than in a directory a container restart
forgets. Content-addressing also means dragging the same photo in twice costs nothing and
produces no duplicate, which a person will do.

**3. `/admin/catalog` could edit but not create or delete.** It still owns finding and
filtering, which it does better than this screen would; this one owns the lifecycle.

| | |
|---|---|
| **Drop zone** | drag and drop, or a real `<button>` that opens the picker — dragging is unreachable from a keyboard, so it is the enhancement, not the control |
| **Reorder** | arrow buttons, same reason. The first image is the thumbnail, and `POST` keeps the two in step |
| **One form** | product fields and catalog fields together, because they are one thing to whoever is filling it in |
| **Delete** | soft-deletes the product and the detail and dismisses the link. Images are **kept** — they are shared by content address, so two products can legitimately reference identical bytes |

### What the tests caught

The multi-file upload test failed on the first run with `duplicate key value violates unique
constraint "pg_type_typname_nsp_index"` — an internal index name that says nothing about the
cause. `create table if not exists` is **not** concurrency-safe: it checks, then creates, and
the drop zone sends one request that processes its files in parallel. So dropping two images
stored the first and failed the second with a wall of DDL in the message. `ensureTable` now
tolerates the errors that mean "somebody else just created it" and re-throws everything else.

The obvious follow-up — memoise it per process, since the answer cannot change — broke the
suite immediately, because the test runner rebuilds the schema between tests and the second
upload asked for a table the process was certain existed. Cached knowledge about a schema is
a guess about something another process controls. The round trip stays.

---

## Step 16 — the Catalog page

`/app/catalog` · `GET /admin/catalog` · `POST /admin/catalog/:id` ·
`POST /admin/catalog/bulk`

### The gap it closes

Medusa's built-in product list **can display** `jersey_detail` but **silently ignores it
as a filter** — verified: `?jersey_detail[team]=Dallas Cowboys` returns all 3,155
products. So an operator could not find "all Cowboys jerseys" in the admin at all, could
not see the flagged products, and had nowhere to enter the regulatory data that gates
every EU sale across all 3,155 rows.

Four gaps, one screen, because they are the same shape: *find products by our taxonomy and
edit our fields.*

| | |
|---|---|
| **Filters** | team, league, free text, plus **Needs review** and **Missing regulatory** toggles, each showing its count |
| **Health tiles** | products · needs review · EU-sellable · missing regulatory |
| **Inline edit** | taxonomy corrections and the whole regulatory block, per product, with *Save and clear flag* for review work |
| **Bulk apply** | the same values across everything matching the current filter |

Verified against the running instance: `team=Dallas Cowboys` → **98**, where the built-in
list returns 3,155; the review queue → **116**; a scoped bulk write touched exactly **98**
rows and the health tile moved from 0 to 98 EU-sellable.

### Two deliberate constraints

**Bulk is dry-run by default.** `Preview` reports the match count and changes nothing;
only `Apply` writes. A bulk write with no preview is how you discover the filter was wrong
after the fact — and since the filter here is whatever is on screen, the preview doubles as
proof the operator is looking at what they think they are.

**Price is not bulk-editable, on purpose.** Changing price across the catalog has
reference-pricing consequences under the Omnibus Directive and FTC guidance (§7.10). That
belongs in a considered decision with the prior price recorded, not behind a button on an
admin screen. The endpoint refuses `price_cents` and says why.

Input is validated rather than trusted: `country_of_origin` must be a two-letter ISO code
(400 otherwise), and unknown fields are rejected and reported rather than silently dropped.

### Why this matters for the EU path

The regulatory block is the same answer for the whole catalog — one supplier reply fills
fibre composition, country of origin, care instructions and the responsible person for all
3,155 products. Before this page there was no way to enter it at all; now it is one paste
and a preview.

Placeholder values used while testing have been cleared, so the health tiles read honestly:
**0 EU-sellable, 3,155 missing regulatory.**


---

## Step 17 — the three storefront gaps

### Search autocomplete

`GET /store/suggest?q=buf`

Suggestions are **entities, not just products** — typing "buf" offers the team, then its
players, then a few jerseys, because *Buffalo Bills* as one click beats scrolling a result
page of 68.

| Typed | Suggests |
|---|---|
| `buf` | Buffalo Bills (team) + 6 jerseys, 68 total |
| `allen` | Josh Allen, Zach Allen (players), 35 total |
| `romario` | Romário — accent-folded, so the accent is never required |
| `cow` | Dallas Cowboys, 105 total |
| `j` | nothing — one character matches most of the catalog and the list is noise |

A proper combobox: `role="combobox"`, `aria-expanded`, `aria-activedescendant`, arrow keys,
Escape to dismiss, click-away, an `aria-live` count for screen readers, and a 180ms debounce
so it is one request per pause rather than per keystroke. The form still submits as a plain
GET if JavaScript never arrives, and a failed suggest request is silent — suggestions are a
convenience, not the search.

### Notify me — the one-click demand signal

The request block already captures demand but asks for a sentence. On a product page the
team, player, colourway and selected size are already known, so this asks for **one field**:
an email. It writes to the same `jersey_requests` queue, so the sourcing team still works
one list.

Copy is *"Can't get this one? Ask us to source it"* rather than "notify me when back in
stock", because inventory is untracked by design (§12.1) — nothing is ever out of stock, it
is either sourced or not. Claiming otherwise would be the same dishonesty as a fake
countdown.

### Order tracking

`POST /store/order-lookup` · `/track`

There are no customer accounts, so without this every *"where is my order?"* becomes a
support email. anyjersey.com has **Track Your Order** in its nav for the same reason.

It is an unauthenticated endpoint over customer data, so the shape matters:

| | |
|---|---|
| **Both** order number and matching email required | either alone tells you nothing |
| **Identical response** for "no such order" and "wrong email" | verified byte-identical — cannot enumerate order numbers or confirm an address |
| Only what the customer already knows is returned | their items, totals, status, tracking, city. **No internal ids** — asserted in the test |
| A deliberate delay on failure | so response timing does not leak either |

The page shows a three-step progress rail (processing → shipped → delivered) and the
tracking link when a fulfilment carries one.

All three pages pass the accessibility sweep, now covering **8 pages, 0 issues**.


---

## Step 18 — mobile filters, reviews, cart drawer

### Mobile filter drawer

The facet rail is a sidebar on desktop, which is right. On mobile it stacked **above** the
grid and pushed every product off the first screen — actively bad on the majority of
traffic. Below 860px the same markup now moves into a slide-over behind a `Filters` button
showing the active count.

The panel receives the server-rendered facet list as children, so there is **one** source
of filter markup rather than a desktop copy and a mobile copy that drift apart. Escape
closes it, body scroll locks, and the footer button reads *"Show 2,018 jerseys"* so the
consequence of the current filter is visible before dismissing.

### Reviews — shaped by the rule, not the star rating

The hardcoded `4.9/5` is gone. What replaced it was designed around §7.10 — the FTC
Consumer Reviews and Testimonials Rule (effective 21 Oct 2024, **$51,744 per violation**)
and the EU Omnibus review provisions — so three things are structural:

**1. `verified_purchase` is derived, never claimed.** It is set by checking whether the
submitted email has an order containing that product. Verified against the running
instance:

| Submitted by | Result |
|---|---|
| An email with a real order | `verified = true` |
| A stranger | `verified = false` |
| A payload explicitly claiming `verified_purchase: true` | **`verified = false`** |

That last row is the one that matters. A badge the submitter can set is precisely what the
rule prohibits.

**2. Rejection requires a policy reason, and sentiment is not one.** The reject control
forces a choice from spam / abusive / off-topic / personal-info / not-a-customer, and the
API refuses a bare rejection:

```
Rejecting a review requires a policy reason (spam, abusive, off_topic,
personal_info, not_a_customer). A low rating is not a reason.
```

Suppressing negative reviews is named explicitly in the rule, and a moderation tool with a
bare reject button *is* the mechanism for doing it. So there deliberately isn't one.

**3. The aggregate is computed from the same approved set that is listed beneath it**, so
the number and the reviews can never disagree — the mismatch the reference store shows
(137,135 on its homepage, 8,342 on its product page) is structurally impossible here.

Also carried: **fit feedback**. Reviewers answer runs-small / true-to-size / runs-large,
and the product page surfaces *"X% say true to size"* once there are at least three votes.
Fit is the biggest objection in apparel and the one-image decision makes it sharper, so
this is the cheapest real answer available — it comes from customers rather than from a
supplier spec sheet nobody has sent yet.

Nothing is incentivised, and there is no field for it: incentivising a particular sentiment
is prohibited too.

`/app/reviews` is the moderation queue. Verified end to end: 3 submitted → nothing visible
publicly → 2 approved → **count 2, average 4.5, 1 verified**, with a histogram and fit
votes; the third rejected as `not_a_customer`.

### Cart drawer

Adding to bag meant either losing the page or trusting a toast. The drawer opens from the
header with line items, quantity steppers, remove, and the **free-shipping progress bar** —
which only works as a mechanic if the customer can see how close they are while they shop
(§9.1). The rate and threshold come from the zone endpoint, so a European bag shows
$24.99 / $175 rather than the US numbers.

`/cart` stays. The drawer is the fast path, not a replacement.

All 8 pages still pass the accessibility sweep at 0 issues, and all 142 tests pass.


---

## Step 19 — integration tests

```bash
./test.sh              # everything, ~90s
./test.sh --fast       # skip the integration suite
```

**201 tests total**, plus a typecheck and the accessibility sweep:

| Runner | Tests |
|---|---|
| python unittest — `tools/` | 76 |
| jest unit — `spike/backend` | 45 |
| **jest integration — `spike/backend`** | **57** |
| vitest — `spike/storefront` | 23 |

| Suite | What only an integration test can prove |
|---|---|
| `catalog.spec.ts` (16) | **count integrity** — a listing returns as many products as it claims, at every offset; facets combine; unknown sort falls back; page size is capped |
| `purchase.spec.ts` (18) | cart → paid order through HTTP; shipping at the zone rate; totals; order-lookup enumeration protection; abandoned-cart recovery idempotency; reports arithmetic |
| `community.spec.ts` (23) | verified-purchase derivation, moderation gates, aggregate-matches-published-set, request demand ranking |

Count integrity gets its own tests because that bug shipped **twice** — first from filtering
in memory, then from joining on a slug. Both times the count was right and the grid was
short, so nothing errored and nobody noticed. A unit test with a mocked repository cannot
catch either.

### Five things fixed by writing these

**1. My own guard blocked CI.** The Stripe and Resend guards checked
`NODE_ENV !== 'development'`, so they fired under `NODE_ENV=test` and failed every
integration test at boot. The rule is now `=== 'production'` in all three places, with
regression tests pinning `test`, `staging`, `ci` and undefined. **A guard that blocks CI is
a guard somebody deletes** — that is the actual risk, not the boot failure.

**2. The runner reads `DB_*`, not `DATABASE_URL`.** Setting only the latter made it try to
create its test database on `localhost:5432`, where nothing listens, and fail with a bare
`AggregateError` naming nothing.

**3. Admin auth needs three steps, one of which has no HTTP route.** Register gives a token
whose JWT carries `auth_identity_id`; `/admin/users` refuses that token (401); so the user
must be created through the module and `app_metadata.user_id` written onto the identity
directly. Without that link login still returns a token — with an empty actor — and every
admin call answers 401.

**4. Medusa *rejects* a client-supplied `unit_price`** rather than ignoring it:
`Unrecognized fields: 'unit_price'`. Stronger than the guarantee I had asserted, so the
test now pins the rejection.

**5. Completing a cart twice is idempotent**, returning the same order rather than erroring.
That is the safer behaviour — a retried request must never bill twice — so the test asserts
"same order", not "second call fails". My original assertion would have locked in the worse
design.

### One test-design correction

Several tests failed for reasons unrelated to the code because they shared an order through
a describe-level `beforeAll`. Every test that needs an order now makes its own. Slower, and
worth it: a test that fails because of another test teaches you nothing.

## Step 20 — images into Postgres

The instruction was bytes in the database, "or as little as possible". `research.md` §13.2 had
advised against it; the decision stood, so the effort went into shrinking the footprint rather than
re-arguing the point.

Encodings measured on the real archive, not guessed:

| Format | Size | Share of source |
|---|---|---|
| source (jpg/png/webp mixed) | 2.88 GB | 100% |
| **WebP q78 @1400px** | **515 MB** | **17%** |
| AVIF q55 @1400px | ~455 MB | 15% |

AVIF was not chosen. Two points of size cost roughly 6× the encode time, and its decode cost on
mid-range Android is worse than the bandwidth it saves.

Result: **4,635 assets, 515 MB, 0 failures, 3,154 products repointed** in 1,106s.

Files: `src/media-store.ts` (bytea table via raw knex — Medusa's `model.define` has no bytea type),
`src/scripts/ingest-media.ts`, `src/api/media/[key]/route.ts`, `src/api/admin/media/route.ts`.

### The bug that would have shipped

The route was first at `/store/media/:sha`. Everything under `/store` requires an
`x-publishable-api-key` header, and **an `<img src>` cannot send a header**. So:

```
$ curl http://localhost:9000/store/media/1a35fae6….webp
{"type":"not_allowed","message":"Publishable API key required in the request header…"}
```

Every image on the site would have been blank, and the test suite would have stayed green — the test
client sets that header automatically. Images are public assets; they now live on a root route at
`/media/:sha`.

The regression test sends the request with **no headers at all**. It is followed by a second test
that fires the same headerless request at a route that definitely *is* gated and requires a 400 —
otherwise, if header suppression ever stops working, the first test passes whether the route is gated
or not and we are back where we started.

### A gap that turned out not to be one

After the first run, 1,038 image rows and 532 thumbnails still pointed at the local path. That looked
like the archive's checksum file being an incomplete index of what is on disk. It wasn't — every one
of those rows belongs to a **soft-deleted product from the duplicate merge** (Step 10). All 4,825 live
rows were repointed. The local-directory fallback added while chasing it stays, because the archive
genuinely is a point-in-time snapshot, but the comment now records what was actually true.

## Step 21 — tax, fulfilment, observability

### Tax — the two kinds of zero

`src/modules/tax-stripe`. The whole design turns on one distinction:

| Situation | Rate | `data.calculated` | Meaning |
|---|---|---|---|
| No economic nexus in the destination state | 0 | `true` | Correct and final |
| `STRIPE_TAX_ENABLED` off, or key missing | 0 | `false` | **Defect** |
| Stripe Tax call failed | 0 | `false` | **Defect** |

Without that flag, "no tax owed" and "we forgot to switch tax on" look identical in the database, and
under-collection compounds silently. On an API failure it fails **open on the sale, closed on the
claim** — checkout completes, the line is marked for recalculation.

It also skips the Stripe call entirely where there is no nexus: correct, and cheaper at 0.5% of
volume. Tested that it sends `12998` cents rather than `129.98`.

### Fulfilment — rating needs no account, labels do

`src/modules/fulfillment-shippo`. Rating is our own rate card, so it is live today. Making it a
*calculated* provider rather than flat prices is what makes the free-shipping threshold work at all —
a flat option cannot see the cart subtotal.

It reads `item_total`, not `total`. A test pins why: $71 of jerseys plus $4.99 shipping is $75.99 of
`total` but only $71 of goods, so it must **not** qualify for the $75 threshold. Reading `total` would
give shipping away at $70.01.

No retry on label purchase, and that is deliberate — Shippo's transaction endpoint is not idempotent,
so retrying a request whose response was lost buys two labels.

### Observability — no SDK

`src/observability.ts`. `@sentry/node` patches `http`, `async_hooks` and the module loader at import,
which is exactly where Medusa's worker/server split goes wrong, and `SENTRY_DSN` is a placeholder
anyway. A `fetch` to the ingest endpoint does the job, and with no DSN it still does the useful half:
grouped, counted, scrubbed logging.

Fingerprinting collapses the same bug across ids, numbers and quoted strings, so one bad deploy opens
one issue instead of thousands. Scrubbing is by key name **and** value shape — either alone misses
cases.

### Two outages I caused

1. **The error handler as a route middleware.** Medusa wraps route middleware and calls it with three
   arguments; a four-argument Express error handler then sees `next` as `undefined` and throws on
   every request. Every endpoint returned 500. It belongs in `config.errorHandler`.

2. **`config.errorHandler` replaces Medusa's.** So `next(err)` fell through to Express's *default*
   handler, which answered a routine "publishable API key required" 400 with a **500 HTML page
   containing a full stack trace** — a regression and an information disclosure in one. It now calls
   Medusa's handler explicitly.

Both are pinned by tests in `integration-tests/http/ops.spec.ts`, including one asserting that an
ordinary store request still returns under 500 — the assumption that broke.

### Measured, not assumed

User middleware runs **after** the publishable-key and auth gates:

```
store/products WITH key: X-Request-Id: 052ee6bb-…
store/products NO key:   ABSENT
admin/orders no auth:    ABSENT
```

So gate-rejected requests carry no request id. Acceptable — those are 4xx the reporter ignores anyway
— but documented and pinned, because "the header is missing" otherwise reads as a broken middleware
rather than a request turned away at the door.

## Step 22 — personalisation

Built per `personalisation-spec.md`; its §9 has the full status table. 45 unit tests on the core.

**The add-on is a real product, not a custom price.** Medusa refuses a client-supplied `unit_price`
outright, and overriding it server-side would take the add-on outside the pricing engine — losing its
own tax code, promotion eligibility and line-level refundability. So a personalised item is two cart
lines, folded into one row for display (`lib/line-groups.ts`) and kept separate on the order.

`POST /store/personalisation/attach` re-validates everything server-side and checks the add-on tier
actually in the cart against the request. A client that adds the $9.99 number variant and then asks
for a name *and* number is refused rather than printed.

### Four bugs the tests found

- **"from $7.99" for something nobody could buy.** The collapsed control quoted `min(PRICES)` — the
  patch price — while no patch list is configured. It now quotes only what is offered ($9.99).
  Under the UCPD that is not cosmetic.
- **A refused name was still priced.** Validation returned the normalised name alongside its error, so
  a blocked name came back `ok: false, total: $14.99`. Validation now returns only accepted fields.
- **The Scunthorpe problem.** Matching slurs against the de-spaced form catches "N I G G A" — and
  refuses *Scunthorpe*. Squashing now applies only to strings that look deliberately broken up (two or
  more single-letter tokens). Refusing a paying customer's own name is worse than an evasion the human
  review queue catches anyway.
- **The spec's own arithmetic.** §1 said a fully personalised shirt is $94.97; $19.99 + $7.99 on a
  $64.99 shirt is **$92.97**. Spec corrected, arithmetic pinned by a test.

### The RSC boundary, for the second time

Putting `groupLines` in `lib/cart.ts` and importing it into the client `CartDrawer` pulled
`next/headers` into the client bundle and 500'd every page. Same class as the `SortSelect` bug in Step
17, and `tsc` was happy both times. So the rule now has a test (`lib/line-groups.test.ts`): no client
component may import `lib/cart`, the shared modules are checked for server-only imports, and a final
test asserts `lib/cart.ts` really does import `next/headers` — otherwise the rule passes vacuously.

## Step 23 — the nine storefront gaps

Nine items, closed in order. Each one is listed with what was actually wrong, because in
five cases the gap turned out to be a different shape than the one-line description implied.

### 1. SEO — there was none

`app/sitemap.ts` · `app/robots.ts` · `lib/seo.ts` · `components/JsonLd.tsx` ·
`app/opengraph-image.tsx` · `app/jerseys/[handle]/opengraph-image.tsx`

**3,311 URLs** in the sitemap: all 3,155 products with their real `updated_at`, 140 team
listings, 7 league listings, the content and policy pages. 198 distinct `lastmod` values —
not one build timestamp, which is the version a crawler learns to ignore.

Three decisions worth recording:

- **Indexing is opt-in per environment** (`NEXT_PUBLIC_ALLOW_INDEXING`). A staging copy that
  lets crawlers in competes with the real store for its own keywords and the failure is
  silent for weeks. `robots.txt` closes and `sitemap.xml` empties when it is off; both were
  verified in each state.
- **One facet is a page, two is a filter.** Six facet dimensions over 3,155 products
  generate more permutations than there are products. A single-facet view gets a title, a
  canonical and an index directive; anything deeper, any search and any paged view gets
  `noindex, follow` — dropped from the index, still crawled through to the products. The
  rule lives in `generateMetadata`, **not** in `robots.txt`, because `Disallow` stops the
  crawl and a page that is never fetched never has its `noindex` read.
- **Structured data emits nothing it cannot substantiate.** `availability: BackOrder`
  because nothing is stock-tracked; `aggregateRating` only where reviews genuinely exist; no
  `priceValidUntil`, no invented `sku` or `gtin`. `lib/seo.test.ts` asserts the absences as
  well as the presences.

A sitemap built on `/store/jerseys` would have been 32 round trips per rebuild — that route
caps `limit` at 100 — so `GET /store/sitemap` returns handles and dates in one query.

### 2. Every legal and help link in the footer was dead text

Not a link with a wrong href: `<li>Privacy policy</li>`, with no anchor at all. Six of them,
and they were the exact pages §7 requires in order to sell.

Now real: `/policies/privacy`, `/policies/terms`, `/policies/refunds`, `/shipping`,
`/returns`, `/size-guide`.

The documents are **data** (`lib/policies.ts`, `lib/content.ts`) rendered by one component,
which buys the thing that matters: a section can declare the entity details it depends on,
and the page renders **"Not yet appointed — <why it is required>"** instead of silently
omitting a disclosure. On the privacy page today, *4 of 4* details in the controller section
are outstanding and the page says so. That is the §13.5 pattern — the product page's
regulatory block — applied to legal copy, where a plausible-looking guess is a false
statement to a regulator rather than a data-quality issue.

Every legal document also carries a **draft banner** until a lawyer has read it. A refund
policy is a contract term.

### 3. No customer accounts

`/account`, `/account/login`, `/account/register`, `/account/forgot`, `/account/reset` ·
`lib/account.ts` · `app/account/actions.ts`

Verified against the running backend rather than the docs: register → token, create customer
with that token, login, `/store/customers/me`, `/store/orders`, wrong password → 401,
duplicate registration → *"Identity with email already exists"*, reset request → 201.

- **The session token is an httpOnly cookie and never reaches the browser.** With Elements
  on our own domain we are in SAQ A-EP, and a JWT in `localStorage` is readable by any script
  that gets onto the page — which is what 6.4.3 and 11.6.1 are about.
- **Registration is two calls and the second can fail on its own.** An auth identity with no
  customer behind it can log in and show nothing, so that case is handled explicitly instead
  of signing the customer into a shell.
- **Sign-in is vague, registration is specific.** "That email and password do not match an
  account" either way at sign-in; "there is already an account with that email" at
  registration, where hiding it produces a failure the person cannot act on.
- **Guest orders are not retro-claimed** by registering with the same address. `/track` is
  the route to a guest order and it needs the order number too.
- **`auth.password_reset` had no subscriber.** The endpoint answers 201 and emits an event;
  without a handler the storefront honestly said "a link is on its way" and nothing was ever
  sent. `src/subscribers/password-reset.ts` now sends it, builds the URL from
  `STOREFRONT_URL` rather than a request header — the link is a credential — and never logs
  the token.

### 4. No discount code field

`components/PromoCode.tsx` · `applyPromo` in `lib/cart.ts` ·
`src/scripts/seed-promotion.ts`

Collapsed by default, because an open empty promo field tells every customer a better price
exists. §9.1 is the reason it is not the prominent mechanic: the fixed $0.30 does not shrink,
so a 20% code lifts the effective card rate from 3.33% to 3.43% on top of the $13.00 it gives
away. The free-shipping bar stays the loud control.

**Two things measured rather than assumed**, and they point opposite ways:

| Case | What Medusa does |
|---|---|
| Code does not exist | **400**, `"The promotion code X is invalid"` |
| Code exists but is `draft` | **200, and silently no effect** — empty `promotions`, zero discount |

The second is why `applyPromo` verifies by reading the cart back instead of trusting the
status code. Promotions are created `draft` by default, so this is the common case, not an
edge one.

### 5. Region-locked to a single hardcoded id

All five regions already existed in the database with their countries mapped — United States,
Canada, United Kingdom, Europe, Asia Pacific — and had matched the shipping zones since they
were seeded. Only the storefront was pinned to one `NEXT_PUBLIC_REGION_ID`.

`lib/region.ts` resolves the region from a cookie, **validated against the live region list**
so a stale cookie cannot poison every catalog query. `setRegionAction` writes the cookie and
moves the existing cart, because a cart left in the old region fails at checkout on
region-scoped shipping options rather than merely showing a wrong rate.

Measured, switching regions by cookie:

```
US  →  + $4.99 shipping to United States
CA  →  + $19.99 shipping to Canada
AP  →  + $29.99 shipping to Asia Pacific
```

That line on the product page was previously the string `+ $4.99 shipping`, hardcoded — right
for the US and wrong by up to $25 everywhere else. It is the same defect the cart already had
before it started reading the zone, one page earlier in the funnel and therefore worse.

`country_code: 'us'` was also hardcoded in `setCustomerAction`, so **every non-US order was
labelled domestic** — wrong on the customs declaration and wrong for tax. Checkout now offers
the region's real countries, and the labels follow ("ZIP" only where it means something).

**The picker shows a region we cannot lawfully serve as disabled, with the reason** — Europe
and the UK, until the three appointments exist. A hidden option reads as a bug and generates
the support email; a stated one answers it.

Currency is honest about what it is not: every region is priced in USD today, so switching
changes the shipping zone, the tax treatment and the accepted countries. It does not convert
prices, and nothing implies it does.

### 6. The CSP hardcoded `http://localhost:9000`

In `img-src` and `connect-src`. A CSP that works perfectly in development and blocks every
product image and every API call the moment the backend moves — build succeeds, page renders,
content missing. Now derived from `NEXT_PUBLIC_MEDUSA_URL`, origin-only (a path in a CSP
source is silently ignored). The PostHog entry appears only when the key does, because an
allow-list entry for an unused analytics host widens the payment page's script surface for
nothing and 6.4.3 asks us to justify each one.

### 7. No returns or exchanges

Medusa's returns domain is admin-side and assumes a case is already open, so there was no
store-side route for a customer to start one.

`return_request` model · `GET`/`POST /store/return-requests` ·
`/admin/return-requests` + queue page · `/returns` with the form · three email templates

The eligibility rule lives in **one pure function** (`src/returns.ts`) because three places
have to agree: the page deciding what to offer, the endpoint deciding whether to accept, and
the queue explaining the case. The endpoint **re-decides it on submit** — a client that
ignores the offer and posts anyway is refused rather than creating a row somebody has to
decline by hand.

- **The window runs from delivery, not purchase.** A jersey sourced to order can take 16
  business days to reach Europe; a window counted from purchase could expire before the
  customer held the shirt.
- **Who pays the postage is recorded at creation**, so the promise in the email is the promise
  in the row and whoever actions the case cannot revoke it.
- **A decline requires a note, and the note is the email.** Enforced by the endpoint.
- **Refunds and labels are not issued from the queue.** Both are irreversible external calls
  and Shippo's transaction endpoint is not idempotent — a retry whose response was lost buys
  two labels.

This also closed a listed gap: `/store/jersey-requests` had **no rate limit** on a public POST
that writes rows. `src/rate-limit.ts` now covers both endpoints, with its in-process
limitation stated rather than implied. (Step 39 removed that limitation and, more to the
point, fixed the identity the limits were keyed by.)

### 8. Fit guide, delivery copy, review data

The first two were written. The third turned out to be a different problem than the note
assumed.

**`/size-guide` renders from an empty `MEASUREMENTS` array and says so.** Chest and length
figures come from the supplier; publishing a generic apparel chart on a shop that pays for
size exchanges converts a data gap into a return we funded. The guidance around it is
accurate and needs no numbers.

**`/shipping` reads the live zone rate card** — the same module checkout charges from.

**Reviews: "waiting on a migration" was wrong.** The 2026-08-18 Judge.me export holds 84
published reviews averaging 4.94 (70 eBay, 7 Depop, 7 Facebook Marketplace) and its own notes
say *"Attached to a product: 0 — every one is a store review."* But 45 of them carry an exact
product title in the export's `item` field, and matching those on normalised title attaches
**17**. The other 28 name shirts no longer in the catalog and 39 name nothing.

So the real numbers, imported and idempotent (`src/scripts/import-reviews.ts`, re-run inserts
nothing):

| | |
|---|---|
| Imported | **84**, average **4.94** — matches the export's own cached aggregate exactly |
| Attached to a product | **17**, by exact title only |
| Named a shirt we no longer stock | 28 |
| Named no product | 39 |
| Unpublished rows imported | **0** — the same export holds 93 Judge.me had flagged as spam, 54 of them 1-star delivery complaints. There is no flag to let them in |

They live in `store_review`, not `product_review`, and the separation is the point:
`verified_purchase` is derived from *this* store's order history, and an eBay order cannot be
checked against it. Putting them in the same table would give them access to a mechanism that
cannot truthfully evaluate them, which is the FTC violation rather than a display detail.
Origin is disclosed on every card.

The §12.7 rule is asserted directly by a test: the **store** aggregate counts all 84, the
**product** aggregate counts only that product's, and neither leaks into the other's scope.
That is the defect the reference storefront shows — 137,135 reviews on its homepage, 8,342 on
a product page.

### 9. Accessibility beyond mechanical checks

The audit ran on 7 pages and deferred contrast and screen-reader behaviour to a human. Both
were narrowed:

**Contrast is now checked by a script** (`contrast_check.py`), in CI. 18 pairs, all passing.
It found one real failure: `--rule` at **1.27:1** was used both for decorative dividers
(exempt from 1.4.11) *and* for input, select, textarea and checkbox borders (not exempt). A
separate `--field` token at **3.37:1 on paper, 3.14:1 on wash** now covers control
boundaries, and the two tokens are kept apart deliberately.

**The audit grew from 7 pages to 18** and gained the checks that describe what a screen reader
announces rather than whether the markup parses: repeated landmarks need distinct accessible
names, radio groups need a `fieldset`/`legend`, a state-changing `<select>` needs a live
region, and the skip link must be first and must land on a real id. 0 issues across all 18.

**The checks are self-tested** (`a11y_selftest.py`, 24 cases, in CI). Every check gets a page
that must trip it and one that must not, for the same reason the media route's regression test
sends no headers at all: *a check that cannot fail passes whether the thing it guards works or
not*, and "0 issues across 18 pages" is precisely where that would hide. It also exits
non-zero now, so CI fails instead of printing a warning nobody reads.

Still genuinely outstanding: listening to VoiceOver or NVDA work the buy box and checkout, and
a keyboard-only traversal by hand. This narrows what that pass has to look for.

### Five bugs found doing this

**1. A bare field name silently zeroed every cart total.** Adding `discount_total` to the
cart's `fields` string switched Medusa from "the defaults plus these relations" to "only these
fields", so `subtotal`, `shipping_total` and `total` stopped being returned. The cart rendered
**$0.00 subtotal above a $69.98 total** while the same cart fetched without the field still
said $64.99. Nothing threw. `+discount_total` is the fix — the same `+` the product query
already used — and `lib/cart-fields.test.ts` pins it, verified by reintroducing the bug and
watching it fail. This is the trap the README already recorded one layer down on
`items.subtotal`, where it also failed as zeros.

**2. 56 product titles contained an invisible U+FFFC.** An OBJECT REPLACEMENT CHARACTER left
by the Shopify export, invisible in a database client, rendering as a tombstone box wherever a
real font drew it — `<title>`, the JSON-LD `name`, every share card and search result. Found
by *looking at a generated Open Graph image*, the only surface with no HTML fallback to hide
behind. `src/scripts/fix-title-artefacts.ts` cleaned 56 titles, 1 description and 1
`jersey_detail` row; it is report-only until `APPLY=1`.

**3. The media route lied about its own content type.** It accepted `.png` and `.jpg` in the
path, stripped them to get the content address, and served WebP bytes under a WebP content
type regardless. Harmless while every consumer was a browser. The consumer that noticed was
the OG route: Satori cannot decode WebP at all, so it fetched the shirt, silently got bytes it
could not read, and rendered a share card with a **blank panel where the jersey should be** —
no error, on a route only crawlers request.

**4. Fixing that broke every cached image, briefly.** The first version appended the format to
the ETag unconditionally, changing it for every existing `.webp` URL — which invalidates every
cached image in every browser and CDN for a response that is byte-identical. Caught by the
existing test asserting the plain ETag. The format now varies the ETag only when it varies the
bytes.

**5. `dynamic = 'error'` on the policy pages 500'd all three.** The intent was that a policy
page should survive a backend outage. But the root layout reads the cart, region and session
cookies, so no route in this app can be static, and the assertion asserted the wrong thing.
The property actually wanted is met by the documents being data in the bundle rather than a
fetch — which is what makes them render during an outage.

### One test-design correction worth keeping

The first version of `returns.spec.ts` created a return in one `it` and asserted the duplicate
rule in the next. The runner rolls the database back between tests, so the second test saw
nothing and reported the rule as broken while it was correct — six failures, all of them the
test's fault. Same convention as `community.spec.ts`: every test builds its own order.

The rate limiter then caused a second, opposite problem: its buckets are module state and every
request in a suite arrives from one address, so eighteen tests exhausted a 6-per-minute budget
around test seven and everything after it 429'd. Reset per test through the limiter's existing
`__reset` seam, rather than raising the limit under test — a budget only enforced in production
is not a tested budget, and two tests deliberately blow through it.

## Step 24 — the custom-jersey line

The live store — **cruxchristi.com**, which is where anyjersey.com now trades — has a product
line that did not exist when the 2026-08-18 archive was taken. Comparing the two catalogs is
what found it.

### What it actually is

Not the add-on model `personalisation-spec.md` §1 proposed. It is **66 blank shirts**, one per
team and colourway, sold as their own products:

| | Live store | This spec's model |
|---|---|---|
| Price | **$89.99** against a $64.99 base | $64.99 + $19.99 bundle = $84.98 |
| Printing | **Included** | An add-on |
| On a regular player jersey | **Not offered at all** — the control is absent from the page | Offered on any eligible shirt |
| Fields | `properties[Name]` (max 14) and `properties[Number]` (0–99), both optional | Same, plus patches |
| Screening | None visible | Blocklist + a human review queue |

The `<jersey-options>` control on their product page confirms it: `data-min="0"
data-max="99"`, `maxlength="14"`, *"Leave blank for a blank jersey. Name and number are
printed exactly as typed."* It appears on custom shirts and on nothing else — checked against
a regular jersey page, which has zero occurrences of it.

**Both models now exist here**, selected by `jersey_detail.is_custom`. `priceSelection(sel,
{ included })` prices every printing line at zero on a custom shirt and the cart creates no
add-on line — but the `line_personalisation` rows are still written, so the blocklist, the
human review gate and the §7 chargeback evidence apply to a custom shirt exactly as they do
to a paid one.

That last point is the one worth arguing. It would have been less code to treat "included" as
"no personalisation", and it would have sent printed shirts to a supplier with nothing
recorded about what to print on them.

### Three things the comparison found

**1. The price point is already validated.** $89.99 against $64.99 is a $25 uplift, which
brackets the $19.99 bundle §1 proposed as a guess. And "included at $89.99" is one decision
where "base plus add-on" is two, which is §12.4's argument for tiering in the first place.

**2. Two of the 69 products in that collection are not custom jerseys.** `MINNESOTA VIKINGS
DALLAS TURNER RIVAL JERSEY` and `BUFFALO BILLS GREG ROUSSEAU GREY JERSEY` are ordinary player
shirts at $64.99, mis-collected upstream. A third, `NEW ENGLAND PATRIOTS BLUE RIVAL JERSEY`,
*is* $89.99 but has no personalisation control — a premium player shirt, not a blank. The
import therefore requires **both** signals, title and price, and names what it skips. Either
signal alone lets one of those three through, and a name-and-number control on a shirt that
already has a player's name on the back is the visible result.

**3. Their name field has no screening at all.** Free text, printed exactly as typed. That is
a liability difference rather than a feature difference, and it is the reason the review queue
stays in place here even though the printing is free.

### The import

```bash
npx medusa exec ./src/scripts/import-custom-jerseys.ts            # report only
APPLY=1 npx medusa exec ./src/scripts/import-custom-jerseys.ts    # write
APPLY=1 npx medusa exec ./src/scripts/ingest-remote-media.ts      # pull the images in
```

Reads a snapshot in `src/scripts/data/custom-jerseys.json` rather than fetching live, so the
import is repeatable, reviewable in a diff, and does not depend on a third-party site being
up. Result: **66 products, 462 variants, 66 images (4.4 MB), 0 failures**, catalog 3,155 →
3,221.

Two parsing decisions, both to avoid facet damage:

- **Colour and edition are matched against the vocabularies the catalog already uses**, not
  extracted freely. The first version took everything after the team name and called it a
  colourway, which produced `White` next to the existing `white` and invented colours called
  `Rival`, `Throwback` and `Thanksgiving`. Splitting a facet in two is tedious to reverse once
  products are live.
- **`BURGANDY` is a typo on the source store** and is aliased to `burgundy`, which is the
  spelling the one existing product uses.

`src/teams.ts` is generated from `select distinct league, team from jersey_detail` rather than
typed out, so the importer's team list cannot disagree with the 3,155 products already
classified — including the historic franchises the catalog still sells.

### Two bugs found doing this

**1. The link step failed after both writes had succeeded.** `remoteLink.create` was passed
the literal string `productService` instead of `Modules.PRODUCT`. 66 products and 66 detail
rows existed; the join between them did not, which makes a detail invisible to every query in
the app because the link *is* the join. `link-orphan-details.ts` repairs it by
`source_handle`, is safe to run at any time, and belongs next to the other `fix-*` scripts —
any import that creates in two steps can be interrupted between them.

**2. The emptiness check was testing the price.** `if (priced.total === 0) return 400` was a
fine test for "nothing selected" right up until a legitimate selection could total zero. On a
custom shirt it would have refused every request. It now tests the selection.

### Storefront

`/jerseys?custom=true` is its own page with its own copy and canonical — a different product
at a different price, not a filter of the main catalog — and it is in the sitemap at priority
0.9. Nav entry, homepage rail on the dark band, a "Printing included" badge on the card, and
the personalisation control reading **"Included — no extra charge"** rather than `$0.00`. A
zero where a price goes reads as a bug; and quoting "from $0.00" for something already paid
for is the §7.10 problem in miniature.

## Step 25 — the missing pages, and a policy reversal

Building the pages cruxchristi.com has and this storefront did not, using its own copy. Two
of the three were straightforward. The third changed how the shop works.

### What was actually missing

Their sitemap lists three pages: `/pages/contact`, `/pages/data-sharing-opt-out`, and
`/pages/request-a-jersey` — we already had the last one. Plus a newsletter form in the footer
and five `/policies/*` documents.

| Page | Built as | Copy |
|---|---|---|
| Contact | `/contact` + `POST /store/contact` | Theirs, including the trader identity from their contact-information policy |
| Data-sharing opt-out | `/privacy-choices` | Theirs, verbatim — plus the control it promises |
| Newsletter | Footer + `POST/DELETE /store/newsletter` | Their heading |
| Shipping policy | `/policies/shipping` | Theirs |
| Refund policy | `/policies/refunds` | Theirs — see below |
| Privacy, Terms | **Not copied** | See below |

### Their privacy policy and terms could not be used

Both are the unmodified Shopify boilerplate, and they describe a platform we are leaving:

- *"The Services are hosted by Shopify, which collects and processes personal information…"*
- *"Crux Christi is powered by Shopify… any sales and purchases you make in our Store are made
  directly with Crux Christi, not Shopify."*
- `SECTION 9` opens with a literal `[NOTE TO MERCHANT: This section accurately characterizes
  Shopify's relationship with your store and should not be removed or modified.]`
- Three unfilled `[LINK]` placeholders where the privacy policy and refund policy should be
  cross-referenced.

Pasting that onto a Medusa storefront would publish false statements about who hosts the shop
and who the customer is contracting with. Ours stay, with their honest "not yet appointed"
gaps — of which one closed this step, because their contact-information policy supplies the
trade name, phone and email that `/policies/privacy` was listing as outstanding.

### The refund policy reverses research.md §12.4

This is the part worth arguing about. Their published policy:

> **All sales are final.** We do not accept returns, exchanges, or cancellations once an order
> has been placed. […] We do not accept returns for: **Incorrect size ordered**, Change of
> mind, Sale items, Gift cards.
> — cruxchristi.com/policies/refund-policy, retrieved 2026-08-29

§12.4 and §13.6 argued the opposite: a free size exchange as the jersey-category equivalent of
a money-back guarantee, chosen deliberately to offset shipping one photograph per product.
That is what Step 23 built, and it was promised in six places — the returns page, the size
guide, checkout, the buy box, the emails and the API.

**The store that is actually trading operates final sale.** Publishing that policy while the
checkout promises free exchanges would be the worst available outcome: a customer told one
thing at the point of sale and another when they try to use it, which is the §7.10 problem
with the shop's own money on the other side of it.

So the code follows the published policy, and `STANCE` in `src/returns.ts` is the single place
to change it back. Flipping it changes the API, the queue, the emails and the page together; a
test asserts the backend and the storefront agree on it, and another asserts the published
window matches the enforced one.

**What changed with it**, because a policy is not just a page:

| | Before | Now |
|---|---|---|
| Return kinds | `exchange`, `refund`, `fault` | `fault`, `wrong_item`, `withdrawal` |
| Wrong size | Free exchange, postage both ways | **Refused**, with the size guide offered in the refusal |
| Change of mind | 30-day refund | **Refused** — except where the statutory right applies |
| Postage | Ours on an exchange | Ours on our error; the customer's on a statutory cancellation |

### The one thing a published policy cannot remove

The EU/UK right of withdrawal is statutory, and their own policy honours it explicitly. So
eligibility now depends on **destination**, which is more correct than either model was
before:

```
US order,  "changed my mind"  ->  409, "All sales are final…"
DE order,  "changed my mind"  ->  accepted, inside 14 days
DE order,  day 15             ->  withdrawal lapsed, fault route still open
personalised, anywhere        ->  excluded from both, including the statutory right
```

The last line is not a policy choice either: made-to-specification goods are carved out of the
withdrawal right by the directive itself, which is why a custom-printed shirt is excluded even
in Germany.

The form shows a refused reason **disabled, with the reason**, rather than omitting it.
Somebody whose shirt does not fit needs to be told that by a form that recognises the reason —
and the refusal is the best placement the size guide has ever had.

### Two things their pages do that this one does not

**Their opt-out page has no opt-out.** It ends *"please follow the instructions below"* and
then has no instructions and no control. Under the twelve state laws that require an opt-out
mechanism, a page documenting the right without honouring it is the violation rather than the
remedy. The text here is theirs; the control is real, and it has three states — GPC already
set (nothing can override it), opted out by choice, and opted in.

**Their contact form emails a mailbox and stores nothing.** This one writes the row first and
emails second, which is the difference between "we never received it" being arguable and being
checkable.

### The newsletter is consent, not a mailing list

`inbound_message` carries `consented_at` and `unsubscribed_at`, and unsubscribing **suppresses
rather than deletes**: the defensible record under GDPR and the state laws is when consent was
given and withdrawn, and a deleted row cannot show that an address was suppressed rather than
never collected. The endpoint also answers identically whether or not an address is already
subscribed — otherwise a footer form is a way to test which addresses have shopped here, the
same enumeration problem the password reset has.

Nothing is sent: no marketing provider is configured (`OMNISEND_API_KEY` is still a
placeholder). The list is collected because a subscriber acquired today cannot be acquired
retrospectively.

### Worth flagging

- **The support address is a personal Gmail** (`scholarlove77@gmail.com`) and the trade name is
  **Crux Christi** while the storefront trades as *Find Any Jersey*. Both are now published
  because consumer law requires the trader to be identified; neither is a good long-term
  answer, and a domain mailbox is a twenty-minute job.
- **A registered postal address is still outstanding.** Their contact-information policy does
  not publish one, so `/contact` and `/policies/privacy` both still show it as a gap.
- **Their shipping policy says customers pay customs duties**; ours collects them at checkout
  (DDP), which is what the tax module and §7.2 were built for. The page keeps our behaviour and
  says so, because publishing "you may be charged on delivery" while charging at checkout would
  be the same contradiction in the other direction.

## Step 26 — catching the catalog up, and collections

The archive that seeded this catalog is dated 2026-08-18 and the shop kept trading. This
closes the gap and adds the one kind of navigation a facet cannot produce.

### The diff that mattered

`tools/sync_live_catalog.py` reads the live store's public `products.json` and diffs it
against what is here. **The diff is on `source_handle`, not on `handle`**, and that is the
whole trick:

| Diff on | Reported missing | Actually missing |
|---|---|---|
| `handle` | 2,152 | — |
| `handle` or `source_handle` | **1,104** | 1,104 |

Local handles are Medusa-generated slugs and the duplicate merge in Step 10 changed a
thousand of them. A naive comparison would have imported **1,048 duplicates** of shirts
already in the catalog — and they would have looked like new products, because they would
have had new handles.

### Result

```
products      3,222 → 4,324        variants +7,348        images 1,782 (208.7 MB), 0 failures
needs_review     42 of 1,102       custom jerseys      3
```

Parsing reuses `extract.parse_title` and `extract.norm_size` rather than reimplementing
them: those functions and the vocabularies behind them classified the existing 3,155, they
are covered by `tools/tests`, and a second parser drifts from the first the moment a team
name changes.

### One vocabulary gap, found by measuring

The live store's new NBA range — 447 products — titles shirts with the **city alone**:
*"Stephen Curry Golden State Basketball Jersey"*. `CITY_SPORT` in `vocab.py` existed for
exactly this and covered **only baseball**, so 64 products came through with no team at all
and dropped out of the team facet.

Adding 27 basketball cities took that to 34, and the 34 that remain are genuinely ambiguous:

> Los Angeles fields the Lakers and the Clippers; New York the Knicks and the Nets. Guessing
> one would file a Clippers shirt under the Lakers, and **a wrong team is worse than a
> missing one** — those fall through to `needs_review`, which is what it is for.

Six tests pin it, including that a full team name still wins over the city map and that
Boston resolves to the Celtics in basketball and the Red Sox in baseball.

### Two bugs the import found

**1. Duplicate option values.** 24 products offer the same size in two fits, and the Size
option was built with one entry per variant — `['S','S','M','M',…]`. Medusa rejects that
outright with *"Product option value … value: S, already exists"*. The fix is one
`dict.fromkeys`; the interesting part is that the diff **self-corrected**: after fixing it,
re-running the sync reported exactly the 24 that had failed, because the other 1,078 were
now in the catalog and no longer missing.

**2. An import is two writes and can be interrupted between them.** `import-catalog.ts`
creates products; `populate-catalog-details.ts` creates their `jersey_detail` and links it.
"Already imported" therefore means different things at the two stages, and a single
definition leaves the second stage finding nothing to do and the details silently never
written — which is exactly what happened to the custom jerseys in Step 24. Both scripts now
take a payload filename, and the sync takes `--stage products|details` with a different
query behind each.

### Collections: not Medusa's

The catalog's navigation is entirely facet-derived, which answers *"Chicago Bears shirts"*
perfectly and cannot answer *"what is selling"* or *"the World Cup range"*. Those are
editorial — a human decided what belongs, and no property of the product implies membership.

**Medusa's own `product_collection` was tried first and is the wrong primitive: a product
belongs to at most one of them.** The live store's groupings overlap heavily by design, and
importing 1,564 memberships into a one-of relationship resolved to first-wins:

| | With Medusa collections | With a membership table |
|---|---|---|
| Best Sellers | 415 | 415 |
| World Cup 2026 | 487 | **513** |
| Football 2026 | 278 | **357** |
| Rookie Draft Class | 27 | **48** |
| Shop by Team | 1 | **27** |

Best Sellers, being first, silently ate 80 products out of Football 2026 and 22 of the 49 in
Rookie Draft Class. So membership is its own table, 173 products legitimately appear in more
than one collection, and a test asserts that they do.

Eleven collections imported, **1,553 memberships**. Six of the live store's collections are
deliberately *not* imported — `football`, `basketball`, `baseball`, `hockey` and
`college-football` are league facets in disguise that `/jerseys?league=NFL` already answers
from data, and `customs-nfl` is already `jersey_detail.is_custom` with its own page.
Importing them would create two navigation systems over the same products, and the one built
on a hand-maintained list is the one that goes stale.

### Two smaller findings

**The route had to be renamed.** `/store/collections` is a *native* Medusa endpoint, and a
file route on that path does not replace it — it inherits its query validator, which
rejected `limit` and `region_id` with *"Unrecognized fields"*. It lives at
`/store/curated-collections`, and a test says why.

**Requesting `calculated_price` with no pricing context is a 400, not a null price.** Without
`region_id` the collection endpoint failed with *"Method calculatePrices requires
currency_code in the pricing context"*. The storefront always sends one, so it only ever
broke a direct call — a test that omitted it is what surfaced it.

### What was not done

**1,076 products are in this catalog and not on the live store.** They are not deleted here.
The shop sources to order, so a delisted product is not necessarily an unsellable one — that
is a merchandising decision, and the sync reports the number rather than acting on it.


## Step 42 — the NFL Shop layout, built

`layout-plan.md` had sat as a plan since 2026-09-07 with seven decisions awaiting an answer.
This builds it. The plan's own reasoning is unchanged and is still the place to read *why*;
what follows is what happened on contact with a real catalogue, and §11 of that document is
the short version.

### The shape

Five bands, in the reference's order. Two dark bands around a white masthead is the whole
visual idea — it is what makes the search field read as the centre of the page.

```
A  utility    dark · the sourcing promise left · Track · Help · Returns · Ship to
B  masthead   logo · 640px centred search · account · bag        ┐ sticky
C  catnav     12 slots + More, 8 of them with mega-panels        ┘
D  who-rail   circular team tiles, in team colours
E  mosaic     4 full-bleed destination tiles
```

Below 900px that collapses to one 56px row — ☰ · logo · magnifier · bag — with the bar
becoming a `<details>` accordion in a drawer and search taking the whole screen as a sheet.
Before this there was **no mobile menu at all**: the utility bar was hidden outright below
720px, so Track Order, Help, Returns and the account were unreachable on most of the traffic.

### The bar is a model, not a list in JSX

`storefront/lib/nav.ts`. Twelve slots and an overflow, the reference's own budget, built from
`/store/facets` and the curated collections:

```
Shop All · Shop by Team · Shop by Athlete · Best Sellers
Football · Soccer · Basketball · Baseball · College
Jerseys · Shorts & Kits · Custom          + More
```

Three rules hold it up, and the plan argued each of them before any of this was written:

| | |
|---|---|
| **Ordered data with a position** | `world-cup-2026` resolves to more products than Best Sellers. In a World Cup summer it takes a bar slot and Custom moves into More — that has to be a number, not an edit |
| **Derived, never typed** | Every team, athlete and count comes off the catalogue. Best Sellers is the single exception, because nothing about a product implies "best seller", and it is guarded on the collection existing |
| **A threshold, not a full bar** | Hockey (16) and MMA (13) are in More. A top-level nav item leading to sixteen products is a dead end that looks like a section |

Counts go in the panels and never on the bar. "Hockey 16" on a dark nav bar reads as an
apology. NBA is *on* the bar rather than in More as the plan recommended, because the Step 26
re-sync took it from 30 products to **477** — the recommendation was right for its data.

The panels are server components. `NavItem` is the only client code in the header and all it
owns is a boolean, so 173 team links and 120 athlete links are in the first response rather
than behind hydration. `layout.tsx:76` records that this codebase has put server data on the
wrong side of that boundary twice.

### Band D: colours, because logos are out and photographs are not built

The plan wanted a tight square crop of each team's best product photo. That needs a per-team
thumbnail endpoint that does not exist (§8 item 5), so the tile is the team's **colours** with
its initials over them — `storefront/lib/team-colors.ts`, 173 teams.

This is a better stopgap than it sounds. Fanatics is an NFL licensee and we are a reseller, so
their crests are out of the question either way; a colour pair is not a mark, is not
registrable on its own, and is how every broadcaster and newspaper denotes a club. It also
loads as CSS rather than as 173 images.

**The ink on each disc is computed, not chosen.** Packers gold and Cape Verde blue need
different text colours, and several pairs pass 3:1 against one and fail against the other.
`contrast_check.py` reads tokens out of a stylesheet and has no way to evaluate a colour
generated at render time, so a test asserts the 3:1 large-text floor across all 150+ entries
instead. A retro shirt keeps its own era's colours: Houston Oilers are not Titans navy.

### The data pass came first, as the plan argued it should

**MMA has a sport now.** `backend/src/scripts/classify-mma.ts` — `sport='mma'` derived from
membership of the `mma-2026` collection, which is a human's editorial list and a better signal
than anything in the titles. **13 rows, not the 12 estimated**, plus three fighter names that
had a garment word stuck on the end ("Ilia Topuria Short" → "Ilia Topuria"). Ten fighters who
were unreachable from every rail and every nav item now have a bar entry, a facet and a column
in the Athletes panel.

**`/store/facets` gained two things.** `players`, bucketed by sport and capped *per bucket* —
a flat top-N would have been entirely NFL and would have lost the fighters, who carry one or
two products each and are the whole reason the facet exists. And `league` **and** `sport` on
every team, paired off the catalogue rather than mapped by hand, because the storefront
otherwise needs a copy of `TEAM_LEAGUE` that goes stale the first time a team is renamed. The
two are not the same grouping: Barcelona is league CLUB and sport soccer.

**The cache key carries the payload shape.** `cacheKey('facets', 'v3')`. Without it the new
fields would have gone out behind a warm cache — every instance serving the old shape for five
minutes after a deploy while the storefront reading the new fields rendered an empty
navigation, with no error anywhere.

**What the pass exposed rather than fixed.** With the fighters classified, the unsported
`player` bucket holds only wreckage: "Detriot Lions", "Philidelphia 76ers", "Memphis Grizzles",
"Wyoming Cowboys Josh Allen" — team names and title fragments sitting in the `player` column.
`lib/nav.ts` drops that bucket from the Athletes panel and a test pins that it does, because
the alternative is a misspelled team in the navigation under the heading "Athletes". That is
§8 item 1 and it is still open: about 86 products have no sport.

### Four things the plan did not anticipate

**1. The listing page could not honour its own nav.** Five of the twelve slots filter on
`sport` and two carry two garment values. `/jerseys` read neither — the parameter was in the
URL, nothing read it, and the page returned the entire catalogue looking exactly like it had
worked. A multi-value filter reaches MikroORM as an `IN` only if the key is **repeated**
(`?garment=shorts&garment=set`); a comma arrives as the literal string `"shorts,set"` and
matches nothing. Worse, `buildQuery` dropped arrays when rebuilding a URL, so a shopper on
Shorts & Kits who touched a filter or the sort control was silently given all 4,323 products
with the chips still claiming a filter was applied. The test that asserted arrays were dropped
now asserts the opposite, and says why.

**2. Phone rails had to scroll sideways.** Eight six-product grids stacked two-up made the
homepage **13,595 CSS pixels** tall at 390px — roughly sixteen screens of product grid between
the mosaic and the reviews. They scroll horizontally below 700px now: **8,611**.

**3. `position: sticky` cannot dock an add-to-bag.** A sticky element is confined to its
parent's box and this button's parent is the size picker, so it pinned for a few hundred
pixels and then left with it — gone by the description, which is precisely the stretch it
exists for. It is `fixed`, and `body:has(.bagdock) main` pays for the space only on pages that
have one rather than putting 88px of dead air at the bottom of every page on the site.

**4. The bar wrapped, which is the exact defect §4 records against the old header.** Thirteen
items at the original spacing took two rows at 1440px. The fix is the gap and the tracking,
not the item count — our labels name an axis ("Shop by Athlete") where the reference's name a
sport.

### Two regressions the gates caught

Both were mine, both were invisible by eye, and both are the argument for having the gates:

- **Two comboboxes sharing the id `q-main`** on every listing page, once the masthead search
  stopped being the `compact` variant. `SearchBox` takes an explicit `id` now.
- **A homepage with no `<h1>`**, because the dark hero carried it. It is back as a one-line
  lede on paper above the mosaic — the store's own sentence at a weight that does not need
  60vh of ink and a second search box to say it.

### Also removed

The `.todo` block on the homepage **and the one on every product page**, directly under the
buybox, telling a customer that something is blocked at the moment they are deciding to buy.
Both are behind `NEXT_PUBLIC_SHOW_TODO` now. What they record is still true.

### Gates

```
a11y_check.py      0 mechanical issues across 25 pages
contrast_check.py  all pairs pass — 3 new ones for the dark band and the mosaic scrim
storefront         86 tests   (21 new: 12 nav model, 9 team colours)
backend unit       459 tests
backend http       catalog / jerseys / custom-jersey specs green against a real database
next build         clean
```

Verified in a browser at 1440px and at 390px: the bar on one row, the team panel with seven
league columns, the drawer accordion, the Shorts & Kits listing at 186 of 4,323 with two
independently removable chips, and the docked add-to-bag.

## Step 43 — the demo concept, integrated

`anyjersey_files/demo` is a single-file storefront concept built on the same catalogue —
"pick your sport" over a grid of sport tiles, a personaliser on the landing page, recently
viewed, multi-select filters. This takes the parts the spike did not have.

**The rule was: do not rebuild what already works.** Six of the demo's features were already
here and were left alone — the bag drawer, the free-shipping threshold, search suggestions,
the mega-panel navigation, the sticky add-to-bag, and the product-page personaliser, which is
considerably more capable than the demo's because it prices the selection and validates it
server-side. What follows is only the gaps.

### The tile band: a rail, and the caption under the photograph

The explicit ask, and the one place this deliberately diverges from the concept. The demo
lays the sport tiles out 4 × 2. As a grid that is two screens of tiles before a product
appears and the second row is below the fold on every laptop — so the sports at the bottom
of the catalogue end up at the bottom of the page too, which is the opposite of what a band
called "pick your sport" is for. One scrolling row keeps every sport the same distance from
the top and gives the band a fixed height whatever the catalogue grows to.

It now carries **ten tiles**: all seven sports, then Custom, Request and Best Sellers. Every
count and every photograph is the catalogue's. Arrows appear only where they are needed —
hidden when nothing overflows, and on touch, where the gesture is the affordance.

**The label sits under the image, not on it** — the second revision, and the more important
one. The first version bled the photographs edge to edge and set the label over them under a
dark scrim, which is what nflshop.com does in its *hero*. It costs something this catalogue
cannot easily pay: type over a photograph nobody art-directed has no guaranteed contrast, so
the scrim has to be heavy enough for the worst case — a white shirt on a white wall — which
darkens every image that did not need it. Their **editorial rail** puts the caption
underneath on the page ground, and that is the pattern here now.

Three things fall out of it:

- The label is ink on paper, which is a pair `contrast_check.py` can actually evaluate.
  Text over an image is not, and the previous version had to be argued about in a comment
  instead of measured. Three special-case pairs came out of that file.
- The photographs are shown rather than dimmed. `DEFERRED.md` §6 — two products in three
  have exactly one photograph and none of it is lifestyle work, so the little there is should
  be legible.
- The count stops being a pill floating over a corner and joins the caption line, where it
  reads as information rather than as a badge. It also stops being the accessibility problem
  the demo's own audit found: a white count on a translucent white pill, every sampled pixel
  under 4.5:1.

**The rail sits inside `.wrap`.** An earlier version bled it to the viewport and computed the
page gutter back with `100vw` arithmetic — which is off by the scrollbar width, and was
visibly off: the row started at 0 while every heading above and below it started at 96. It
overflows its container rather than the window, so the peek that tells a thumb there is more
survives while the first tile lines up with the page. Measured at 1440 and at 390: first
tile, lede and section heading all share a left edge, and neither width scrolls sideways.

### "Put your name on it" — built, then removed

The demo leads with a personaliser on the landing page and it was ported: a team picker, a
name and a number, a live proof in the team's real colours, and a draft that followed the
visitor to a product page and opened the real control already filled in. It worked, end to
end, across a real navigation.

**It came out after looking at it in place.** It sat directly under the Custom Jerseys band
— two adjacent ink bands, both headed some version of "put your name on it". The
propositions underneath are genuinely different (a $89.99 blank you buy, against a $9.99
add-on that works on any shirt), but stacked like that they read as the same thing said
twice, and the custom grid says it with product photography.

So the homepage carries the message once, in the Custom Jerseys band, and the live control
stays where somebody has actually chosen a shirt to put a name on — `Personalise`, on every
product page, priced and validated server-side. `Maker.tsx`, `lib/maker-draft.ts` and the
draft-seeding hook in `Personalise` went with it rather than being left unreferenced.

### Recently viewed, and the version of it that was wrong

The first build took a pool of products the page already held and showed the intersection —
no request, and **almost never a rail**: a homepage holds perhaps sixty of 4,323 products,
so two genuinely-viewed shirts turned into nothing. Caught by testing it end to end rather
than by reading it.

Caching the cards in `localStorage` would have worked and put a **stale price** on the one
rail whose whole job is to take somebody back to a shirt they are still deciding on. So the
browser holds only the handles, which never go stale, and `/store/jerseys` gained a `handle`
filter to turn them into current cards. `handle` is a product column where the facets are
`jersey_detail` ones, so the two are assembled separately — and a test asserts they compose
rather than one replacing the other.

**Why it is `localStorage` at all**, when this codebase is careful about personal data: the
alternative is a per-visitor record keyed to a cookie, which is a behavioural profile, needs
a lawful basis, and lands inside the §31 privacy work as a new category to export and erase.
A list of handles in the visitor's own browser never reaches us, so there is nothing to
disclose, export or delete.

### Three smaller gaps

**Multi-select filters.** The sidebar replaced the key outright, so choosing a second team
swapped it for the first. `toggleQuery` toggles within the key instead, and a chip now
removes its own value rather than the whole filter. The repeated-key plumbing from Step 42
is what made this three lines rather than a project.

**`/` focuses search.** The guard is the whole subtlety: it stands down inside any field,
anything `contenteditable`, and whenever a modifier is held — a shortcut that steals `/`
while somebody is typing a surname is worse than no shortcut.

**"More like this" reaches past the team.** It was team-only with no fallback, so a product
with no team showed **nothing** — and that is not an edge case, it is the entire MMA range:
ten fighters with a player, a sport and no club at all. Their pages were dead ends. It now
tries team, then league, then player, then sport, and takes the first axis that yields more
than the shirt itself. Widening one step at a time rather than pooling keeps a Cowboys page
leading with Cowboys.

### The bug the rails were hiding

Every sport rail on the homepage opened with six **Arizona Cardinals** shirts, three of them
the same shirt in three colours — the listing sorts alphabetically by handle, and `newest`
was no better because the catalogue was imported a team at a time. A homepage rail is a
sample of a sport, and a sample that is one club six times says the opposite of what the
band is for.

`lib/rails.ts` thins by team rather than re-sorting, so "newest" still means newest — it
just does not show the same club twice. Products with no team fall back to the player, which
is what keeps the MMA rail from collapsing to a single tile, and a sport with fewer clubs
than the rail holds keeps its duplicates rather than rendering a gap.

### What was deliberately not taken

**Star ratings on product cards.** The demo generates them and says so; this catalogue has
per-product review data for almost nothing, and a fabricated rating on a card is the §12.7
defect with worse consequences.

**Folding college football into football.** The demo does it to get to four tiles. A rail has
no tile budget to make room in, and `college football` is a real sport value on 320 products
here — collapsing it would need the league filter the demo's own README flags as a condition.

### Gates

```
a11y_check.py      0 mechanical issues across 25 pages
contrast_check.py  all pairs pass — 6 new ones for the personaliser band and the count pill
storefront         98 tests   (12 new: rail thinning, filter toggling)
backend unit       459 tests
backend http       catalog.spec.ts 20 green, including 3 for the handle filter
next build         clean
```

One real contrast failure found and fixed on the way: the personaliser's field border was
1.49:1 against its own ground where 1.4.11 wants 3:1. It looked fine, which is exactly why
`--field` exists on the light side of the site and why this one is checked rather than
eyeballed.

## Step 44 — the cookie banner depends on where the visitor is

The consent machinery was already right in the ways that are hard: nothing non-essential
loads before a decision, GPC wins outright before any banner logic, and Reject is as
prominent as Accept. What it did not do was vary by jurisdiction — every visitor got the
same EU-style question, including the ones whose law never asked for one.

### The rule

| Regime | Where | What renders |
|---|---|---|
| **opt-in** | EU/EEA · UK · Switzerland · Brazil · **California** · Québec | A question. Nothing runs until it is answered |
| **opt-out** | The rest of the US · Canada outside Québec · Asia-Pacific | A notice strip. Measurement on, one click turns it off |

Serving the opt-out notice into Europe would be an ePrivacy violation on **every page
view**. Serving the opt-in question everywhere is only an annoyance. So the failure
direction is chosen deliberately: with no edge header — local development, a direct origin
hit, a CDN not yet configured — the answer is `opt-in`.

### California is opt-in, and not because of the CCPA

California's own privacy law is an ordinary opt-out law. **CIPA is not**: it is a 1967
wiretapping statute whose pen-register provision plaintiffs have aimed at web trackers since
2024. Close to four thousand filings in California by July 2026, $5,000 of statutory damages
per violation, and the pattern in the outcomes is consistent — defendants who blocked
everything until an affirmative opt-in win, and defendants whose banner appeared after the
pixel had already sent data lose. A banner is not the defence; the ordering is. So
California is asked rather than told, and Québec joins it from Law 25.

### Where the country comes from, and where it does not

A CDN edge header — Vercel, Cloudflare, Fastly, CloudFront and Akamai are all read, in that
order. The edge overwrites whatever a client sent, so it cannot be forged into existence.

**It is not the shipping region.** `lib/region.ts` knows where the parcel goes, which the
customer chose; this is about where the person is when the page loads, which is what decides
whether a script may run. A German on holiday in Texas is still under GDPR. Conflating the
two would be the kind of bug that looks correct in every test written by the person who
wrote it.

**And we do not geolocate the IP ourselves.** That would mean sending a visitor's address to
a third-party lookup on the first page view — the exact processing the banner exists to
gate.

### The boundary

`lib/geo.ts` reads request headers, so it is server-only, and the component gets a plain
string: `regime="opt-out"`. The country never crosses into the browser bundle. `ConsentRegime`
is declared in `lib/consent.ts` rather than `lib/geo.ts` for the same reason — a client
component may import the type without dragging `next/headers` behind it. This codebase has
crossed that boundary twice before.

`Analytics` takes the same prop. Without it the two would disagree about what the default
is, one saying "measurement is on" while the other declined to load it.

### Verified against nine simulated locations

Driven through a real browser with the edge headers set, cookies cleared between each:

```
no header (local dev)    QUESTION    Germany      QUESTION    Texas       notice
United Kingdom           QUESTION    California   QUESTION    Ontario     notice
Brazil                   QUESTION    Québec       QUESTION    Australia   notice
```

Canada and California both abbreviate to `CA`, so the subdivision key carries the country —
`US-CA` and `CA-QC`. A test asserts Canada does not become opt-in because somebody read the
country code as the state.

### What it does not decide — closed in Step 45

## Step 45 — the policy follows the visitor, not just the banner

Step 44 made the *ask* depend on where somebody is and left the rest of the document global.
This closes that: the rights a reader has, the deadline we owe them, the body they complain
to, and the one retention period that is not ours to set.

### What was wrong with one global document

The privacy policy said, in a single paragraph:

> Wherever you live… In the EU and UK you also have… In California and the other US states…

Every word true, and it makes the reader do the triage. A Texan cannot tell from it whether
they may demand portability; a German cannot tell that we owe them an answer in one month
rather than forty-five days. **A right a reader cannot identify as theirs is one they will
not exercise.**

Worse, one sentence was actively wrong as a global promise. "We respond within 30 days" is
the GDPR period, and it is *slower* than Brazil's fifteen — so published to everyone it
committed this shop to missing the LGPD deadline for every Brazilian customer. It now leads
with the reader's own statutory period and keeps 30 days as the floor where their law sets
none.

### `lib/jurisdiction.ts`

Nine profiles, resolved from the same edge header Step 44 reads. Each carries the law's name,
the rights it actually grants, the statutory deadline, the complaint route, and the entity
appointments that jurisdiction's disclosure needs.

| | Law | Answer within | Notable |
|---|---|---|---|
| EU/EEA | GDPR | 30 days, +60 | Article 27 representative named as missing |
| UK | UK GDPR + DPA 2018 | 30 days, +60 | Complaint route is the ICO |
| California | CCPA/CPRA | 45 days, +45 | Opt-in regime for CIPA reasons, not CCPA ones |
| Rest of US | State law where there is one | 45 days, +45 | Sale/sharing opt-out, and the written appeal right |
| Brazil | LGPD | **15 days** | The period the old global sentence would have missed |
| Québec | Law 25 | 30 days | |
| Rest of Canada | PIPEDA | 30 days | |
| Switzerland | revFADP | **not published** | See below |
| Unknown | — | 30 days | Strictest profile, not the weakest |

**Two rules govern what may go in that file.**

**Only verified statutory facts.** Every number above was checked, not recalled. Switzerland
is the proof the rule bites: its period was not confirmed, so `responseDays` is `null` and
the page says we are confirming it rather than printing something authoritative-looking.
A published deadline is a promise a regulator can hold us to; a plausible guess is worse
than an honest gap. Same call `lib/policies.ts` already makes about a controller address.

**Nothing is hidden from anyone.** The document is unchanged and complete for every reader —
a regulator opening the URL sees the policy a customer does. What varies is which part is
put *first* and labelled as theirs. Tailoring a legal document by showing different people
different obligations is a different thing entirely, and not this.

### The retention row that is not ours to set

How long an invoice must be kept is the tax law of the place of supply — six years in one
country, ten in another. The register held seven years and published it as universal; it is
the US figure.

`backend/src/privacy.ts` gains `jurisdictionSet`, and `JURISDICTION_SET` alongside the
existing `UNRESOLVED`. The two are deliberately distinct: an unresolved row has **no** period
and nothing prunes it, while these rows have one that runs — it is simply the wrong
authority's number for a customer outside the US. Collapsing them would either stop pruning
invoices, which is worse, or hide the question.

Flagging it does not fix it and is not meant to. What it does is stop the seven being read
as settled: it is enumerable in the register, named to the reader whose law governs it, and a
test asserts the page does not restate it as everybody's. Resolving it is an accountant's job
per market.

### A markup bug, and the check that should have caught it

The first version put the panel in its own band **above** the document. It read correctly and
opened the page `h2` then `h1` — a screen-reader user pulling up the heading list got a
section before the thing it is a section of. `Prose` already had a `children` slot in exactly
the right place, between the title and the sections.

**The accessibility checker passed it**, because it looks for jumps going *down* and starts
at `prev = 0`, so the first heading never trips it and a late `h1` is not a jump. It now
asserts the outline starts at `h1`.

Scoping that rule took two passes and both exclusions are load-bearing. Headings inside
`<main>` only — the footer's come after it. And **outside any `<nav>`** — the mega panels
carry `h3` column labels and the facet rail carries `h3` group labels, both legitimate
structure inside a labelled landmark. Without the second exclusion the new rule fired on
every listing page. `a11y_selftest.py` now pins the defect and both exclusions: **27 of 27**.

### Gates

```
a11y_check.py      0 mechanical issues across 25 pages
a11y_selftest.py   27 of 27 — the new outline rule fires on the defect, not on the nav
contrast_check.py  all pairs pass
storefront         129 tests (22 new: jurisdiction mapping, deadlines, right-sets,
                   which disclosures code may fill in and which it must not)
backend unit       460 tests
next build         clean
```

Verified through a browser against eight simulated locations: each gets its own law, its own
deadline, its own right-set and its own complaint route.

### Two alignment and disclosure fixes on the way out

**The consent dialog's actions were not on one line.** "Essential only" sat 8px below
"Accept all" and the row was 60px tall for a 44px button. The cause was a `margin-top:1rem`
on `.btn.ghost.dark` — spacing the reviews block wanted below its list, riding on the class
into every other use of it. `align-items:center` centres the *margin* box, so a top margin on
one flex item offsets it by half. The margin is now `.reviews .btn.ghost.dark`: spacing
belongs to the thing being spaced, not to the button.

**The request channel now always resolves.** Of the three gaps the EU panel named, exactly
one could be closed in code, and it was the one that mattered most to a reader: GDPR
Art. 15–22, the US state laws, the LGPD and Law 25 all require a **contactable channel**, and
none of them requires a *dedicated* address. An empty `NEXT_PUBLIC_PRIVACY_EMAIL` was
therefore not an unmet legal requirement — it was a shop with a working, published mailbox
declining to name it, and a reader with a right to exercise and nowhere to send it. It falls
back to the support address, marked on the page as standing in rather than appointed, and a
dedicated address takes precedence the moment one is set.

### Still outstanding, and not fixable in code

Two, down from three:

| | Why code cannot do it |
|---|---|
| **Registered address** | A fact about the company. Not derivable from anything in this repository, and inventing it is a false statement to a regulator. One environment variable away |
| **GDPR Article 27 representative** | A contract with a firm established in an EU member state |

Both are named on the privacy page itself for a reader in the EU, and the consequence is
already enforced rather than merely disclosed: `EU_GATES` keeps EU and UK orders blocked
while they are unset, and a test asserts the request-channel fallback does **not** quietly
unblock them.

## Step 46 — the campaign banner

A full-bleed 8:3 band at the top of the homepage for a campaign video or still, modelled on
nflshop.com's kickoff banner. `NEXT_PUBLIC_HERO_VIDEO` or `NEXT_PUBLIC_HERO_IMAGE`; with
neither set it **does not render in production at all** and shows a correctly-sized
placeholder in development, so an unfinished campaign slot cannot reach a customer.

### Three corrections to the markup it is modelled on

The reference element is `<video playsinline loop preload="none" autoplay>`.

**`muted` is missing, and without it autoplay does not happen.** Every current browser
refuses to autoplay a video with an audio track unless it is muted. The result is a banner
that plays for whoever wrote it and shows a frozen first frame for everybody else, with no
error anywhere.

**`preload="none"` contradicts `autoplay`.** One says do not fetch until asked, the other
says start now. `metadata` plus a `poster` is the pair that behaves.

**Autoplaying motion needs a way to stop it** — WCAG 2.2.2, anything moving for more than
five seconds that starts on its own. The reference does have a pause control; it is the part
of the pattern that is easiest to drop.

On top of those, `prefers-reduced-motion` is checked **before autoplay is attempted** rather
than acknowledged by a CSS transition somewhere: that visitor gets the poster frame and a
play button.

### The CSP had no `media-src`

Media fell through to `default-src 'self'`, which happens to allow a file in `public/` and
**silently blocks** one served from the API or a CDN — the same class of failure
`DEFERRED.md` §1 records for the wallet buttons. Now stated explicitly, including the API
origin, since product media already lives behind it.

### Verified, not assumed

Driven through a real browser against a generated 1600×600 clip, then reverted to the
placeholder:

```
autoplay        paused:false  muted:true  loop:true  playsInline:true  readyState:4
pause button    paused:true   label → "Play the banner video"
resume          paused:false  label → "Pause the banner video"
reduced motion  paused:true   currentTime:0   play button still offered
band            1440 × 540 — exactly 8:3       CSP/media errors: none
```