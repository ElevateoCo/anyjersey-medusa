# Building an Ecommerce Store From Scratch

**No Shopify. No hosted platform. Own the stack.**

Research document · 21 August 2026 · Prepared for Roseyco / AnyJersey

---

## Scope and assumptions

This document answers one question: what does it actually take to build and run an ecommerce store
from the ground up, without Shopify or any comparable hosted platform, with Stripe as the primary
payment processor?

Assumptions baked in, stated up front so you can adjust:

| Assumption | Value | Why it matters |
|---|---|---|
| Merchant establishment | **United States** | Sets card rates, tax regime, consumer law, and — because the seller sits outside the EU — the import VAT and product-safety rules that apply to EU orders |
| Primary market | US, USD | Stripe US card pricing applies; state sales tax rather than VAT |
| Secondary markets | **EU and UK**, shipped from the US | Import VAT (IOSS / UK £135), customs duty, GDPR, GPSR, EAA all apply to those orders |
| Goods | Physical apparel, shipped B2C | Distance-selling rules, withdrawal rights, product-safety traceability |
| Product price | **$64.99** | A jersey. Single price point across the catalog |
| Shipping charged | **$4.99** | Charged to the customer, and **processed by Stripe**, so it carries card fees |
| Discounts | Applied | Deepen the effective card rate, and trigger reference-pricing rules (§7.10) |
| Average processed amount | **~$67** | $69.98 gross, less blended discounting. Drives the cost model (§9) |
| Team | 1–2 engineers, no dedicated ops or SRE | Determines what "run it yourself" realistically costs |

This is a US-established merchant selling internationally. That is the most demanding configuration
for compliance: you carry the US regime in full **and** the EU/UK regime for every cross-border
order, without the EU-establishment shortcuts (OSS, no Article 27 representative, no GPSR
Responsible Person) that a Danish entity would have. §7 is sized accordingly, and it is the largest
section in this document for that reason.

Where the answer differs materially for a US or UK merchant, it is noted inline.

Every price, fee, threshold and legal deadline in this document is sourced in §17. Figures were
verified in August 2026; payment and SaaS pricing changes often, so re-check before committing
budget.

---

## 1. Executive summary

**Building it yourself is technically achievable and, on cost alone, a losing trade.** The software
is roughly 21 engineer-weeks using Stripe Checkout and an open-source commerce core. But at US card
rates the platform saving that would fund it does not exist.

The reason is simple arithmetic. On a $64.99 jersey plus $4.99 shipping — $69.98 processed — Stripe's
standard US rate of **2.9% + $0.30** costs **$2.33**. Shopify Advanced, at **2.4% + $0.30**, costs
**$1.98**. **You pay roughly $0.30–0.35 more per order for the privilege of leaving.** Shopify
Payments charges 2.9% on Basic, 2.7% on Grow and 2.4% on Advanced, so the platform fee buys a lower
card rate; international orders make it worse, with Stripe adding +1.5% for a non-US card and +1%
for conversion (5.4% + $0.30 on a European card paid in euros).

| Orders / month | Shopify + apps | Own stack, managed | Own stack, optimised | Difference |
|---|---|---|---|---|
| 100 | ~$463 | ~$435 | ~$356 | **$107 cheaper** |
| 1,000 | ~$2,714 | ~$3,166 | ~$2,691 | **$23 cheaper** |
| 10,000 | ~$20,980 | ~$29,725 | ~$25,705 | **$4,725 more expensive** |

Read that table as a shape, not three numbers: at low and mid volume it is a wash — $107 and $23 a
month are noise — and at scale it goes decisively negative, **before** counting the ~$60,000–110,000
build or the 10–20 hours/month of maintenance. There is no payback period to calculate, because there
is no saving to pay anything back.

**That does not kill the project — it relocates the justification entirely onto personalisation.**
Name-and-number printing is confirmed as core to v1, and the arithmetic is favourable: at 10,000
orders/month the own stack costs about **$4,725/month more**, which personalisation clears if it adds
just **$0.47 of margin per order**. A $15 name-and-number upcharge at a 20% attach rate produces
roughly $30,000/month of revenue — more than six times the bar. So the business case is real; it is
simply a *revenue* case, not a cost-saving one, and it should be written down that way before anyone
commits budget.

**Shipping is not solved** (§14). $4.99 is roughly break-even domestically at 8 oz and
loses money at 1 lb, and internationally a parcel costs **$25–37** — 38–57% of the product
price. A $64.99 jersey lands at about **$112 in the EU** once VAT and the post-July-2026
€3 duty are added. International needs a zone rate card, not a flat rate.

**One pricing caution up front.** Discounts cost more than their headline percentage: the fixed $0.30
does not shrink with the discount, so a 20% off code lifts your effective card rate from 3.33% to
3.43% on top of the $13.00 of revenue it gives away. Prefer free-shipping thresholds, multi-buy and
free personalisation upgrades over straight percentage-off (§9.1, §12.4) — and whatever compare-at
price you display has to be a price you genuinely charged (§7.10).

**One lever worth pulling first.** Stripe offers custom interchange-plus pricing above meaningful
volume. Negotiating that rate *before* committing to the build is the single cheapest thing on this
list, because it is the only thing that closes the gap on processing.

**Compliance is the real cost of selling internationally from the US** (§7). Three items are hard
gates rather than best practices, and each one blocks EU revenue until it exists: an **IOSS
registration with an EU intermediary**, a **GDPR Article 27 EU representative**, and a **GPSR EU
Responsible Person** — without the last of these you cannot lawfully place apparel on the EU market
at all. Add US economic nexus across 45 states, 20 state privacy laws, Global Privacy Control
handling in 12 of them, WCAG 2.1 AA, and the FTC's reviews rule at $51,744 per violation.

**Storefront direction** (§12): benchmarked against [glowfare.com](https://glowfare.com) — which is
itself a Shopify store whose entire advantage sits in its offer construction and app stack, not its
platform. Take its architecture, and note carefully which of its conversion tactics are unlawful in
the EU *and* now actionable in the US.

**The recommended route if you proceed** (§3, §4): do not write commerce primitives from scratch.
Take **Medusa v2** as the commerce core, **Next.js** as the storefront, **Stripe Checkout Sessions**
as the payment step, and self-host on a managed platform. This gets you ~70% of Shopify's commerce
surface for free while leaving every part of it modifiable — which is the only reason to leave
Shopify in the first place.

---

## 2. What Shopify actually gives you

The single largest cause of failed platform migrations is discovering the scope late. Shopify's
monthly fee buys a large amount of unglamorous machinery. Every line below has to be replaced, bought,
or consciously dropped.

### Storefront and content

- [ ] Product listing pages, filtering, sorting, pagination
- [ ] Product detail pages with variant selection and per-variant media
- [ ] Collections — manual, and automated by rule
- [ ] Search with typo tolerance, synonyms, faceting
- [ ] CMS for pages (about, FAQ, shipping policy) and a blog
- [ ] Navigation and menu management without a deploy
- [ ] Image transformation, responsive srcsets, CDN delivery, WebP/AVIF
- [ ] SEO: canonical URLs, sitemaps, structured data, meta management, redirect table
- [ ] Multi-language and multi-currency presentment

### Commerce core

- [ ] Product / variant / option model with per-variant SKU, price, weight, barcode
- [ ] Inventory tracking across locations, with reservation so you don't oversell
- [ ] Cart persistence across devices and sessions
- [ ] Checkout: addresses, validation, shipping rate selection, tax, totals
- [ ] Discount codes, automatic discounts, quantity breaks, free shipping thresholds
- [ ] Gift cards (and the liability accounting behind them)
- [ ] Customer accounts, order history, saved addresses, passwordless login
- [ ] Draft orders and manual/phone orders

### Payments and money

- [ ] Payment processing with SCA/3DS
- [ ] Local payment methods per market (Apple/Google Pay, PayPal, BNPL, iDEAL, MobilePay)
- [ ] Fraud screening and rules
- [ ] Chargeback and dispute handling workflow
- [ ] Refunds, partial refunds, store credit
- [ ] Tax calculation per destination, with correct VAT treatment
- [ ] Invoices and receipts that satisfy EU invoicing rules
- [ ] Payout reconciliation into bookkeeping

### Fulfilment and post-purchase

- [ ] Live shipping rates, or a rate table you maintain
- [ ] Label generation and carrier handover
- [ ] Pickup point selection (mandatory in DK — GLS/PostNord parcel shops)
- [ ] Tracking numbers pushed back to the customer
- [ ] Shipping confirmation and delivery notification emails
- [ ] Returns portal, RMA numbers, return labels, restocking
- [ ] Abandoned cart recovery
- [ ] Transactional email deliverability (SPF, DKIM, DMARC, warm IPs)
- [ ] Marketing email and segmentation

### Operations

- [ ] Admin UI that a non-technical colleague can run the business from
- [ ] Roles and permissions
- [ ] Analytics: revenue, AOV, conversion funnel, product performance
- [ ] Hosting, CDN, TLS, DDoS protection, autoscaling
- [ ] Backups, tested restores, point-in-time recovery
- [ ] Uptime monitoring, error tracking, on-call
- [ ] Staging environment and safe deploys
- [ ] PCI DSS attestation
- [ ] GDPR data map, DPAs, deletion and export flows
- [ ] Accessibility conformance (WCAG 2.1 AA)
- [ ] An app ecosystem for everything you didn't think of

That is roughly 60 line items. Shopify Advanced costs $399/month. Read that list again with that
number in mind — the platform fee is not the expensive part of ecommerce.

---

## 3. Architecture options

Four honest routes, from most to least work.

### Option A — Fully bespoke

Next.js + Postgres + Stripe, every commerce primitive written by you.

- **Build:** 30–40+ engineer-weeks to Shopify parity. 8–12 weeks to a thin MVP that will hurt later.
- **You own:** cart maths, inventory reservation, order state machine, tax rounding, discount
  stacking, admin UI. All of it is well-understood and all of it is fiddly. Tax rounding and
  inventory reservation in particular are where homegrown systems quietly lose money.
- **Worth it when:** your commerce model is genuinely unlike a normal store, so a commerce
  framework's assumptions fight you more than they help.
- **Verdict:** Not recommended. You will spend most of your budget rebuilding solved problems.

### Option B — Open-source commerce core + custom storefront ✅

A self-hostable commerce backend supplies catalog, cart, orders, payments, fulfilment, promotions
and an admin dashboard. You build the storefront and your differentiating logic on top.

| | **Medusa v2** | **Vendure** | **Saleor** |
|---|---|---|---|
| Stack | Node.js / TypeScript | NestJS / TypeScript | Python / Django |
| API | REST + JS SDK | GraphQL | GraphQL-first |
| Extension model | Modules (TS classes, clear contract) | Plugins (typed lifecycle hooks) | Webhook "apps" as separate services |
| Admin included | Yes | Yes | Yes (dashboard) |
| Payments | Official Stripe module, swappable | Plugin-based providers | Stripe/Adyen/Braintree apps |
| Strength | Fast to customise, JS-native, largest momentum | Strong B2B, multi-channel, type safety | Enterprise readiness, multi-warehouse |
| Watch out for | v1→v2 was a near-rewrite; some enterprise features still maturing | Smaller ecosystem | Python stack alongside a JS frontend; app-based payments add moving parts |

- **Build:** 14–18 engineer-weeks to launch.
- **Verdict:** **This is the recommendation.** Medusa v2 if the team is TypeScript-first (it is);
  Vendure as the second choice if you need heavier B2B or prefer GraphQL end to end.

### Option C — Headless SaaS backend + own frontend

Keep a hosted commerce backend (Shopify's Storefront API, BigCommerce, Swell, commercetools) and
build only the frontend. Excluded by the brief, but name it explicitly: it delivers most of the
front-end freedom people actually want from "leaving Shopify" at a fraction of the cost, while
keeping PCI, tax, fraud and uptime as someone else's problem. If the real motivation turns out to be
"the theme constrains us," this is the cheaper answer and it deserves a deliberate rejection rather
than a silent one.

### Option D — Own storefront + Stripe Checkout only

Your app owns catalog and cart; the payment step redirects to Stripe-hosted Checkout, which supplies
tax, discounts, shipping selection, addresses and receipts. You still build orders, fulfilment and
admin.

- **Build:** 8–10 engineer-weeks.
- **Verdict:** The right *first phase*, not the destination. Ship this, then grow into Option B's
  admin and fulfilment surface. Also the best way to de-risk the payment path early.

### Recommendation

**Option B, sequenced through Option D.** Stand up Medusa v2, put Stripe Checkout Sessions in front
of the payment step from day one, and treat the custom storefront as the thing you actually invest
design effort in.

---

## 4. Recommended stack

One pick per layer, with a named alternative. Nothing here is exotic; boring choices are correct
choices when you are already taking on this much scope.

| Layer | Pick | Alternative | Reasoning |
|---|---|---|---|
| Commerce core | Medusa v2 | Vendure | TypeScript, modular, admin dashboard included, official Stripe module |
| Storefront | Next.js (App Router, React Server Components) | Remix / Nuxt | ISR for product pages gives Shopify-grade TTFB; large ecosystem |
| Database | Postgres (managed: Neon or Supabase) | Self-hosted Postgres on Hetzner | Transactional integrity is non-negotiable for money and inventory |
| Data access | Medusa's own layer; Drizzle for custom tables | Prisma | Drizzle's SQL-first model suits money maths and reporting queries |
| Cache / queue | Redis (Upstash or self-hosted) + BullMQ | Postgres-backed queue | Needed for webhooks, emails, label generation, index sync |
| Hosting — storefront | Vercel | Coolify on Hetzner | Vercel until bandwidth bills bite (§9); Hetzner is 10–20× cheaper with more ops |
| Hosting — backend | Railway or Medusa Cloud | Hetzner + Docker | Keep the money-handling service somewhere you can see and restart |
| Payments | Stripe (Checkout Sessions) | Mollie | See §5 |
| Tax | Stripe Tax (0.5% of volume) | Own engine + adviser | Buy it initially. At 10,000 orders/mo it is $3,250/mo, but US 45-state nexus plus EU/UK import VAT makes building it a real project (§7.1, §9.2) |
| Search | Typesense or Meilisearch (self-hosted) | Algolia | 5–10× cheaper than Algolia at store scale; both self-hostable free |
| Media / CDN | Cloudflare R2 + Images | Cloudinary | Zero egress fees on R2 matters for an image-heavy jersey catalog |
| Transactional email | Postmark | Resend | Deliverability specialist; order confirmations must not land in spam |
| Marketing email | Omnisend or Brevo | Klaviyo | Klaviyo is best-in-class and priced accordingly (~$1,380/mo at 100k profiles) |
| Content / CMS | Payload or Sanity | Markdown in the repo | Non-engineers need to edit pages without a deploy |
| Auth | Better Auth or Medusa's customer auth | Clerk | Customer accounts are simple; don't outsource a core object |
| Shipping | Shippo or EasyPost | ShipStation | One API covers USPS, UPS, FedEx, DHL domestic plus international; rate shopping, labels, customs docs. Shipmondo only helps if you later ship from an EU hub |
| Observability | Sentry + Better Stack (uptime + logs) | Grafana Cloud | You are now the on-call rotation; you need to know before customers tell you |
| Analytics | Plausible or PostHog | GA4 | Cookie-consent friendly; PostHog if you want funnels and session replay |
| Accessibility | axe-core in CI + manual audit | Overlay widget | Overlays do not achieve conformance and attract enforcement attention. Required by the EAA and prudent against ADA suits (§7.9) |
| Compliance vendors | IOSS intermediary, Art 27 rep, GPSR Responsible Person | — | Not optional and not engineering — see §7.2, §7.6, §7.8 and the run cost in §9.4 |

---

## 5. Payments deep dive

### 5.1 Choosing a Stripe integration path

Stripe's own current guidance is unambiguous and worth following: **use the Checkout Sessions API,
not raw PaymentIntents.**

| | **Checkout Sessions** ✅ | **Payment Intents** |
|---|---|---|
| Tax calculation | Built in — `automatic_tax.enabled = true` | Separate Tax API integration, wired by hand |
| Discounts / coupons | Built in | You calculate them |
| Shipping cost | Built in | You calculate it |
| Address collection | Built in (billing + shipping) | You build it |
| Receipts / order summary | Built in | You build it |
| Session expiry | Automatic after 24h | None — you build cleanup |
| Webhook events | Full checkout lifecycle | Payment status only |
| Adaptive Pricing | Available | Significant effort to replicate |
| UI options | Full-page hosted, embedded form, or Elements | Elements only |

PaymentIntents is the right choice only if you intend to own every part of checkout state and rebuild
discount, tax, subscription and currency-conversion logic yourself. For a store of this size that is
a poor trade.

> **⚠ Spike finding — this recommendation does not survive contact with Medusa.**
> Medusa 2.18's Stripe provider is **PaymentIntents + Elements**, not Checkout Sessions:
> it creates a PaymentIntent, hands the storefront a `client_secret`, and the storefront
> confirms it with Stripe's `PaymentElement`. Verified in the Phase 0 spike (`spike/`).
>
> The functional case for Checkout Sessions was that it supplies tax, discounts, shipping,
> addresses and receipts so you do not rebuild them. **With Medusa you are not rebuilding
> them — Medusa owns them.** So most of the argument evaporates, and what remains is a PCI
> question: Elements puts the card iframe on your domain, moving you from **SAQ A to
> SAQ A-EP** (§7.5) and making requirements 6.4.3 and 11.6.1 materially heavier.
>
> **Recommendation: accept Elements and budget the script-control work** — a strict CSP,
> SRI on third-party scripts, a script inventory in version control, and tamper
> monitoring. A custom provider redirecting to Stripe Checkout would keep SAQ A, but it
> means maintaining a payment provider against the ecosystem's grain for a compliance gain
> that disciplined script control also achieves.

**Three UI shapes, in order of preference:**

1. **Hosted full-page Checkout** — redirect to Stripe. Least code, best conversion optimisation
   maintained by Stripe, cleanest PCI position (SAQ A). Start here.
2. **Embedded Checkout form** — Stripe's prebuilt form inside your page, customer stays on your
   domain. Slightly more PCI scope.
3. **Elements / Payment Element** — you design the page, Stripe renders the card fields in an iframe.
   Maximum design control, most work, and pushes you toward SAQ A-EP (§7.5).

Enable **dynamic payment methods** so Stripe orders and shows the right methods per customer
locale rather than you hardcoding a list, and consider **Link** for returning-customer speed.

### 5.2 The payment lifecycle, end to end

```
 customer clicks "Pay"
        │
        ▼
 [your server]  create Checkout Session (idempotency key = cart id + revision)
        │        ├─ line items priced from YOUR database, never from the client
        │        ├─ inventory reserved with a TTL
        │        └─ automatic_tax enabled, shipping options attached
        ▼
 [Stripe]  hosted checkout → SCA / 3DS challenge → authorisation
        │
        ├──▶ browser redirected to /checkout/success?session_id=…
        │       ⚠ display only. NEVER create the order here.
        │
        └──▶ webhook: checkout.session.completed
                     │
                     ▼
             [your server]  verify signature → dedupe on event.id → in ONE transaction:
                     create order (price snapshot), commit inventory reservation,
                     release cart → enqueue: confirmation email, label, index update
                     │
                     ▼
             payment_intent.succeeded / .payment_failed
             charge.refunded  → refund record
             charge.dispute.created → freeze fulfilment, alert
```

**The five rules that prevent almost every payment bug:**

1. **Price on the server.** Accept a variant ID and quantity from the browser. Nothing else. Never
   accept an amount.
2. **The order is created by the webhook, not the browser.** The success redirect can be closed,
   blocked, or never reached. The webhook is the only reliable signal.
3. **Verify the signature, then dedupe on `event.id`.** Stripe retries; you will receive duplicates.
   A unique index on the event ID is the whole defence.
4. **Assume out-of-order delivery.** `payment_intent.succeeded` can arrive before
   `checkout.session.completed`. Handlers must be commutative — check current state, don't assume a
   sequence.
5. **Use idempotency keys on every write to Stripe,** derived from your own IDs, so a retried request
   never double-charges.

A correct handler is roughly this shape:

```ts
// app/api/webhooks/stripe/route.ts  — raw body, no body parser
export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature')!
  const raw = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return new Response('bad signature', { status: 400 })   // 400 = do not retry
  }

  // Dedupe + durable record BEFORE doing any work.
  const inserted = await db.insert(webhookEvents)
    .values({ id: event.id, type: event.type, payload: event })
    .onConflictDoNothing()
    .returning()

  if (inserted.length === 0) return new Response('ok')       // already seen

  await queue.add('stripe-event', { id: event.id })          // process async
  return new Response('ok')                                  // ack fast, < 5s
}
```

Ack fast, process in a worker. Doing the work inline is how you end up with Stripe retry storms and
duplicate orders.

### 5.3 Provider comparison

Rates for a **US-established** merchant, verified August 2026.

| Provider | Domestic cards | International card | Currency conversion | Fixed cost | Fit |
|---|---|---|---|---|---|
| **Stripe** | **2.9% + $0.30** | **+1.5%** | **+1%** | None | Best docs and SDKs, Tax/Radar/Billing in one place. Custom interchange-plus available at volume — ask. |
| **PayPal / Braintree** | 2.9% + $0.49 (PayPal checkout) | +1.5% | +3–4% | None | Add as a *method*, not as your processor. Materially worse FX. |
| **Adyen** | Interchange++ plus per-transaction fee | Passed through | Competitive | Enterprise contract, minimums | Genuinely cheaper above roughly $1M/yr processed. Worth a quote at that point, not before. |
| **Shopify Payments** (for reference) | 2.9% / 2.7% / **2.4%** by plan | Cross-border fee applies | Conversion fee applies | Plan fee | The benchmark you have to beat, and on Advanced you do not |
| **Mollie** | — | — | — | None | EU-established merchants only; not available to a US entity |

Note the asymmetry that drives §9: Shopify's *plan* buys you a lower card rate, so leaving the
platform means paying more per transaction unless you negotiate. Both columns carry international
surcharges — Shopify Payments also levies cross-border and conversion fees — so the international
penalty is not unique to Stripe. The structural point stands: **2.4% beats 2.9%.**

**Recommendation: Stripe, with a custom rate negotiated before launch.** The developer experience,
webhook reliability and bundled Tax and Radar are worth real money, and interchange-plus pricing is
the lever that makes the economics defensible. Revisit Adyen above ~$1M/yr processed.

### 5.4 Payment methods by market

Method coverage is a conversion issue, and it differs sharply by destination.

| Market | Enable | Note |
|---|---|---|
| **US** | Cards, **Apple Pay / Google Pay**, PayPal, **Affirm / Afterpay / Klarna**, Cash App Pay, Link | Wallets carry mobile conversion; BNPL lifts AOV on apparel |
| **EU** | Cards, Apple/Google Pay, **Klarna**, iDEAL (NL), Bancontact (BE), **MobilePay** (DK/FI), SEPA | Klarna is the highest-impact single addition; iDEAL is near-universal in the Netherlands |
| **UK** | Cards, Apple/Google Pay, Klarna, PayPal | — |

Use **dynamic payment methods** so Stripe orders and displays the right set per customer locale
rather than you hardcoding lists per country. Prices should be presented in the customer's currency
(Stripe Adaptive Pricing does this from Checkout Sessions), but note that presenting in a currency
you do not settle in is what triggers the +1% conversion fee — that is a margin line, not a rounding
error, and it needs to be in your pricing.

### 5.5 Other money mechanics you now own

- **Disputes:** $15 per dispute in the US. Radar's Smart Disputes takes 30% of the disputed amount
  with no fee if it loses.
- **Radar:** $0.05 per screened transaction on pay-as-you-go, or $0.07 with the advanced rule set.
  Turn it on before launch, not after the first attack.
- **Payouts:** standard payouts are free; instant payouts cost 1%. Use standard.
- **FX:** +1% whenever the presented currency differs from your settlement currency, on top of the
  +1.5% international-card fee. An EU customer paying in euros on a European card costs you
  **5.4% + $0.30**. Model international orders separately from domestic ones or you will
  misprice them.
- **Reconciliation:** Stripe payouts are net of fees, refunds and disputes. Someone reconciles
  payouts to orders to bookkeeping every month — across multiple currencies. Shopify partially did
  this for you. Budget for it.

---

## 6. Data model

The traps below are the ones that cost real money in homegrown stores.

### 6.1 Core tables

```
products ──┬── product_variants ──┬── variant_option_values ── option_values ── product_options
           ├── product_media      ├── inventory_items ── inventory_levels (per location)
           └── collection_products └── inventory_reservations (TTL)
                    │
              collections

customers ──┬── addresses
            ├── carts ── cart_lines ──▶ product_variants
            └── orders ──┬── order_lines        (PRICE SNAPSHOT — no FK price lookup)
                         ├── order_addresses    (COPIED, not referenced)
                         ├── payments ── refunds
                         ├── shipments ── shipment_lines
                         ├── tax_lines
                         └── discount_redemptions ──▶ discounts

webhook_events   (id = provider event id, unique — the idempotency backbone)
audit_log        (who changed what, when — you will need this within a month)
```

Roughly 22 tables. That is the honest floor for a store with variants, multi-location inventory,
discounts and returns.

### 6.2 The seven traps

1. **Money as integers in minor units.** Store `amount_minor BIGINT` plus `currency CHAR(3)`. Never
   floats. Never a single `DECIMAL` without currency. `19.99` in float arithmetic will produce an
   invoice that does not add up, and EU invoicing rules do not forgive that.

2. **Orders snapshot everything.** `order_lines` must carry the title, SKU, unit price, tax rate and
   discount *as they were at purchase*. If you join an order to `product_variants` to display its
   price, every historical order silently changes the next time you run a sale. This is the single
   most common homegrown-store defect.

3. **Addresses are copied into the order, not referenced.** The customer will edit their address.
   The shipped order must not change.

4. **Inventory needs three concepts, not one.** `on_hand`, `reserved`, and
   `available = on_hand - reserved`. Reserve at checkout-session creation with a TTL matching
   Stripe's 24h session expiry; commit on `checkout.session.completed`; release on expiry via a
   scheduled job. Decrementing stock only on payment guarantees overselling during traffic spikes;
   decrementing at add-to-cart guarantees phantom stockouts.

5. **Order status is a state machine, not a string column.** Enforce legal transitions in code:

   ```
   pending ─▶ awaiting_payment ─┬─▶ paid ─▶ fulfilling ─▶ shipped ─▶ delivered
                               └─▶ payment_failed ─▶ (retry) ─▶ awaiting_payment
   any ─▶ cancelled            (only while unfulfilled)
   paid+ ─▶ partially_refunded ─▶ refunded
   any ─▶ on_hold              (fraud review, dispute opened)
   ```

   Also track `payment_status` and `fulfillment_status` separately. A part-shipped, part-refunded
   order is normal, and a single status column cannot express it.

6. **Refunds are records, never mutations.** Never reduce an order total. Insert a refund row that
   references the payment and the lines. Your accountant needs the original invoice to remain intact.

7. **Tax is per line, computed at the destination, rounded once.** Store the rate, the taxable base
   and the tax amount per line. Round at the line level consistently and document the rule — EU
   invoices must reconcile to the cent.

---

## 7. Tax, legal and compliance floor

Selling from the US into the EU and UK means carrying two regulatory systems at once, without the
shortcuts an EU-established seller gets. Three items below are **hard gates**: until each exists you
cannot lawfully take EU orders at all. Walk this section past a tax adviser and, for §7.8 and §7.10,
counsel.

### 7.1 US sales tax and economic nexus

- All **45 sales-tax states** enforce economic nexus — you must register and collect once you cross a
  state's threshold, with no physical presence required.
- **41 states use $100,000.** California, Texas and New York sit at **$500,000**; Alabama and
  Mississippi at **$250,000**.
- **18 jurisdictions still apply a 200-transaction test**, and this is the trap for you specifically:
  at a $65 AOV, 200 transactions is **about $13,000** of sales in that state. You will trip
  transaction-count nexus long before revenue nexus in every one of them. Model nexus on order
  count, not revenue.
- Recent movement: Illinois removed its 200-transaction test effective 1 January 2026; Alaska
  repealed its own in 2025. The rules drift every year — this needs an owner, not a one-time setup.
- Consequence: registration, collection at the correct local rate, filing, and remittance in a
  growing list of states. This is the single strongest argument for buying tax automation rather
  than building a rate table.

### 7.2 Selling into the EU — import VAT, IOSS, and the July 2026 change

As a non-EU seller shipping goods to EU consumers, you are outside OSS. The relevant scheme is
**IOSS**, for consignments valued at **€150 or less**:

- IOSS lets you **collect destination-country VAT at checkout** and remit it through a single monthly
  return, so parcels clear customs without the customer being billed on delivery. Without it, your
  customers get surprise VAT and handling charges at the door — which produces refusals, returns and
  chargebacks.
- **A non-EU seller cannot register for IOSS directly.** You must appoint an **EU-established
  intermediary or fiscal representative** who registers and files on your behalf. **Hard gate.**
- **The €150 customs-duty exemption ended on 1 July 2026.** All low-value parcels are now dutiable:
  a **flat €3 customs duty per HS code** in the parcel applies on top of import VAT, regardless of
  value. An additional **EU customs handling fee** is expected from late 2026.
- Above €150, IOSS does not apply: full import VAT and duty are due, and you choose **DDP** (you
  pay, cleaner experience, more admin) or **DAP** (customer pays on delivery, worse experience).
- Practical effect on a $65 jersey: the €3 duty is roughly a **4–5% margin hit** on every EU order,
  before shipping. EU pricing has to absorb it deliberately.

### 7.3 Selling into the UK

- The UK sits outside the EU regime. For consignments of **£135 or less** shipped directly to UK
  consumers, an overseas seller must **register for UK VAT**, charge it at checkout, and remit to
  HMRC. There is no de minimis registration threshold for this.
- Above £135, import VAT and duty apply at the border.
- The customs-free £135 threshold was confirmed for removal at the November 2025 Budget, phased in
  later this decade, and an EU customs admin charge is scheduled for November 2026. Both change your
  landed cost — track them rather than hardcoding.

### 7.4 Invoicing and records

EU B2C invoices need seller identity and VAT identifier, invoice number and date, description,
quantity, unit price, taxable amount, VAT rate and amount per rate, and total — with retention
obligations. Stripe receipts are *receipts*, not compliant invoices. Generate and archive your own,
per destination regime.

### 7.5 PCI DSS — what remains yours with Stripe

Using Stripe does **not** remove your PCI obligations; it shrinks them.

- **Stripe hosted Checkout (redirect):** the card form is entered on Stripe's domain → **SAQ A**,
  the lightest questionnaire.
- **Stripe Elements (iframe on your domain):** under PCI DSS 4.0.1 this typically puts you in
  **SAQ A-EP**, because you control what else loads on the page.
- **Either way, two requirements are unambiguously yours**, mandatory since March 2025:
  - **6.4.3** — every script on your payment page must be authorised, integrity-assured against
    tampering, and listed in a written inventory with a justification per script.
  - **11.6.1** — you must detect unauthorised change to your payment page's headers and content.
- **This is the path we are on.** The Phase 0 spike established that Medusa's Stripe provider is
  Elements-based (§5.1), so **SAQ A-EP is the working assumption**, not SAQ A. That makes the
  following non-optional rather than advisable: a Content Security Policy that fails loudly,
  Subresource Integrity on every third-party script, a script inventory in version control with a
  justification per entry, and automated tamper monitoring on the checkout page.
- If a marketing colleague later pastes a pixel onto the checkout page, both requirements are
  breached. Put the checkout page's script list behind code review — the process matters as much as
  the configuration.

### 7.6 Privacy — GDPR applies to you, from the US

GDPR reaches you extraterritorially under **Article 3(2)**: offering goods to people in the EU is
enough. There is no small-business exemption and no EU office required for it to bite.

- **You must appoint an Article 27 EU representative** — a named person or firm in the EU acting as
  the contact point for supervisory authorities and data subjects. Choose a member state where a
  meaningful share of your customers are. EU and UK authorities are actively checking for this.
  **Hard gate.**
- **Data transfers to the US need a mechanism.** The EU-US **Data Privacy Framework** remains valid
  — the 2023 adequacy decision was upheld by the EU General Court in September 2025 — but a CJEU
  appeal is pending, and on 31 July 2026 the EDPB asked the Commission to reassess it. Both
  predecessor frameworks were struck down. **Certify under the DPF if you qualify, and maintain
  SCCs plus a Transfer Impact Assessment in parallel as a fallback.** Treat DPF invalidation as a
  live risk (§11), not a hypothetical.
- Also required: lawful basis per purpose, a **DPA with every processor** (Stripe, hosting, email,
  search, analytics, carriers), a processing map, working export and deletion flows — with
  anonymisation rather than deletion where tax retention applies — 72-hour breach notification, and
  **consent before any non-essential script fires** for EU visitors.
- A **UK GDPR representative** is a separate requirement if you target UK customers.

### 7.7 Privacy — US state laws and Global Privacy Control

- **20 states have comprehensive privacy laws in effect in 2026** (California, Colorado,
  Connecticut, Delaware, Indiana, Iowa, Kentucky, Maryland, Minnesota, Montana, Nebraska, New
  Hampshire, New Jersey, Oregon, Rhode Island, Tennessee, Texas, Utah, Virginia, Washington). Most
  use an opt-out model rather than GDPR-style consent.
- **As of 1 January 2026, 12 states require you to honour Global Privacy Control** — California,
  Colorado, Connecticut, Delaware, Maryland, Minnesota, Montana, Nebraska, New Hampshire, New Jersey,
  Oregon, Texas. The signal must be honoured **automatically**, without asking the user to confirm.
- Engineering consequence: your tag layer must read the GPC header and suppress sale/share tags
  before they fire. A consent banner that fires analytics first and asks later is non-compliance,
  not a UX preference — and it collides with the PCI script duty in §7.5. Fewer third-party scripts
  helps both problems.
- Also in scope: **CAN-SPAM** for email and **TCPA** for SMS, which requires express written consent
  before a single marketing text.

### 7.8 GPSR — the EU Responsible Person gate

The General Product Safety Regulation has applied since December 2024 and reaches apparel.

- A non-EU seller shipping direct to EU consumers is treated as an **importer** and **must designate
  an EU-established Responsible Person** — the named contact for market surveillance authorities,
  responsible for traceability and technical documentation.
- **Without one you cannot lawfully place products on the EU market.** Enforcement extends to
  existing listings through 2026, with audits, listing deactivation and account suspension as the
  observed consequences on marketplaces. **Hard gate.**
- Also required: manufacturer and safety information on the listing, traceability, and textile fibre
  composition labelling.

### 7.9 Accessibility — EAA and ADA

- The **European Accessibility Act** has applied to ecommerce services since **28 June 2025**. The
  standard is **EN 301 549**, incorporating **WCAG 2.1 Level AA**, across the entire journey:
  homepage, discovery, product pages, cart, checkout, confirmation, customer service. It applies to
  any business selling online to EU consumers **regardless of where it is established** — so it
  applies to you. Only microenterprises (under 10 employees *and* under €2M turnover) have limited
  exemption. Fines run roughly €5,000–500,000 by member state, and authorities can suspend sales.
- In the US there is no equivalent statute, but **ADA Title III** litigation over inaccessible
  storefronts is common and serial. The practical exposure is comparable; the mechanism is private
  suits rather than regulators.
- **Build to WCAG 2.1 AA once and both are satisfied.** This is a launch requirement, not a backlog
  item: retrofitting costs several times more, and accessibility-overlay widgets do not achieve
  conformance. Note what you lose — Shopify's themes ship a reasonable baseline; a bespoke
  storefront starts at zero.

### 7.10 Consumer law and advertising claims — both regimes

| Obligation | EU / UK | US |
|---|---|---|
| Right to cancel | **14-day withdrawal** from delivery, compliant form and instructions, refund of standard outbound shipping | No federal equivalent; your stated policy binds you under FTC Act §5 |
| Pre-purchase disclosure | Total price incl. VAT, shipping, delivery time, trader identity, complaint route, before the order button | FTC "Click-to-Cancel"/ROSCA disclosure for any recurring charge |
| Price-reduction claims | **Omnibus Directive**: a "was" price must be the **lowest price charged in the previous 30 days** | FTC deceptive-pricing guidance; state UDAP statutes |
| Reviews | Omnibus: disclose whether and how you verify reviews are from genuine purchasers | **FTC Consumer Reviews and Testimonials Rule**, effective 21 Oct 2024 — bans fake and AI-generated reviews, insider reviews, review suppression and incentivised sentiment. **$51,744 per violation.** First enforcement wave: warning letters to 10 companies, 22 Dec 2025 |
| Fake urgency | UCPD Annex I blacklists falsely claiming limited availability — prohibited per se | FTC dark-pattern enforcement under §5 |
| Subscriptions | Clear cancellation, no dark patterns | **ROSCA** — simple cancellation mechanism required |

The overlap is large enough that one honest standard satisfies both: truthful deadlines, reference
prices you can prove from your own order data, verified reviews only, and cancellation that is as
easy as signup. §12.7 works through what this means for the storefront tactics you were shown.

## 8. Operations you inherit

This is usually the section that decides the question. Shopify's fee is substantially a payment for
someone else carrying the items below.

| Responsibility | What it means once it's yours |
|---|---|
| **Uptime** | You are the on-call rotation. Checkout down at 21:00 on a Sunday is revenue lost and there is no support line to call. Define a target, then staff it honestly. |
| **Peak load** | Black Friday is 10–50× normal traffic. Load-test the checkout path *before* November, and know which component fails first (it is usually the database connection pool). |
| **Backups** | Not "backups exist" — **tested restores**. Run a restore drill quarterly and time it. An untested backup is a belief, not a control. |
| **Fraud and chargebacks** | Radar handles screening; you handle the review queue, the evidence submission, and the 200 kr per dispute. Card-testing attacks against a new store's checkout are routine. |
| **Failed payments** | Retry logic, dunning, and a recovery email flow. Silent failures are pure lost revenue. |
| **Abandoned carts** | Shopify recovers a meaningful share automatically. You now build the capture, the timing logic and the emails. |
| **Deliverability** | SPF, DKIM, DMARC, warm-up, bounce and complaint handling. If order confirmations go to spam, support volume explodes. |
| **Inventory truth** | Whatever else touches stock — a warehouse system, a marketplace, a physical till — must reconcile. Drift becomes oversells and cancellations. |
| **Deploy safety** | A bad deploy can take the store offline or, worse, corrupt prices. Staging, migrations that are reversible, feature flags, and a rollback you have actually practised. |
| **Secrets** | Stripe live keys, webhook secrets, carrier credentials. Rotation policy, no secrets in the repo, least privilege. |
| **Dependency and security upkeep** | Patch cadence for the framework, the commerce core and every dependency. You are a payment-adjacent target. |
| **Compliance drift** | VAT rates change, WCAG audits go stale, PCI script inventories rot the moment marketing adds a pixel. Someone owns a recurring review. |
| **Bus factor** | If one engineer built it and leaves, the business's revenue path is undocumented. Write the runbook as you go, not later. |

Realistic ongoing cost: **10–20 hours per month** in steady state, spiking hard around peak season
and any compliance deadline. At a loaded rate of ~$125/hour that is **$1,250–2,500/month** — and as
§9.6 shows, there are no platform savings for it to come out of. It is a straight addition to the
cost of running the business.

---

## 9. Cost model

**Method and assumptions.** Product $64.99, shipping $4.99 charged to the customer, discounts
applied. Volumes are **scenarios, not forecasts** — a greenfield store starts at zero. Primary
market is the US, so the payment mix is taken as **90% domestic / 10% international**, giving a
blended Stripe rate of **3.15% + $0.30** (0.9 × 2.9% + 0.1 × 5.4%). Shopify column uses Shopify
Payments on the plan appropriate to the volume. Both columns include the third-party tooling a real
store needs.

### 9.1 Unit economics per order

Two things about this price point matter more than they look.

**Stripe charges on the whole transaction, shipping included.** The $4.99 shipping charge is part of
the processed amount, so it carries roughly **$0.15** of card fees. Shipping is not a
fee-free pass-through.

**The fixed $0.30 makes discounts disproportionately expensive.** As the discount deepens the
processed amount falls but the $0.30 does not, so your *effective* rate rises:

| | List | 10% off | 15% off | 20% off |
|---|---|---|---|---|
| Product | $64.99 | $58.49 | $55.24 | $51.99 |
| Shipping | $4.99 | $4.99 | $4.99 | $4.99 |
| **Processed** | **$69.98** | **$63.48** | **$60.23** | **$56.98** |
| Stripe fee (2.9% + $0.30) | $2.33 | $2.14 | $2.05 | $1.95 |
| **Effective rate** | **3.33%** | **3.37%** | **3.40%** | **3.43%** |
| Shopify Advanced (2.4% + $0.30) | $1.98 | $1.82 | $1.75 | $1.67 |
| **Per-order penalty vs Advanced** | **$0.35** | **$0.32** | **$0.30** | **$0.28** |

That last row is the whole cost argument in one number: **you pay Stripe roughly $0.30–0.35 more per
order than Shopify Advanced would charge.** At 10,000 orders/month that is $3,000–3,500 before any
other line item.

Three consequences worth acting on:

1. **Discounts are more expensive than the headline percentage.** A 20% discount costs you $13.00 of
   revenue *and* raises your effective processing rate by 10 basis points. Prefer mechanics that
   protect the processed amount — free shipping over a threshold, multi-buy, a free personalisation
   upgrade — over straight percentage-off. See §12.4.
2. **Check whether $4.99 covers the label.** A jersey in a poly mailer runs roughly $5–7 domestic on
   commercial ground rates, so $4.99 is at or slightly below break-even. If it is subsidised, that
   subsidy belongs in the unit economics explicitly, not hidden in shipping.
3. **Shipping taxability varies by state.** Some US states tax shipping charges, others do not, and
   several depend on whether shipping is separately stated. Shipping has to be its own taxable line
   with a per-jurisdiction rule, and the discount has to reduce the taxable base before tax is
   computed. This is a real data-model requirement (§6), not a tax-tool checkbox.

**A pricing warning.** You said discounts will be applied. If $64.99 is presented as a reduction from
a higher "regular" price that you do not actually charge for meaningful periods, that is the exact
practice the EU Omnibus Directive prohibits and the FTC treats as deceptive pricing (§7.10, §12.6).
Whatever compare-at price you show must be the genuine lowest price of the previous 30 days, provable
from your own order data. Owning the database makes this easy — do it from day one rather than
retrofitting it.

### 9.2 Monthly run rate

At ~$67 average processed per order:

| | **100 orders/mo** | **1,000 orders/mo** | **10,000 orders/mo** |
|---|---|---|---|
| Processed volume | $6,700 | $67,000 | $670,000 |
| **Shopify path** | | | |
| Plan | Basic, $39 | Grow, $105 | Advanced, $399 |
| Processing (2.9 / 2.7 / 2.4% + $0.30) | $224 | $2,109 | $19,080 |
| Typical app stack | $200 | $500 | $1,500 |
| **Shopify total** | **~$463** | **~$2,714** | **~$20,980** |
| **Own stack — buy the managed version of everything** | | | |
| Processing (3.15% + $0.30) | $241 | $2,411 | $24,105 |
| Stripe Radar ($0.05/txn) | $5 | $50 | $500 |
| Stripe Tax (0.5% of volume) | $34 | $335 | $3,350 |
| Infrastructure + SaaS (see 9.3) | $155 | $370 | $1,770 |
| **Own stack total** | **~$435** | **~$3,166** | **~$29,725** |
| **Own stack — optimised** | | | |
| Own tax engine instead of Stripe Tax, self-hosted search, Hetzner instead of Vercel | | | |
| **Own stack total** | **~$356** | **~$2,691** | **~$25,705** |
| | | | |
| **Difference vs Shopify (optimised)** | **$107 cheaper** | **$23 cheaper** | **$4,725 more** |
| **Annualised** | **$1,284 saved** | **$276 saved** | **$56,700 lost** |

A US-primary payment mix keeps the gap smaller than it would be for a heavily international seller —
fewer non-US cards means fewer 1.5% surcharges — but the direction is unchanged:

1. **At small and mid volume it is roughly a wash.** $107/month at 100 orders and $23/month at 1,000
   are noise. Neither funds a build.
2. **At scale it is decisively more expensive.** Shopify Advanced processes at 2.4%; your blended
   Stripe rate is 3.15%. That 0.75-point deficit is structural.
3. **Stripe Tax at 0.5% is $3,350/month at the top tier** — nearly twice your entire
   infrastructure bill, and the reason the optimised row assumes you eventually own tax calculation.

### 9.3 Infrastructure detail

| Component | 100/mo | 1,000/mo | 10,000/mo |
|---|---|---|---|
| Storefront hosting (Vercel Pro + usage) | $20 | $40 | $250 |
| Commerce backend (Railway) | $20 | $50 | $200 |
| Postgres (managed) | $19 | $50 | $200 |
| Redis / queue | $10 | $20 | $50 |
| Search (Typesense/Meilisearch) | $20 | $50 | $150 |
| Media + CDN (Cloudflare R2) | $5 | $20 | $80 |
| Transactional email (Postmark) | $15 | $15 | $100 |
| Marketing email (Omnisend/Brevo) | $9 | $60 | $500 |
| Observability (Sentry, uptime, logs) | $30 | $50 | $200 |
| Domain, TLS, misc | $7 | $15 | $40 |
| **Total** | **~$155** | **~$370** | **~$1,770** |

Vercel's headline Pro price is $20 but real bills are usage-driven — a mid-size app with 2,000 active
users has been documented at $850/month once bandwidth, database and function time were counted.
Hetzner starts at €5.49/month for 2 vCPU / 4 GB and is roughly 10–20× cheaper at team scale, at the
cost of running it yourself. Typesense and Meilisearch are free to self-host against Algolia's Grow
plan at $550/month. Klaviyo reaches ~$1,380/month at 100,000 profiles; Omnisend or Brevo cover most
of what a store this size needs for far less.

### 9.4 Compliance run cost — new, and not optional

Selling internationally from the US adds fixed annual costs that have no Shopify equivalent because
they attach to the *seller*, not the platform. Ranges are indicative; get quotes.

| Item | Indicative annual cost |
|---|---|
| IOSS intermediary / fiscal representative (§7.2) | $1,000–3,000 |
| GDPR Article 27 EU representative (§7.6) | $500–2,000 |
| UK GDPR representative | $500–1,500 |
| GPSR EU Responsible Person (§7.8) | $1,000–3,000 |
| US sales tax registration + filing across states (§7.1) | $2,000–10,000+, scaling with state count |
| UK VAT registration and filing (§7.3) | $1,000–2,500 |
| WCAG 2.1 AA audit, initial then annual (§7.9) | $5,000–15,000 initial |
| **Indicative total, year one** | **~$11,000–37,000** |

These land whether you build or stay on Shopify — but Shopify's apps and Shopify Tax absorb part of
the tax-filing work, so the own-build carries more of it directly.

### 9.5 Build effort

| Phase | Scope | Weeks |
|---|---|---|
| 0 | Spike: Medusa v2 + Next.js + Stripe Checkout, one product, one real payment end to end | 1 |
| 1 | Catalog, PDP with variants, collections, cart, Stripe Checkout, order-from-webhook | 4 |
| 2 | **Personalisation**: add-on model, live preview, print-file generation, production hand-off | 3 |
| 3 | Orders, admin surface, fulfilment, carrier labels, returns/refunds | 4 |
| 4 | Search, transactional + marketing email, CMS pages, discounts, customer accounts | 3 |
| 5 | Compliance: multi-jurisdiction tax, invoicing, WCAG 2.1 AA, GDPR + GPC, PCI script controls | 3 |
| 6 | Storefront conversion surface (§12.6) | 3 |
| | **Total** | **21** |

At a fully-loaded $4,000/engineer-week, 21 weeks is **~$84,000**, realistically **$60,000–110,000**
(15–27 weeks) depending on storefront polish and how much of the tax problem you own.

### 9.6 The verdict on cost

There is no payback period, because at any volume worth having the own stack costs **more** to run
than Shopify. Stated plainly:

> **Building this saves nothing. It costs roughly $60,000–110,000 up front, $4,725/month more at
> scale, and 10–20 hours/month of maintenance. The only thing that justifies it is revenue Shopify
> cannot produce.**

That revenue is personalisation. The bar it must clear at 10,000 orders/month is **$4,725/month of
incremental margin — $0.47 per order.** A $15 name-and-number upcharge at a 20% attach rate produces
~$30,000/month, more than six times the bar. The project is fundable on that basis and on no other.
Two consequences follow:

1. **Personalisation is not a feature, it is the business case.** It cannot slip out of v1 — you
   confirmed it as core, and §9.5 puts it in Phase 2 — before orders and admin — for exactly this reason. If it slips, stop the
   project.
2. **Negotiate Stripe's rate before committing.** Interchange-plus pricing at volume is the only
   lever that closes the processing gap. Every 0.1 point is $670/month at the top tier.

## 10. Phased roadmap

Each phase has a definition of done. Do not start the next one until the current one is met.

### Phase 0 — Spike (1 week)

Prove the risky path first, before any design work.

- Medusa v2 running locally and deployed to a real host
- One product with variants, seeded
- Next.js storefront rendering PDP from the backend
- Stripe test-mode Checkout Session → webhook → order row in Postgres
- One real transaction in **live** mode for $1, refunded

**Done when:** a real card charge produces a correct order row via webhook, and killing the browser
immediately after payment still produces that order.

**Status: built, 7 of 8 steps verified** (`spike/`). Medusa 2.18 on Node 22, Postgres and Redis in
Docker, a US/USD region with Stripe registered, one real product from `tools/out/` at $64.99 with
$4.99 shipping and `manage_inventory: false`, an `order.placed` subscriber proving the webhook→order
path, and `verify_flow.py` driving the whole purchase through the Store API with **no browser
involved** — the cleanest possible test of the closed-browser case. Cart totals came out at exactly
**$69.98**, matching §9.1. The remaining step needs a Stripe test key.

Two findings came out of it. The Elements/PCI consequence is recorded in §5.1 and §7.5. The second:
**with `STRIPE_WEBHOOK_SECRET` unset, the webhook endpoint returns HTTP 200 to unsigned and
badly-signed payloads** — measured, not assumed. Nothing was mutated, because the forged event
resolved to no payment session, but the endpoint acknowledged rather than rejected it. The secret
must be set before that endpoint is ever public.

### Phase 1 — Storefront and checkout (4 weeks)

- Full catalog import from the current store, including images
- PLP with filtering and sorting, PDP with variant selection and media
- Collections, cart with cross-device persistence
- Stripe hosted Checkout with automatic tax, shipping options, Apple/Google Pay + PayPal + a BNPL
  method; EU/UK methods gated behind the §7 hard gates
- Inventory reservation with TTL, commit on payment, scheduled release
- Order confirmation email
- Accessibility built in from the first component, not audited in later

**Done when:** a colleague can buy a real product, receive a correct confirmation, and stock
decrements exactly once. Overselling is impossible under a concurrent-checkout test.

### Phase 2 — Operations (4 weeks)

- Admin: orders list and detail, fulfilment, refunds, manual orders, product editing
- Carrier integration (Shippo/EasyPost): rate shopping, label generation, customs documentation for
  international, tracking pushed back to the customer
- Returns flow with restocking
- Refunds and partial refunds, with correct records
- Roles and permissions
- Reconciliation export for bookkeeping

**Done when:** a non-technical colleague runs a full day of orders — pick, pack, label, ship,
one return, one partial refund — without an engineer.

### Phase 3 — Growth surface (3 weeks)

- Search with typo tolerance, synonyms, facets
- Discount codes and automatic promotions
- Customer accounts and order history
- CMS pages and blog
- Marketing email with abandoned-cart and post-purchase flows
- Analytics and funnel tracking

**Done when:** marketing can launch a campaign, publish a page and create a discount without a
deploy.

### Phase 4 — Compliance (2 weeks)

- **The three hard gates cleared and documented**: IOSS registration via an EU intermediary, GDPR
  Article 27 EU representative, GPSR EU Responsible Person (§7.2, §7.6, §7.8). No EU orders before
  all three exist.
- US sales-tax registration in every state where nexus is met — **modelled on order count, not
  revenue**, because of the 200-transaction trap (§7.1)
- UK VAT registration for £135-and-under consignments; destination VAT verified against a test
  matrix per market
- Compliant invoice generation and archiving
- WCAG 2.1 AA audit — automated (axe-core in CI) plus manual keyboard and screen-reader pass on the
  full funnel
- GDPR: DPA register, processing map, export and anonymisation flows, consent gating before any
  non-essential script, DPF certification or SCCs + Transfer Impact Assessment
- **Global Privacy Control honoured automatically** in the 12 states that require it (§7.7)
- PCI: CSP, SRI, script inventory document, change monitoring, SAQ A completed
- Consumer law both regimes: EU withdrawal form and pre-contract disclosure, Omnibus 30-day
  reference pricing, FTC-compliant review handling and ROSCA cancellation (§7.10)

**Done when:** each item has a written artefact — not a belief that it is handled.

### Phase 5 — Cutover (2 weeks)

- Customer and historical order import
- **Complete 301 redirect map** from every Shopify URL to its new equivalent — products,
  collections, pages, blog posts. This is the single highest-risk item in the migration; a botched
  redirect map costs organic traffic that takes many months to recover.
- Structured data, sitemap, canonical parity check against the old store
- Parallel run: new store live on a subdomain, real orders through both
- Load test at 20× expected peak
- Rollback plan with DNS TTL lowered in advance
- DNS switch during the lowest-traffic window, with someone watching

**Done when:** the redirect map is verified crawl-complete, and you can point DNS back inside 15
minutes if needed.

---

## 11. Risk register

Ranked by expected cost, highest first.

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **SEO collapse at cutover** — incomplete redirects, lost rankings | High | Severe, months to recover | Crawl the old store, generate the redirect map programmatically, verify every URL returns 301 to a 200. Keep the old sitemap. Do not change URL structure and platform in the same move. |
| 2 | **Scope discovery** — the §2 checklist turns out to be 60 items, not 20 | Very high | Budget doubles | Use §2 as the actual project backlog. Cut scope deliberately and in writing, not by discovery. |
| 3 | **Oversell / inventory drift** | High | Cancellations, reputation | Three-state inventory with TTL reservations (§6.2). Concurrency test before launch. Daily reconciliation job. |
| 4 | **Duplicate or missing orders from webhook mishandling** | Medium | Direct revenue and trust | Signature verification, unique index on event ID, order created only by webhook, async processing (§5.2). |
| 5 | **Accessibility non-conformance** | High if not planned | EU fines €5k–500k; US ADA suits | WCAG 2.1 AA as a Phase 1 design constraint; axe-core in CI; manual audit in Phase 5. |
| 6 | **VAT error accumulating quietly** | Medium | Back taxes, interest, penalties | Buy Stripe Tax initially. Verify against a test matrix. Have an accountant review the first OSS return. |
| 7 | **Peak-season outage** | Medium | A large share of annual revenue | Load test at 20× in Phase 5. Autoscaling and connection pooling. Known-good rollback. Someone on call. |
| 8 | **PCI script-control breach** — a pixel added to checkout | High over time | Attestation invalid, liability on breach | Prefer hosted Checkout (SAQ A). Strict CSP that fails loudly. Script inventory in version control. Change monitoring. |
| 9 | **Bus factor of one** | Medium | Revenue path becomes unmaintainable | Runbook written during the build. Two people who can deploy and roll back. |
| 10 | **Maintenance drag** — the store consumes the engineering capacity that was supposed to build the differentiator | High | The whole rationale evaporates | Budget the 10–20 h/month explicitly (§8). If that capacity does not exist, do not start. |
| 11 | **Fraud and card testing against a new checkout** | Medium | Chargebacks at 200 kr each | Radar on from day one, rate limiting on the session endpoint, review queue owned by a person. |
| 12 | **Deliverability failure** — confirmations in spam | Medium | Support load, refund requests | Dedicated sending domain, SPF/DKIM/DMARC, Postmark, monitor bounce and complaint rates. |
| 13 | **A hard gate is missed and EU orders are taken anyway** — no GPSR Responsible Person, no IOSS intermediary, no Art 27 rep | High if not tracked | Unlawful sales, listing removal, enforcement | Treat all three as launch blockers with named owners (§10 Phase 4). Geo-block EU checkout until they exist — a lost order is cheaper than an enforcement action. |
| 14 | **Transaction-count nexus trips unnoticed** at $65 AOV | High | Back taxes, penalties, interest across multiple states | Monitor order count per state monthly, not revenue. Automate the alert (§7.1). |
| 15 | **Data Privacy Framework struck down** on the pending CJEU appeal | Medium | Every EU→US transfer needs re-papering at short notice | Maintain SCCs + TIA in parallel now, so invalidation is a paperwork switch rather than a scramble (§7.6). |
| 16 | **Stripe rate never renegotiated** — the build ships on standard 2.9% | High | ~$4,725/mo structural loss at scale; $0.30–0.35 per order | Open the pricing conversation before Phase 1, not after launch (§9.1, §9.6). |
| 17 | **Licensing status of the catalog unconfirmed** — team and player marks across 3,400+ products | Unknown, unrecorded | **Existential**: processor termination, domain and listing takedowns, Lanham Act damages | Resolve before engineering spend (§13.9). This is the first question, not a launch checklist item. |
| 18 | **Youth sizes sold without CPSIA documentation** | High if unaddressed | CPSC action, recall, sales halt | Get supplier documentation for tracking labels, flammability and drawstrings, or drop youth sizes at launch (§13.9). |
| 19 | **Webhook deployed with `STRIPE_WEBHOOK_SECRET` unset** | Observed in the spike | Unauthenticated endpoint accepting forged payment events | Fail startup when the secret is missing outside development. Do not rely on remembering (§10 Phase 0). |
| 20 | **SAQ A-EP script controls drift** after launch | High over time | PCI attestation invalidated | CSP that fails loudly, script inventory in version control, checkout changes behind code review (§7.5). |

---

## 12. Storefront reference: the Glowfare model

**Two references, two different jobs.**

- **[anyjersey.com](https://anyjersey.com) is the portrayal reference** — what the store says, how a
  jersey is shown, the brand, the voice, and the proposition. It is the existing store, and its
  positioning is the strongest asset in this project.
- **[glowfare.com](https://glowfare.com) is the structural template** — how a page is built to
  convert. A direct-to-consumer funnel executed at a high standard, whose structural discipline
  transfers even though its category does not.

The work is AnyJersey's portrayal delivered inside Glowfare's structure. Neither alone is the answer:
AnyJersey knows what it is selling and has a bare page to sell it on; Glowfare has an excellent page
selling something with far less inherent appeal.

### 12.1 What AnyJersey already gets right

The proposition is not "we sell jerseys". It is **"we find the jersey you cannot find"**:

| Element | Verbatim |
|---|---|
| Announcement bar | "Can't find your jersey? Request it — we'll source it for you fast" |
| Hero | **"FIND ANY JERSEY"** / "Hard-to-find Jerseys Shipped On-Demand" |
| Request block | "CAN'T FIND YOUR JERSEY?" → "Tell us what you want" · "We find it + confirm details" · "We ship it to your door" |
| Trust row | "Tracked Shipping" · "Trusted by Fans" · "Secure checkout" · **"Rare Jerseys"** — "Sold out or custom? We'll find it" |
| Social proof | "4.9/5 based on 84 reviews" (Judge.me — real and verifiable) |
| Nav | Best Sellers · All Jerseys · Request a Jersey · Contact |

**The request mechanic is the differentiator, and it is better than anything in the Glowfare
playbook.** It converts the catalog's biggest weakness — a long tail nobody stocks — into the reason
to visit, and it is honest: no manufactured scarcity, just a real service. It also generates
something no competitor has: **a demand signal**. Every request is a customer telling you what to
source next, with an email address attached.

Two consequences for the build:

1. **Requests are a first-class object**, not a contact form. `jersey_requests` is in
   `tools/schema.sql` — captured on the homepage, on every product page, and on any empty search
   result, with the parsed team/player/size so the queue is sortable by demand.
2. **"Sold out" should never appear.** On the live store every variant of the product I examined
   reads "Variant sold out or unavailable", and the data agrees: inventory is untracked on 26,663 of
   27,703 variants, so 0-quantity plus a deny policy blocks a purchase the business would happily
   fulfil. For an on-demand sourcing model the correct setting is untracked with continue-selling,
   and the honest signal is a lead time, not a stock count. This is a live revenue leak, not a
   migration detail.

### 12.2 What Glowfare is, structurally

Read from the page source: **Glowfare is a Shopify store.** Its stack is
**GemPages** (landing-page builder), **Klaviyo** (email/SMS), **Rebuy** (upsells and cross-sell),
**Recharge** (subscriptions), **Judge.me** (reviews) and **Triple Whale** (attribution).

That matters more than anything else in this section. **Nothing about this storefront requires
leaving Shopify.** Everything that makes it convert — the offer construction, the page architecture,
the creative, the review volume, the email flows — sits *above* the platform. It is the clearest
possible confirmation of §1: build your own stack for product capability you cannot otherwise have,
not because a competitor's storefront looks better than yours.

It also means the reference is fully reproducible either way. Every mechanic below is listed with its
own-build equivalent in §12.6.

### 12.3 Page architecture — the product page *is* the site

The homepage is deliberately thin, a doorway with one job: get to the product page.

| # | Homepage block | Job |
|---|---|---|
| 1 | Announcement bar, "LIMITED TIME OFFER" + countdown | Manufacture urgency (see §12.7) |
| 2 | Hero — "Your Unfair Advantage. One Gummy At A Time" → CTA "Get Started Now" | One thesis, one action |
| 3 | Four expandable benefit cards | Benefit before ingredient |
| 4 | Brand story — "Become Your Best Self" | Identity, not product |
| 5 | Social proof — "Loved By Thousands!", "Over 5.6M Views On TikTok", 4.8/5 | Borrowed credibility |
| 6 | "Money-Back Guarantee", 30 days | Remove the risk |
| 7 | Footer — policies, payment icons | Legitimacy |

The product page carries the real weight — **17 stacked blocks**, in this order:

1. Six-image gallery with thumbnails
2. Title, 4.7 stars, "8,342 Happy Customers"
3. Tagline — "Replaces your morning coffee. Upgrades your entire day."
4. Four benefit icons
5. **Bundle tier selector** (§12.4)
6. Subscription option
7. "ADD TO CART"
8. Free-gift stack — "LIMITED TIME - FREE GIFT OFFER"
9. Guarantee badge — "Less than 1% of customers claim our 30-Day Money Back Guarantee"
10. FAQ, expandable
11. "Are these gummies for me?" — self-qualification
12. "How do they work?" — mechanism
13. "See it in action" — UGC video, "Over 4.4M Views On Instagram"
14. "As seen in" — press logos
15. Ingredient carousel, then "THE GLOWFARE PROMISE"
16. Founder story, then "TRANSFORM YOURSELF IN 90 DAYS" (day 1 / 30 / 60 / 90)
17. Comparison table — "We're Not Just Another Energy Booster" — then reviews, then the guarantee again

The pattern worth taking: **the PDP is a long-form landing page that answers every objection in
order, and the buy box sits at the top with everything below it existing only to send the reader back
up to it.** A sticky add-to-cart makes that return trip free.

### 12.4 The offer architecture

This is the most transferable part, and it is pricing design rather than web design. Values
confirmed against the product JSON:

| Tier | Label | Price | Compare-at |
|---|---|---|---|
| 1 | "Buy 1 Pack Get 1 Free — 30 DAY SUPPLY" | $69 | $137.99 |
| 2 | "Buy 2 Pack Get 2 Free — **MOST POPULAR!**" | $119 | $237.99 |
| 3 | "Buy 3 Pack Get 3 Free — **BEST VALUE!**" | $169 | $337.99 |

Note the construction: buy-one-get-one framing rather than a percentage, an anchor at roughly 2×,
the middle tier labelled most popular and the top tier labelled best value, so the decision becomes
*which* tier rather than *whether*. Layered on top: a subscription option ("Zero Commitment |
Exclusive Discounts | Cancel Anytime"), a four-item free-gift stack, and a **$4.99 shipping
protection** upsell in the cart drawer with a free-shipping progress bar.

**Translating this to jerseys.** Quantity bundles do not map — nobody wants six of the same shirt.
The equivalents are:

| Glowfare mechanic | Jersey-store equivalent |
|---|---|
| Quantity tiers (1/2/3 packs) | **Multi-buy across different shirts** — 2 for 15% off, 3 for 25% |
| — | **Kit bundle** — shirt + shorts + socks at a bundle price |
| Free-gift stack | **Personalisation included free** at the top tier (name + number print) |
| Subscription (Recharge) | **Season drop list** — pre-order the new kit, notify on restock |
| Shipping protection $4.99 | Same, as a real line-item product |
| Percentage-off codes | **Free shipping over $X** instead — protects the processed amount and the effective card rate (§9.1), and $4.99 is a cheaper giveaway than 10% of $64.99 |
| "30 DAY SUPPLY" framing | **Size confidence** — free size exchange, fit guide, "true to size" review data |

Personalisation deserves emphasis: it is a paid add-on that raises AOV, is impossible to
returns-abuse, and — per §1 and §9 — is exactly the kind of product capability that justifies owning
the stack in the first place. It is the strongest argument in this whole document for building.

### 12.5 Design language

**Take the brand from AnyJersey, not from Glowfare.** The existing store already has a coherent
athletic identity, read from its live CSS:

| Role | AnyJersey (use this) | Glowfare (do not) |
|---|---|---|
| Display face | **Oswald** — condensed, uppercase, reads as sports lettering | Rounded sans |
| Body face | **Inter** | Rounded sans |
| Accent | **`#F9E806`** high-visibility yellow | `#EF4A65` coral |
| Secondary | **`#108474`** teal | `#6B2FA0` purple |
| Ink / ground | **`#121212`** on white | `#211A28` on white |

Oswald set uppercase is doing real work: it is the register of a shirt number and a scoreboard, and
it is exactly what a supplement brand cannot borrow. Keep it. The yellow is the single bold spend —
use it for one action colour and nothing else, and let jersey photography carry the rest of the page.

What to take from Glowfare here is structural, not chromatic: full-bleed single column, white ground
so product imagery carries the page, one high-contrast action colour, badge rows, sticky add-to-cart.

**One data note.** Titles are stored Title Case (`Buffalo Bills Josh Allen Grey Jersey`) and
uppercased in the display layer via `text-transform`. The live store stores them shouted, which
makes the data wrong for search, alt text, structured data and any future export. Keep the caps as a
presentation choice, not a storage one.

### 12.6 Mechanics inventory → own-build equivalents

| Mechanic | Glowfare uses | Own-build equivalent | Effort |
|---|---|---|---|
| Page building without deploys | GemPages | CMS with section blocks (Payload, §4) | 2 weeks |
| Bundle and tier pricing | Theme + variants | Price-rules engine over `discounts` (§6) | 1 week |
| Reviews with photos | Judge.me | Own reviews + moderation, or keep Judge.me | 1 week |
| Email and SMS flows | Klaviyo | Omnisend or Brevo (§4) | included |
| Cart and post-purchase upsell | Rebuy | Own upsell slot in cart drawer | 1 week |
| Subscriptions | Recharge | Stripe Billing, 0.7% of billing volume | 1–2 weeks |
| Attribution | Triple Whale | PostHog + server-side events | 1 week |
| Cart drawer, free-ship progress | Theme | Own component | 3 days |
| Shipping protection upsell | App | Own line-item product | 3 days |
| Countdown and urgency | App | Own — but read §12.7 first | 2 days |

The full list sums to roughly **7–9 engineer-weeks**, but email, reviews and attribution overlap
Phases 4 and 5. The genuinely additional work is about **3 weeks — Phase 6 in §9.5**. Budget it
explicitly; the storefront conversion surface is the part most often left out of build estimates
entirely.

### 12.7 What not to copy — EU legal exposure

Glowfare sells primarily into the US. Several of its highest-performing tactics are unlawful for EU
customers — and since October 2024 the review tactics are directly actionable **in the US too**, at
$51,744 per violation. This is not a stylistic objection.

| Tactic on the site | EU position |
|---|---|
| **Countdown timer that resets** on every visit | Blacklisted outright — Unfair Commercial Practices Directive, Annex I: falsely stating a product will be available only for a very limited time. Prohibited per se, no proof of harm needed. |
| **"$69, was $137.99"** as a permanent compare-at price | Omnibus Directive requires any price-reduction announcement to reference the **lowest price charged in the previous 30 days**. A compare-at that was never actually charged is a prohibited practice, and Forbrugerombudsmanden actively enforces it in Denmark. |
| **"Low Stock - Selling Fast"** when not true | Misleading commercial practice. |
| **Review counts that disagree** — 137,135 on the homepage vs 8,342 on the product page | EU: Omnibus requires you to disclose whether and how you verify reviews. US: the **FTC Consumer Reviews and Testimonials Rule** (effective 21 Oct 2024) bans fake, AI-generated and insider reviews, review suppression and incentivised sentiment — **$51,744 per violation**, with the first warning letters issued 22 Dec 2025. This one is enforceable in your primary market. |
| **"Clinically Proven Results"**, comparison to a prescription stimulant | Unsubstantiated claims. Not directly applicable to jerseys, but the underlying rule is: every factual claim needs evidence. |
| **Four-item "free gift" stack** whose cost is inside the price | "Free" must mean free. |
| **Heavy third-party script load** | Collides with your PCI script-inventory duty (§7.5), EU consent-before-firing and US Global Privacy Control (§7.6, §7.7). |

**The lawful version of the same playbook** — and it converts nearly as well:

- **Real deadlines only.** A drop that genuinely closes Sunday, a pre-order window with a real
  production cut-off, a restock date. Truthful scarcity is more credible than a fake clock.
- **Honest reference pricing.** Show the 30-day lowest price and be able to prove it from your own
  order data. Owning the database makes this straightforward — a real advantage of the own-build.
- **Verified reviews only**, with the verification method stated, sourced from actual orders.
- **Real inventory numbers** — you have them; "3 left in L" is both true and more persuasive.
- **Guarantee near the CTA.** Free size exchange within 30 days is the jersey-category equivalent of
  the money-back guarantee, and it directly answers the real objection, which is fit.

### 12.8 Blueprint: AnyJersey portrayal, Glowfare structure

AnyJersey's proposition and brand, in Glowfare's page architecture, with one image per product
(§13.6) and honest urgency (§12.7).

**Homepage** — keep AnyJersey's order; it is already close:

| # | Block | Source |
|---|---|---|
| 1 | Announcement: "Can't find your jersey? Request it — we'll source it for you fast" | AnyJersey, unchanged |
| 2 | Hero: **FIND ANY JERSEY** / "Hard-to-find Jerseys Shipped On-Demand", one CTA | AnyJersey, unchanged |
| 3 | Trust row: Tracked Shipping · Trusted by Fans · Secure checkout · Rare Jerseys | AnyJersey, unchanged |
| 4 | Verified rating, sourced from real orders | AnyJersey + §12.7 |
| 5 | **Shop by league / team / player** — 3,591 products need real facets, not four collections | New (§13.3) |
| 6 | Best Sellers, NFL 2026, Rookie Class grids | AnyJersey, unchanged |
| 7 | **Personalisation teaser with live preview** | New — the business case (§9.6) |
| 8 | Request block: the three-step process | AnyJersey, promoted |
| 9 | Newsletter, footer, payment marks | AnyJersey, unchanged |

**Product page** — this is where the work is. AnyJersey's PDP is currently a single image, an
all-caps title, a price, a size dropdown, an add-to-cart and a newsletter. Glowfare's is 17 blocks
of objection handling. The target:

| # | Block | Status today |
|---|---|---|
| 1 | Single image, large, zoom on click | ✅ exists |
| 2 | Title, verified rating, price | ✅ exists |
| 3 | **Size selector as buttons, not a dropdown**, with a fit note | ⚠️ dropdown |
| 4 | **Personalisation module** — name, number, live preview, clear add-on price | ❌ missing |
| 5 | **Sticky "Add to cart"** | ❌ missing |
| 6 | **Delivery estimate + free-exchange promise, directly under the button** | ❌ missing |
| 7 | **Description** — what it is, colourway, season | ❌ missing (now generated, §13.7) |
| 8 | **Fit and sizing guide** — the biggest objection in apparel | ❌ missing |
| 9 | **FAQ** — sourcing, lead time, returns, personalisation | ❌ missing |
| 10 | **Verified reviews**, filterable by "true to size" | ⚠️ site-wide only, not per product |
| 11 | **"Can't find your size or colourway?"** → request block, pre-filled | ⚠️ generic version exists |
| 12 | Related: same team, same player, complete the kit | ❌ missing |

Blocks 3–9 are the entire gap between the current store and the reference, and none of them needs
photography — which is what makes the one-image decision affordable. **The copy, the fit
information and the personalisation preview do the work the missing five photos would have done.**

Two rules to hold onto:

1. **The buy box is at the top; everything below it exists to send the reader back up.** A sticky
   add-to-cart makes that trip free.
2. **Never show "sold out" on a sourcing model.** Show a lead time. The request block is the
   fallback, and it captures the customer instead of losing them.

---

## 13. Catalog data readiness

The 2026-08-18 archive was profiled and a migration path built (`tools/`). The catalog is
in better shape than the CSV exports suggest, and worse shape than a launch needs.

### 13.1 What is actually there

`products_full.jsonl` in the full backup is the authoritative source — richer than the CSV
exports, which carry no SKUs, no descriptions and inconsistent option names. The four
`products_export_*.csv` files are disjoint slices of the same catalog.

| | |
|---|---|
| Products | **4,205** — 3,593 active, 609 draft, 2 archived, 1 unlisted |
| Variants | **27,703** |
| Distinct images | **4,635** referenced, from 6,323 archived blobs — **3.09 GB** |
| Collections | 21, with 11,190 memberships |
| Price | $64.99 on 25,268 of 27,703 variants |
| Integrity | verified against the archive's own `checksums.sha256`, zero missing files |

After filtering drafts and two zero-priced products, the import emits **3,591 products
and 23,997 variants** — then **3,155 products and 21,188 variants** once duplicate listings
are merged (§13.10).

### 13.2 Where the images belong — not in Postgres

Bytes go in object storage; the database holds metadata only. Keys are content-addressed
as `originals/<sha256>.<ext>`, which makes the upload idempotent and collapses the 6,323
archived blobs onto the 4,635 images actually in use. The reasons are operational:

- **Backups and restore.** 3 GB of images would ride along in every base backup and
  point-in-time restore. The database should restore in minutes.
- **Buffer cache.** Large TOAST values evict hot index pages, so checkout gets slower
  because someone opened a product page.
- **Connection pressure.** Image traffic runs 10–50× page traffic; each request would
  hold a DB connection and compete with the cart.
- **No CDN semantics.** ETag, `Cache-Control` and range requests would all be hand-rolled.
- **Derivatives.** AVIF/WebP at ~5 breakpoints turns 4,635 originals into tens of
  thousands of files, which should be generated on demand at the edge and stored nowhere.
- **Cost.** R2 is ~$0.015/GB-month with zero egress — about **$0.05/month** for this
  archive — against managed Postgres at ~$0.20–0.35/GB before backup multiples.

Originals stay private; only derivatives are served.

### 13.3 The taxonomy has to be reconstructed

There is no usable structured data to navigate by: **4,014 of 4,205 products carry the
single tag `jersey`**, `productType` has four values, and the `custom.team`/`player`/`sport`
metafields are set on 60 products. Titles, however, are structured, so team, player,
colourway, season and edition are recovered by parsing:

| Field | Resolved |
|---|---|
| League | 95% |
| Team | 94% |
| Player | 91% |
| Colourway | 89% |
| Season | 15% |
| Edition | 8% |

The remaining **262 products (7%) are flagged `needs_review`** rather than guessed. These
derived columns are what faceted search and navigation are built on, and they are the
§6 data-model work made concrete.

### 13.4 Cleanups the import performs

| Problem in source | Handling |
|---|---|
| 143 distinct size values (`Xl`, `XXL`, `Youth XL`, `Mens S`, `Default Title`, `Adult2xl`) | Normalised to a canonical set; **fit split into its own dimension**, because `Mens S` and `Womens S` are two real variants, not a duplicate |
| 819 duplicate SKUs; 26,272 variants with none | Source SKUs used only where unique; otherwise deterministic `AJ-<hash>-<size>` |
| 2 products priced $0.00 | Rejected, not imported |
| 124 `untitled-*` handles | Slugs regenerated from parsed fields — free to do, since a greenfield store has no redirect obligation |
| Zero alt text | Carried through as empty; needs generating for §7.9 accessibility |

### 13.5 Regulatory fields exist and are empty

Field *names* are not regulated, so the schema is designed for this store rather than
inherited from Shopify's export shape. Certain *information* is regulated, so it lives in
first-class columns: `manufacturer_name`, `manufacturer_address`, `eu_responsible_person`,
`fibre_composition`, `country_of_origin`, `hs_code`, `care_instructions`,
`safety_information`.

**All 3,591 imported products have every one of them empty.** That is a hard gate on EU
orders (§7.8), not a cosmetic gap, so the schema carries a partial index
(`products_eu_ready_idx`) letting the application enforce it rather than trusting a
spreadsheet.

### 13.6 One image per product — decided, and what it costs

**Decision: ship with the single image the catalog already has.** No law requires a minimum
number of product images. What EU consumer law requires (Consumer Rights Directive Art. 6)
is that the *main characteristics of the goods* are disclosed before purchase "to an extent
appropriate to the medium" — text satisfies that. GPSR requires product and safety
information, also text. Accessibility requires alt text on whatever images do exist, which
is now generated for all 4,853 (§13.7). So one image is lawful, and this is a commercial
call rather than a compliance one.

What it costs, so the decision is made with open eyes:

- **Returns.** Apparel returns are driven by fit and appearance mismatch. A buyer who
  cannot see the back, the crest or the print detail is likelier to be surprised on
  arrival. At a $64.99 price point with $4.99 shipping, each return is roughly a
  **full order of margin** plus the outbound label. This is the real cost, and it does not
  show up until after launch.
- **Conversion.** The reference storefront runs a six-image gallery for a reason (§12.2).
- **Personalisation.** The print add-on is the entire business case (§9.6), and it is the
  thing a buyer most wants to see before paying extra for it. A single front-of-shirt shot
  cannot show a name and number on the back.

**Two mitigations worth taking, both cheap:**

1. **A live personalisation preview** rendered from the parameters, not photographed. It
   substitutes for the missing back shot exactly where it matters most, and it is already
   in Phase 2.
2. **A detailed fit and sizing block** plus a generous free-exchange policy, doing the work
   the missing photography would have done. §12.4 already recommends size confidence as
   the jersey-category equivalent of a money-back guarantee.

**Photograph the top sellers only.** Once there is order data, a second and third shot for
the best-selling few hundred products is a targeted spend against known revenue rather than
a 3,591-product programme. Revisit this then.

### 13.7 Descriptions and alt text — generated

The remaining content gaps are closed (`tools/describe.py`):

| | Before | After |
|---|---|---|
| Products with a description | 89 | **3,591** |
| SEO title / meta description | 1 | **3,591** |
| Image alt text | **0** | **4,853** |

The 89 pre-existing descriptions were kept and used as the voice model, but not copied:
they are one template with the names swapped, and near-identical text across thousands of
URLs is thin content that competes with itself. The generator composes from several
sentence patterns selected deterministically per product, giving **98.7% distinct strings**
across 3,502 descriptions — stable across re-runs, so the copy does not churn.

Two things it deliberately fixes rather than inherits:

- **Sizes are stated from the variant data.** The original template claimed "men's, youth,
  and women's sizes from S-XXL" on every product, while the catalog is overwhelmingly
  unisex S–4XL. Advertising sizes you do not stock is a misleading claim (§7.10), not a
  copy nit.
- **No unverifiable assertions.** Nothing claims "officially licensed", "authentic", a
  fabric composition, or a stitching method, because none of that is in the data.
  Inventing it is an FTC §5 exposure and a textile-labelling problem. Fabric and care
  belong in the regulatory columns (§13.5) once known.

Alt text names the player, team, colourway and garment. Second and later images are
numbered rather than described as "back", because an alt text that guesses the view is
worse than one that does not.

### 13.8 What remains open, ranked by what it actually costs

| Gap | Count | Consequence |
|---|---|---|
| **Licensing status unrecorded** | whole catalog | Not in the data anywhere. See §13.9 — this outranks everything else here |
| **Youth sizes without CPSIA documentation** | 199 products, 849 variants | US children's-apparel rules apply **at launch**, not at EU expansion (§13.9) |
| **Regulatory block empty** | 3,591 of 3,591 | Hard gate on EU sales (§7.8). Partly relevant to the US too — see §13.9 |
| **Products flagged `needs_review`** | 262 | Housekeeping, not a blocker — see below |
| **Second product image** | **2,174** products (69%, was 2,607 of 3,591) | Accepted (§13.6). Revisit for top sellers once there is order data |

**On the 262 flagged products — smaller than it looks.** 221 have an unresolved team and 42
defaulted their garment. But collection membership comes from the archive independently of
title parsing, so **all 221 are still in collections; only 13 products in the whole catalog
sit in none.** Navigation is not broken. What the gap actually costs is narrower: those
products are missing from *faceted* filters (filter by team or league and they do not
appear), their slugs and SEO titles are weaker, and their generated copy uses the
no-team sentence patterns. 176 products also have no league.

The fix is a vocabulary gap, not a data problem: add the missing club and programme names
to `tools/vocab.py` and re-run. That is an afternoon, and it is worth doing before launch
because league and team facets are the primary way anyone navigates a 3,591-product jersey
catalog.

### 13.9 Two things the empty columns are actually telling you

An empty column looks like a data-entry chore. In this case it is a signal that the
underlying facts are unknown, and two of them carry real consequences.

**1. Nobody knows what the garments are made of, or who made them.** That is a supplier
question, not 3,591 lookups — the catalog is one vendor and probably one or two fabric
specs, so it is a single conversation. Worth having early, because:

- **It is not purely an EU problem.** US law requires fibre content, country of origin and
  manufacturer identity (or RN number) on the **garment label** under the Textile Fiber
  Products Identification Act, and FTC textile rules extend fibre-content disclosure into
  mail-order and online advertising. Confirm the exact online obligation with counsel, but
  do not assume a US-only launch removes it.
- **199 products carry youth sizes** (849 variants). Children's apparel in the US brings in
  CPSIA: permanent tracking labels, flammability under 16 CFR 1610, and the drawstring rule
  for children's upper outerwear under 16 CFR 1120, which the CPSC treats as a substantial
  product hazard. This applies **at launch**, and it is the most under-appreciated exposure
  in the dataset. If the supplier cannot document it, the cheapest answer is to not sell
  youth sizes on day one.
- **It gates the EU entirely** (§7.8), and the stated plan is to sell into other regions.
- Support cannot answer "what is it made of?" until someone can.

**2. The catalog's licensing status is not recorded anywhere.** The products are
2,186 NFL, 501 soccer, 470 MLB, 168 NCAA, 44 NBA and 9 NHL items carrying team names,
player names and crests. Those are trademarked marks, and nothing in the archive — no
metafield, no vendor note, no supplier record — says whether the product is licensed.

This is worth resolving before any engineering spend, because it is the only risk in this
document that can end the business rather than cost it money:

- **Payment processing.** Stripe's and PayPal's terms prohibit counterfeit and
  IP-infringing goods. A processor termination mid-season ends the store regardless of how
  good the stack is, and it takes the payout balance with it for a while. That makes this a
  §5 risk, not just a legal one.
- **Takedowns.** Leagues and their enforcement agents pursue domains, listings, ads
  accounts and registrars, not just sellers.
- **Lanham Act exposure**, including statutory damages for counterfeit marks.
- **It changes the build-versus-buy answer.** Shopify absorbs some of this risk as the
  merchant of record's platform; owning the stack means owning the processor relationship
  and the domain directly, with nobody between you and an enforcement notice.

None of this is a conclusion about the products — the data simply does not say. But it is
the first question to answer, because a confirmed licensing position makes everything in
this document actionable, and an unconfirmed one makes the rest of it premature.

One piece of genuinely good news: **zero compare-at prices are set anywhere in the
catalog.** There is no reference price to inherit, so the 30-day-lowest-price discipline
in §7.10 can be built correctly from the first day rather than retrofitted onto a history
of invented "was" prices.


### 13.10 Duplicate listings, merged

**21% of the catalog was the same product listed several times.** 328 exact duplicate
titles across 764 products — "Las Vegas Raiders Black Shorts" existed 6 times, "Los
Angeles Dodgers Blue Shorts" 14. Same price in 314 of the 328 groups, but 313 had
*different* photographs.

Merged rather than deleted, because the photographs were the point:

| | Before | After |
|---|---|---|
| Products | 3,591 | **3,155** |
| Variants | 23,997 | 21,188 |
| Duplicate titles | 328 | **0** |
| Products with one image | 2,607 (73%) | **2,174 (69%)** |
| Products with 3+ images | 130 | **247** |
| Most images on one product | 6 | 26 |

One survivor per title keeps its taxonomy and copy; the other listings' images and sizes
fold into it, deduplicated by `sha256`. `tools/out/merge_log.csv` records all 436 merges
for provenance, and re-running `tools/extract.py --write` regenerates the un-merged CSVs,
so the merge is reversible.

**Be honest about the size of the image win.** It is real but modest: 649 images were
redistributed, products with three or more images went from 130 to 247, and the
single-image share fell only from 73% to 69%. Merging was worth doing on its own merits —
duplicates split reviews, compete on facets, and inflated the catalog by a fifth — but it
does not solve the photography gap. Roughly seven products in ten still have one image.

Two things this surfaced:

- **A third of some teams' listings were duplicates.** Dallas Cowboys went from 144
  products to 98, and the NFL facet from 2,237 to 2,018. Any pre-merge count elsewhere in
  this document is inflated by roughly that ratio.
- **Deleting a Medusa product does not cascade to a linked custom module.** 436
  `jersey_detail` rows were left orphaned, which silently inflated every facet count until
  they were pruned. Worth knowing before the next bulk delete.

---

## 14. Shipping economics and the rate model

$4.99 was carried through this document as the shipping charge. Checked against real
carrier rates, it is roughly break-even domestically and nowhere near viable
internationally — and since the plan is to sell beyond the US, the rate model has to be
designed rather than assumed.

### 14.1 What a jersey actually costs to ship

A jersey in a poly mailer is roughly 7–16 oz. Commercial rates, verified August 2026:

| Lane | Carrier | Real cost | Charged | Position |
|---|---|---|---|---|
| **US domestic** | USPS Ground Advantage, 1 lb | **~$7.61** | $4.99 | **−$2.62** |
| US domestic | USPS Ground Advantage, ~8 oz | ~$5.00–5.50 | $4.99 | ~break-even |
| US domestic | UPS/FedEx Ground, 1 lb | ~$7.67 + **$6.45–6.95 residential surcharge** | $4.99 | heavily negative |
| **US → UK / EU** | USPS First-Class Package International, 1 lb | **$25–37** | — | must be priced |
| US → UK / EU | DHL / FedEx / UPS express | $70–155 | — | not a DTC option |
| US → AU | as above | $25–37 | — | must be priced |

Three consequences:

1. **$4.99 works only at low weight and only on USPS.** Ground Advantage has no
   residential surcharge; UPS and FedEx do, at $6.45–6.95, which alone exceeds the
   shipping charge. **Weigh a packed jersey before committing** — at 8 oz the current price
   is fine, at 1 lb it costs roughly 4% of revenue.
2. **USPS raised Ground Advantage 7.8% in January 2026 and layered ~8% more in April.**
   A flat charge set once will erode; it needs an annual review with a named owner.
3. **International cannot be flat-rated at anything near $4.99.** At $25–37 the parcel is
   **38–57% of the product price.** This is the single hardest number in the international
   plan.

### 14.2 What an EU order actually costs the customer

Combining the parcel cost with §7.2's rules — the €150 duty exemption ended 1 July 2026,
a €3 duty applies per HS code per parcel, and import VAT applies to every commercial
parcel regardless of value:

| | |
|---|---|
| Jersey | $64.99 |
| Shipping (at cost) | $24.99 |
| Import VAT (~21% average EU rate, on goods + shipping) | ~$18.87 |
| Customs duty (€3 flat) | ~$3.25 |
| **Customer pays** | **~$112.10** |
| Stripe fee (5.4% + $0.30 on a EUR card) | ~$6.35 |

**A $64.99 jersey lands at ~$112 in the EU — a 72% uplift.** That is not a pricing
mistake to be tuned away; it is what cross-border DTC on a low-value parcel costs after
July 2026. Any international plan has to start from this number.

### 14.3 Proposed rate model

Zone-based, priced at or near cost, with duties and VAT collected at checkout rather than
sprung on the customer at the door. **DDP, not DAP** — a surprise bill on delivery
produces refusals, returns and chargebacks, and the refused parcel still costs you the
outbound leg.

| Zone | Countries | Rate | Free over | Rationale |
|---|---|---|---|---|
| **1** | US | **$4.99** | **$75** | Near cost at low weight. The free-shipping threshold is the discount mechanic §9.1 prefers over percentage codes |
| **2** | Canada | **$19.99** | $150 | Short lane, still 4× domestic |
| **3** | UK, EU | **$24.99** | $175 | At the low end of $25–37; VAT and the €3 duty are separate checkout lines via IOSS (§7.2) |
| **4** | Australia, NZ, Japan, Korea | **$29.99** | $200 | Longer lane, no duty-collection scheme as favourable as IOSS |
| **5** | Rest of world | **$34.99** or quote | — | Enable deliberately, country by country |

Two design points worth stating explicitly:

- **Free-shipping thresholds rise with the zone cost.** A $75 threshold makes sense when
  shipping costs $5; at $25 it would give away a third of the order value. The threshold
  is a lever to amortise the parcel across more items, which is exactly what makes
  international orders work.
- **Multi-item orders are where international becomes viable.** The parcel cost is
  largely fixed, so a two-jersey EU order carries ~$12.50 of shipping per item instead of
  $25. This is the strongest argument for the multi-buy mechanic in §12.4 — internationally
  it is not an AOV nicety, it is the difference between a viable order and a marginal one.

### 14.4 The structural fix, when volume justifies it

Everything above is the cost of shipping single parcels across a border. An **EU
fulfilment hub** removes most of it: EU orders become domestic EU parcels at roughly €5,
the €3-per-parcel customs duty disappears, delivery drops from 2 weeks to 2 days, and
returns become tractable. It also changes the tax position — an EU-established stock
location may bring OSS into play instead of IOSS, and the GPSR responsible-person
requirement is satisfied differently.

Do not do this early: it means EU VAT registration, a 3PL contract and inventory
committed abroad. But it is the answer at volume, and the international rate card above
should be understood as the interim position rather than the destination.

### 14.5 What to decide

1. **Weigh a packed jersey.** Everything in §14.1 turns on 8 oz versus 1 lb.
2. **Confirm the carrier.** USPS Ground Advantage domestically, on the residential
   surcharge alone.
3. **Approve or amend the zone rates** in §14.3.
4. **Decide the international launch set.** "Everywhere" is a worse answer than three
   markets priced properly.
5. **Set the free-shipping thresholds**, or reject the mechanic and price shipping into
   the product instead — a defensible alternative, but it has to be chosen.

---

## 15. Admin parity with Shopify

§2 listed what Shopify's platform fee buys. This is the narrower question: how much of
Shopify's **admin** does Medusa's give you? Verified against the running instance — every
endpoint below was probed, not assumed.

### 15.1 Present and working

| Area | Medusa admin |
|---|---|
| Orders | list, detail, cancel, archive, complete, **order changes**, **credit lines**, line-item edits, fulfilments, payment sessions, transfer, CSV export |
| Draft orders | first-class (phone and manual orders) |
| Returns · exchanges · claims | **three separate resources**, each with its own workflow |
| Products | list, detail, variants, options, images, **batch ops, CSV import and export** |
| Merchandising | categories, collections, tags, types |
| Inventory | inventory items, **multi-location stock**, **reservations** |
| Customers | customers, customer groups |
| Discounting | **promotions**, **campaigns**, **price lists**, price preferences |
| Payments | payments, refunds, refund reasons, return reasons |
| Regions & tax | regions, currencies, tax regions, tax rates, tax providers |
| Fulfilment | shipping profiles, shipping options, option types, fulfilment providers, fulfilment sets |
| Channels | sales channels, publishable and secret API keys |
| Staff | users, invites, **RBAC roles** |
| Store | store settings, policies, **translations and locales** |
| Observability | **workflow execution log** — see and retry failed workflows |

### 15.2 Where Medusa's admin is actually better

- **Returns, exchanges and claims are three first-class objects** with their own
  workflows. Shopify's native returns are thinner and most merchants add an app.
- **Order editing is more granular** — order changes and credit lines let you restructure
  a paid order and account for the difference properly.
- **Multi-location inventory with explicit reservations**, which is what §6.2 trap 4 is
  about. Reservations are visible and auditable rather than implied.
- **A workflow execution log.** When a fulfilment or payment workflow fails you can see
  the step, the input and the error, and retry it. Shopify gives you nothing equivalent.
- **RBAC roles** without an enterprise plan.

### 15.3 Where it is behind — and one gap dominates

| Missing | Consequence |
|---|---|
| **Analytics and reports** | **The big one.** There is no merchant-facing reporting at all. The `@medusajs/analytics` modules are event pipes to PostHog, not dashboards — no sales by product or channel, no cohorts, no conversion funnel, no period comparison. Shopify's reports have no equivalent here |
| **Abandoned checkouts** | No list, no recovery. §2 listed this; it is still unbuilt and Shopify does it natively |
| **Gift cards** | Not a first-class admin resource in 2.18 (only `gift_card_total` on orders) |
| **Media library** | No browser for uploaded files. The file module stores; nothing lists |
| **Metafields UI** | Medusa's answer is a custom module — more powerful, but every new field needs a developer. A Shopify merchant defines one in the UI |
| **Bulk editor** | Batch API and CSV import exist; there is no spreadsheet-style multi-product edit screen |
| **Pages and blog** | No content CMS. Adjacent to the builder you excluded, but Shopify's pages and blog are content, not theme |
| **App ecosystem** | Nothing comparable. Every gap is a code change |
| **Email template editor** | Templates live in code (`src/modules/resend/templates`). A merchant cannot change wording without a deploy |
| **Fraud and payouts views** | Stripe's dashboard instead — a second place to look |
| **Search configuration** | No synonyms or facet ordering. That belongs to Typesense (§4) |
| **POS** | None |

### 15.4 What this means for this store

**The operational admin is genuinely sufficient.** A colleague can take an order, fulfil
it, refund it, run a return, adjust stock and create a promotion — all of it, today, with
no code. That was the thing most likely to be missing and it is not.

**The reporting gap is real and needs an answer before launch.** Three options:

1. **PostHog or GA4 plus the events we already emit** (§4). Covers funnel, conversion and
   product performance. Not revenue reporting.
2. **Query Postgres directly** — a Metabase or Grafana instance over the order tables.
   Cheap, and the data model is ours, so the queries are straightforward. This is the
   pragmatic answer.
3. **Build report pages into the admin.** Medusa's admin is extensible — the jersey
   requests queue (§12.1) is a custom admin page, and reports would follow the same
   pattern. More work, better placed.

Recommended: **option 2 for launch, option 3 for the two or three numbers you look at
daily.** Do not try to rebuild Shopify's report suite; most of it goes unread.

**The pattern to internalise:** Shopify fills gaps with an app store, Medusa fills them
with a build target. Every item in §15.3 is buildable, and each one is a decision to spend
engineering time that Shopify would have charged a monthly fee for. That trade is the whole
of this document in miniature.

---

## 16. What is actually built

Written after the fact, so this section is a record rather than a plan. Everything below runs against
a real Postgres and is covered by the suite in `test.sh` — 76 python, 145 backend unit, 82 backend
integration, 39 storefront, plus a static accessibility audit.

### 16.1 Media in the database

The instruction was to store images as bytes in Postgres, "or as little as possible". §13.2 of this
document advised against it; the decision stood, so the work went into making the footprint small
rather than into arguing.

Measured with sharp on the real archive: **WebP q78 at 1400px is 17% of source** — 4,635 assets,
2.88 GB down to **515 MB**, zero failures. AVIF q55 measured 15% and was not chosen: the extra 2
points cost roughly 6× the encode time and AVIF's decode cost on mid-range Android is worse than the
bandwidth it saves.

| Decision | Why |
|---|---|
| Content-addressed (`sha256`) URLs | The bytes at a URL can never change, so the response is `immutable` with a one-year `max-age`. A warm browser or CDN never asks twice, which is what keeps image traffic off the database. |
| One stored size, `?w=` rendered on demand | Nothing is stored per breakpoint. Derivatives sit in a bounded 400-entry LRU, so a cold miss happens once per width per process. |
| `?w=` restricted to an allow-list | An open resize parameter is CPU amplification: `?w=1` … `?w=9999` is 9,999 encodes from one URL. |
| `bytea` via raw knex, not `model.define` | Medusa's model DSL has no bytea type. |
| `MEDIA_BACKEND=r2` escape hatch | The number that should trigger the move is **restore time**, not table size. 515 MB of image bytes in every `pg_dump` is the real cost. |

**The bug worth recording.** The route first lived at `/store/media/:sha`. Everything under `/store`
requires an `x-publishable-api-key` header, and an `<img src>` cannot send a header — so every image
would have been blank while the test suite stayed green, because the test client sets that header
automatically. Images are public assets and now live on a root route. The regression test sends the
request with no headers at all, plus a second test that fires the same headerless request at a
genuinely gated route and requires a 400, so the first test cannot quietly become vacuous.

### 16.2 Tax

Provider at `backend/src/modules/tax-stripe`. The design point is that it **distinguishes the two
kinds of zero**:

- **no economic nexus in the destination state** → a correct, final zero, stamped `calculated: true`
  with the reason;
- **could not calculate** (switch off, key missing, API down) → zero, stamped `calculated: false`.

Without that distinction, "no tax owed" and "we forgot to switch tax on" are indistinguishable in the
database, and under-collection compounds silently. It is a queryable field, so a shipped order with
`calculated: false` is a reportable condition rather than a shrug.

It also does not call Stripe where there is no nexus — correct, and cheaper at 0.5% of volume. On an
API failure it fails **open on the sale, closed on the claim**: checkout completes, the line is
marked for recalculation.

### 16.3 Fulfilment

Provider at `backend/src/modules/fulfillment-shippo`, split along the line that matters: **rating
needs no account, labels do.**

Rating is our own rate card (§14.3), so it works today. Implementing it as a *calculated* provider
rather than flat prices is what makes the free-shipping threshold apply at all — a flat shipping
option cannot see the cart subtotal. It reads `item_total`, not `total`: a merchandise threshold that
counts the shipping already on the cart is self-referential, and one that counts tax makes free
shipping depend on the customer's state.

Label purchase without `SHIPPO_API_KEY` degrades to a recorded intent, keeping the exact request it
would have sent. There is deliberately **no retry**: Shippo's transaction endpoint is not idempotent,
so retrying a request whose response was lost buys two labels.

### 16.4 Observability

No `@sentry/node`. The SDK patches `http`, `async_hooks` and the module loader at import time, and
Medusa's worker/server split plus its own OTel hooks are exactly where that goes wrong — and
`SENTRY_DSN` is a placeholder anyway. So it is a `fetch` to the ingest endpoint, and with no DSN it
still does the useful half: grouped, counted, scrubbed logging.

Scrubbing is by **key name and value shape**, because either alone misses cases — a key called
`token` holding something harmless, and a key called `note` containing an `sk_live_…`. Customer email
and anything card-shaped are scrubbed too (§7.4, PCI 3.4).

`/health/ready` is separate from `/health` and the distinction is the point: liveness answers "is the
process alive", the right question for a restart policy; readiness answers "can this instance serve",
the right question for a load balancer. It reports each dependency separately and answers **503, not
500** — a state a load balancer waits out rather than reporting as a bug.

**Two self-inflicted outages, both now pinned by tests.** Registering the error handler as a route
middleware made Express call the four-argument function with three, so every endpoint returned 500.
Moving it to `config.errorHandler` *replaces* Medusa's handler, so `next(err)` fell through to
Express's default and turned a routine 400 into a 500 HTML page with a full stack trace — a
regression and a disclosure at once.

Also measured rather than assumed: user middleware runs *after* the publishable-key and auth gates,
so a request those gates reject carries no request id. That is documented and pinned, because "the
header is missing" otherwise reads as a broken middleware rather than a request turned away at the
door.

### 16.5 Compliance in the storefront

- **Consent is opt-in and nothing non-essential loads first.** There is no analytics script in the
  layout waiting to be told to stop; the loader is a component that reads consent before attaching
  anything.
- **Global Privacy Control wins outright and silently.** Twelve states require honouring it
  automatically, so when GPC is set no banner appears at all — asking again would invite a click that
  cannot lawfully override the signal.
- **Reject is as prominent as Accept**, which EU regulators have repeatedly said is the line between
  consent and a dark pattern.
- **CSP is part of the PCI surface, not a nicety.** With Elements on our own domain we are in SAQ
  A-EP, so 6.4.3 and 11.6.1 make the allow-list auditable. It is deliberately short and every entry
  carries its justification in a comment; `'unsafe-inline'` is the one concession, required by Next's
  hydration bootstrap, and it is why tamper detection matters rather than being optional.

### 16.6 Personalisation

Built per `personalisation-spec.md`, whose §9 carries the detail. The one architectural note that
belongs here: **the add-on is a real product, not a custom price.** Medusa refuses a client-supplied
`unit_price` outright, and working around that server-side would take the add-on outside the pricing
engine — losing its own tax code, promotion eligibility and line-level refundability. A personalised
item is therefore two cart lines, folded into one row for display and kept separate on the order.

### 16.7 What is still open

| Item | Blocked on |
|---|---|
| Production print-file generator | The supplier's required format — vector vs raster, spot colours, template. The on-screen preview is independent and is done. |
| Invoice PDF generation | Only required for EU B2C sales; a US-first launch does not need it. |
| Stripe Tax live verification | A Stripe account. The provider's decisions are tested; the one HTTP call to Stripe is not. |
| Licensing position | Printing a player's name to order raises the §13.9 question with more force than selling a stock shirt does. Unresolved, and it gates personalisation going live rather than being built. |
| Fibre composition, country of origin, CPSIA docs, size measurements | The supplier. Emitted as visible placeholders on customs forms rather than guessed — a wrong declaration is an offence, not a data-quality issue. |

---

## 17. Sources

All URLs retrieved August 2026.

**Stripe**
- [Online payments — integration options and Checkout Sessions vs Payment Intents](https://docs.stripe.com/payments/online-payments)
- [Stripe US pricing](https://stripe.com/pricing) · [Stripe fees explained 2026](https://checkoutpage.com/blog/stripe-processing-fees) · [Stripe international fees by country 2026](https://checkoutpage.com/blog/stripe-international-fees)
- [Stripe local payment methods pricing](https://stripe.com/pricing/local-payment-methods)
- [MobilePay on Stripe](https://docs.stripe.com/payments/mobilepay) · [MobilePay guide](https://stripe.com/resources/more/mobilepay-an-in-depth-guide) · [Accepting payments in Denmark](https://stripe.com/resources/more/payments-in-denmark-an-in-depth-guide)
- [Stripe webhooks](https://docs.stripe.com/webhooks) · [Stripe Tax](https://docs.stripe.com/tax)

**Shopify baseline**
- [Shopify pricing](https://www.shopify.com/pricing)
- [Shopify pricing and fees breakdown 2026 — Style Factory](https://www.stylefactoryproductions.com/blog/shopify-fees)
- [Shopify fees 2026 — Taxomate](https://taxomate.com/blog/shopify-fees)

**Payment alternatives**
- [European alternatives to Stripe: Mollie, Adyen, Klarna compared — StackPatrol](https://stackpatrol.eu/guides/european-alternatives-stripe)
- [Best Stripe alternatives by use case — PaymentProviders.io](https://paymentproviders.io/blog/best-stripe-alternatives)
- [EU cross-border payments: Stripe, Adyen, Mollie — Zunapro](https://www.zunapro.com/europa/en/blog/cross-border-payment-solutions-eu-ecommerce)

**PCI DSS**
- [SAQ A for hosted checkout pages — PCIDSS Dashboard](https://pcidss-dashboard.com/blog/saq-a-for-hosted-checkout-pages-what-you-need-to-know/)
- [Is Stripe PCI compliant? What merchants still need to do — c/side](https://cside.com/blog/can-you-use-stripe-for-pci-dss)
- [PCI DSS v4.0.1 requirements 6.4.3 and 11.6.1 — PCI SSC](https://www.pcisecuritystandards.org/document_library/)

**US sales tax**
- [Economic nexus: state-by-state handbook 2026 — Numeral](https://www.numeral.com/blog/economic-nexus)
- [Sales tax nexus by state 2026 — TaxCloud](https://taxcloud.com/blog/sales-tax-nexus-by-state/) · [Thresholds by state — Kintsugi](https://trykintsugi.com/blog/sales-tax-nexus-by-state-in-2026)
- [Avalara vs Stripe Tax — Numeral](https://www.numeral.com/blog/avalara-vs-stripe-tax) · [Sales tax compliance pricing 2026 — StackScored](https://www.stackscored.com/pricing/sales-tax-compliance/)

**EU and UK import VAT**
- [Import One Stop Shop — European Commission](https://vat-one-stop-shop.ec.europa.eu/)
- [IOSS for non-EU sellers: VAT, intermediary and the €150 rule — Hellotax](https://hellotax.com/blog/ioss-for-non-eu-sellers/)
- [EU €150 customs duty exemption ended July 2026 — Avalara](https://www.avalara.com/blog/en/europe/2025/11/eu-end-150-customs-duty-exemption-2026.html)
- [EU IOSS changes 2026: the new €3 customs duty — Fulfillable](https://fulfillable.co.uk/blog/eu-ioss-changes-in-2026-what-the-new-e3-customs-duty-means-for-e-commerce-sellers/)
- [VAT and overseas goods sold directly to customers in the UK — GOV.UK](https://www.gov.uk/guidance/vat-and-overseas-goods-sold-directly-to-customers-in-the-uk) · [The £135 threshold explained — Landmark Global](https://landmarkglobal.com/eu/en/news-insights/uk-vat-on-low-value-goods-the-135-threshold-rule/)

**Privacy**
- [GDPR — EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj) · [Article 27 guide for non-EU businesses](https://eushield.eu/gdpr-article-27-guide/) · [GDPR Local on Article 27](https://gdprlocal.com/gdpr-art-27-requirements-explained/)
- [International transfers in 2026: DPF, SCCs and TIAs — PrivacyForge](https://privacyforge.io/resources/blog/gdpr-international-data-transfers-2026) · [Is the DPF still valid? — EuropeanMartech](https://europeanmartech.eu/blog/eu-us-data-privacy-framework-2026-status)
- [20 state privacy laws in effect in 2026 — MultiState](https://www.multistate.us/insider/2026/2/4/all-of-the-comprehensive-privacy-laws-that-take-effect-in-2026)
- [Universal opt-out and Global Privacy Control: state requirements — Tannenbaum Helpern](https://www.thsh.com/publications/universal-opt-out-mechanisms-and-global-privacy-control-state-law-requirements-and-compliance-guidance/) · [GPC actions for ecommerce 2026](https://www.pii.ai/blog/universal-opt-out-gpc-ecommerce-2026)

**Product safety (GPSR)**
- [EU Responsible Person under GPSR — EUVerify](https://euverify.com/resource/eu-responsible-person-under-gpsr/)
- [GPSR Responsible Person: what sellers must know in 2026](https://responsible.eldris.ai/data-centre/eu-responsible-person-compliance/gpsr-responsible-person-sellers-2026)

**US consumer protection**
- [FTC final rule banning fake reviews and testimonials](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials) · [Rule Q&A — FTC](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers)
- [Final rule analysis — Morgan Lewis](https://www.morganlewis.com/pubs/2024/08/ftc-issues-final-rule-on-consumer-reviews-and-testimonials) · [First enforcement step, Dec 2025 — Crowell](https://www.crowell.com/en/insights/client-alerts/keeping-it-real-ftc-targets-fake-reviews-in-first-consumer-review-rule)

**Accessibility (EAA)**
- [EAA ecommerce services requirements — Accessible.org](https://accessible.org/eaa-ecommerce-services-requirements/)
- [Navigating the EAA for online retailers — Bird & Bird](https://www.twobirds.com/en/insights/2025/a-guide-to-navigating-the-european-accessibility-act-for-online-retailers-service-providers-and-plat)
- [EAA compliance guide 2026 — AccessibilityChecker](https://www.accessibilitychecker.org/guides/eaa-compliance/)
- [EN 301 549 — ETSI](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/)

**Commerce backends**
- [Medusa v2 documentation](https://docs.medusajs.com/learn)
- [Best headless commerce platforms 2026 — Vendure](https://vendure.io/blog/best-headless-commerce-platforms)
- [Medusa vs Saleor vs Vendure — LinearLoop](https://www.linearloop.io/blog/medusa-js-vs-saleor-vs-vendure) · [PkgPulse comparison](https://www.pkgpulse.com/guides/medusa-vs-saleor-vs-vendure-headless-ecommerce-2026)

**Storefront reference**
- [glowfare.com](https://glowfare.com) and its product page — page source inspected 21 Aug 2026 for stack, tokens and offer structure
- [Unfair Commercial Practices Directive 2005/29/EC, Annex I](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex%3A32005L0029) — blacklisted practices, including false limited-time claims
- [Omnibus Directive (EU) 2019/2161](https://eur-lex.europa.eu/eli/dir/2019/2161/oj) — price-reduction reference pricing and consumer-review authenticity
- [Forbrugerombudsmanden — marketing rules for online sales](https://www.forbrugerombudsmanden.dk/)

**Shipping economics**
- [USPS vs UPS vs FedEx: which is cheaper in 2026 — Shippo](https://goshippo.com/blog/which-is-cheaper-usps-vs-ups-vs-fedex)
- [USPS Ground Advantage rates 2026: zones and weight breaks](https://idshipthat.app/shipping-rates/usps-ground-advantage/)
- [International shipping rates: UPS, FedEx, DHL, USPS 2026 — Shippo](https://goshippo.com/blog/ups-vs-fedex-vs-dhl-vs-usps-international-shipping-rates-comparison)
- [Average international ecommerce shipping cost by route 2026 — Eightx](https://eightx.co/blog/average-ecommerce-international-shipping-cost-by-route-2026)
- [DDP shipping costs and pricing 2026 — FreightAmigo](https://www.freightamigo.com/en/blog/logistics/ddp-shipping-explained-incoterms-2020-costs-and-pricing-tools/)
- [Prepaid import duties — USPS](https://www.usps.com/international/prepaid-import-duties.htm)

**Search, email, shipping, hosting**
- [Search pricing comparison: Algolia, Typesense, Meilisearch — BuildMVPFast](https://www.buildmvpfast.com/api-costs/search)
- [Top Algolia alternatives — Meilisearch](https://www.meilisearch.com/blog/algolia-alternatives)
- [Klaviyo pricing 2026 — Automation Atlas](https://automationatlas.io/answers/klaviyo-pricing-explained-2026/) · [Klaviyo alternatives — Omnisend](https://www.omnisend.com/blog/klaviyo-alternatives/)
- [Best transactional email services 2026 — Mailflow Authority](https://mailflowauthority.com/esp-reviews/best-transactional-email-service)
- [Shippo API docs](https://docs.goshippo.com/) · [EasyPost API docs](https://docs.easypost.com/) · [Shipmondo (Nordic, for a future EU hub)](https://shipmondo.dev/docs/sandbox/)
- [Vercel pricing 2026 — Temps](https://temps.sh/blog/vercel-pricing-complete-guide-2026) · [Vercel vs Railway vs Hetzner — DevToolPicks](https://devtoolpicks.com/blog/when-to-use-vercel-vs-railway-vs-hetzner-solo-saas-2026) · [Managed Postgres comparison 2026](https://selfhost.dev/blog/managed-postgresql-comparison-2026/)

---

## Caveats

- **Prices move.** Payment rates, SaaS tiers and hosting prices all changed within the last year.
  Re-verify anything you are budgeting against before you commit.
- **This is not legal or tax advice.** §7 identifies the obligations and where they come from. IOSS
  registration, US state nexus, invoicing format, GPSR responsibility and the accessibility
  conformance statement
  should each be confirmed with a US tax adviser, an EU/UK VAT specialist and, for §7.8 and §7.10,
  counsel. The three hard gates in particular are legal appointments, not engineering tasks.
- **The cost model is a model.** It uses one AOV and one payment-method mix. Substitute your actual
  numbers before treating the payback figures as decisions.
