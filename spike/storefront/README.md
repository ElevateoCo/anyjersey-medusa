# Storefront

Next.js 16 App Router over the Medusa Store API. Port **3000**; the backend is on **9000**.

This replaces the `create-next-app` boilerplate that was here, which among other things
claimed the project used Geist. It uses Inter and Oswald — condensed uppercase is the
register of a shirt number and a scoreboard (research.md §12.5).

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
cp .env.template .env.local     # fill in the publishable key and region id
npm run dev
```

## Pages

| | |
|---|---|
| `/` | Hero, league and team facets, two league rails, store reviews, request block |
| `/jerseys` | Faceted listing — search, sort, pagination, mobile filter drawer |
| `/jerseys/[handle]` | Product page: buy box, personalisation with live preview, reviews, breadcrumb |
| `/cart` · `/checkout` | Free-shipping progress, discount codes, Stripe Elements |
| `/account`, `/account/login`, `/account/register`, `/account/forgot`, `/account/reset` | Optional accounts — order history and addresses, nothing gated behind them |
| `/returns` | Returns policy and a self-service return form |
| `/shipping` · `/size-guide` | Help pages. Shipping reads the live zone rate card |
| `/policies/{privacy,terms,refunds}` | Legal documents, rendered from data |
| `/track` · `/order/[id]` · `/request` | Guest order lookup, confirmation, jersey requests |
| `sitemap.xml` · `robots.txt` · `opengraph-image` | Generated. Indexing is opt-in per environment |

## Four rules this codebase enforces

**1. `lib/cart.ts`, `lib/region.ts` and `lib/account.ts` are server-only.** They read
cookies, so importing one into a client component pulls `next/headers` into the browser
bundle and 500s every page. That has happened twice, `tsc` was happy both times, and
`lib/line-groups.test.ts` now asserts the rule — including a test that the shared module
really does import `next/headers`, so the rule cannot pass vacuously.

**2. Prices, discounts and eligibility are decided by the server.** The client sends a
variant id and a quantity; it never sends a price. A client that can name a price can name
$0.01 (research.md §5.2 rule 1), and the same reasoning covers discount amounts and whether
an item may be returned.

**3. Nothing is displayed that the data cannot support.** No compare-at price we never
charged, no rating without reviews behind it, no measurements we do not have, no
`aggregateRating` in the structured data unless real reviews exist. Where a required
disclosure is missing, the page shows it as a **gap with the reason** rather than omitting it.
research.md §7.10.

**4. Money is rounded to cents once, then displayed and summed from the same value.** A total
that does not add up on screen by a cent is the display-layer version of §6.2.

## Env

See `.env.template`. Three groups: the Medusa connection, the SEO origin
(`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_ALLOW_INDEXING`), and the trader identity the policy
pages read. Every identity field is empty by default and rendered as an outstanding
disclosure — `lib/site.ts` lists each one and what it blocks.

`NEXT_PUBLIC_ALLOW_INDEXING` defaults to **false**. A staging copy that lets crawlers in
competes with the real store for its own keywords, and the failure is silent for weeks.

## Tests

```bash
npm test          # vitest
npm run typecheck
```

Plus, from the repo root, two audits that need no browser:

```bash
python3 spike/contrast_check.py    # WCAG AA over the colour tokens
python3 spike/a11y_selftest.py     # proves the a11y checks can fail
python3 spike/a11y_check.py        # 18 pages; needs the dev server running
```
