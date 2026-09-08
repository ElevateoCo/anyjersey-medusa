# Deferred, with reasons

Things identified in the Shopify comparison that are **not** built, why, and what closing each
one actually requires. Kept as a file rather than a ticket because every entry has a reason
attached, and a reason is the part that gets lost first.

Ordered by what it costs to leave alone.

---

## 1. Express checkout — Apple Pay, Google Pay, Link

**Status:** unblocked, not wired.

The largest conversion item in the comparison, and the reason it is not built is not effort —
it is that a payment path cannot be verified here. There is no Stripe test key in this
environment, the integration suite completes carts through the system provider with no browser
involved, and Apple Pay additionally needs a domain that does not exist yet. Shipping an
unverifiable wallet flow onto the one page that takes money is the same call still standing
for buying shipping labels, and for the same reason: the failure is external, irreversible and
invisible from here.

**What *was* done:** the two silent blockers are removed.

- The CSP allowed `js.stripe.com` only. Stripe's integration security guide is explicit that
  `*.js.stripe.com` is what lets Stripe.js start frames on sibling origins — the mechanism the
  wallet buttons and Link use. A blocked frame produces no error a customer can see; the button
  simply never appears.
- `Permissions-Policy` had no `payment` directive, which disables the Payment Request API that
  both wallets go through. Also silent.

Both were fixed against Stripe's documented requirements, and Link's `link.com` hosts added
since the Payment Element offers Link by default.

**To finish it:**

1. Register the production domain at `dashboard.stripe.com/settings/payment_method_domains`
   (Apple Pay only; Google Pay needs nothing beyond HTTPS).
2. Enable the wallets in the dashboard's payment method settings — the Payment Element already
   renders dynamically from that.
3. Add `<ExpressCheckoutElement>` above the card fields in `components/StripePayment.tsx`,
   handling `onConfirm` and the shipping address the wallet supplies.
4. Verify with a Stripe test key, on a real domain, on a real iOS device. Step 4 is the one
   that cannot be skipped and is why steps 1–3 were not done blind.

---

## 2. Shipping-label execution

**Status:** labels manual. **Refunds now execute** — see README Step 38.

The returns queue used to record a decision and touch neither money nor carriers. Refunds were
the tractable half and have been built: the guarantee lives in `return_request.refunded_at`
rather than in an idempotency key, because Medusa's `refundPaymentWorkflow` does not expose one.

Labels stay manual, and on a fact rather than on effort. Shippo's transaction endpoint is not
idempotent by default and their idempotency contract could not be confirmed from their
documentation — a retry whose response was lost buys two labels, and guessing at the semantics
of a call that spends money is not a guess worth making.

**To finish it:** confirm Shippo's idempotency header with their support, then key the purchase
off the return request id. Or decide it stays manual and say so in the admin, which is also a
complete answer at this volume.

---

## 3. Multi-currency

All five regions are USD, so a shopper in Sydney sees dollars. Medusa supports price lists and
per-region currencies; the catalogue is a flat $65.99 everywhere, which is the reason nothing
needed it yet.

The work is real but ordinary: decide the currencies, decide whether prices convert or are set
per market, and price 4,300 products in each. The decision is the hard part.

---

## 4. Gift cards

Medusa 2.18 removed them from core — there is no module to enable, so this is a build: a code,
a balance, a redemption path at checkout, and the accounting treatment of an unredeemed balance
as a liability. Shopify gives it away. Worth costing properly before promising it.

---

## 5. Fraud screening

Nothing screens anything. Stripe Radar is free at the base tier and is a dashboard toggle, so
this is the cheapest item on the page — it is here only because it needs a live Stripe account
to enable. Replaceable apparel is a carded-fraud category and this shop ships internationally.

---

## 6. Product imagery

67% of products have exactly one photograph. A deliberate decision with a stated cost: fit and
appearance surprises drive apparel returns, and under a final-sale policy the customer bears
that. The plan is to photograph the top sellers once there is order data to pick them, which
means it stays open until there are orders.

---

## 7. Smaller storefront gaps

None of these blocks a first order.

| | |
|---|---|
| **Wishlist / save for later** | Common on Shopify via apps. No model, no UI. |
| **Recently viewed** | Cheap — a cookie and a rail. Small effect. |
| **Blog / content pages** | Four fixed pages, no CMS. Content marketing would mean a deploy per post. |
| **Multi-language** | Medusa has a translation module, unused. English only. |
| **Product image gallery** | No zoom, no video, one image for most products. Follows from item 6. |

---

## 8. Medusa modules that ship and are unwired

Worth separating from the genuine gaps above: these cost configuration rather than
construction, and all of them are reachable from the stock dashboard today.

Order editing · exchanges · claims · draft orders · customer groups · price lists ·
product categories · inventory and stock locations (deliberately off — the sourcing model
means nothing can be out of stock).

---

## 9. Customer segments and RFM

**Status:** the list and the export exist (README Step 40). What sits on top of them does not.

Shopify's customer screen carries an **RFM group** and saved **segments** — a query language
over customer attributes that drives which people a campaign goes to. This shop has the raw
material for both: spend, order count, first purchase, last order and marketing basis are all
computed per customer already, and RFM is arithmetic over three of them.

What is missing is the part that makes them worth having:

- **Segments need somewhere to go.** A saved segment is only useful if something sends to it,
  and marketing email is currently one automatic cart-recovery message. A segment builder with
  no campaign tool attached is a filter with extra steps — the screen's filters already cover
  what an operator can act on today.
- **RFM needs a baseline.** The quintile boundaries that make "Champion" mean anything are
  computed across a customer base with history. At the current order volume every bucket would
  be a rounding error, and a label that is noise is worse than no label.

**To finish it:** decide the marketing tool first. If it is Omnisend (already an unwired
integration, §8), segments belong there and this stays the source of truth it exports to. If it
is in-house, this is where the query builder goes.

---

## 10. What the rate limits still do not do

**Status:** the mechanism is right; two things it cannot reach are not code.

Step 39 made the budgets shared across instances and keyed them by the actual customer. What
it does not give you:

- **Account lockout.** The limit is per address per minute. Somebody with a botnet gets a
  fresh budget per node, and the right answer to that is a per-*account* failure counter with
  a backoff — which is a product decision (how long, whose email gets told) more than a
  patch.
- **Bot management.** Rate limiting is not scraping defence, and the comment on
  `/store/jerseys` says so plainly rather than implying otherwise. A budget that clears the
  storefront's own revalidation traffic does not constrain a determined scraper. That job
  belongs to whatever sits in front of the app — the same layer that owns `TRUST_PROXY`.

---

## 11. What Shopify absorbed and now has no owner

Not features, and the easiest thing to miss when comparing feature lists.

- **Uptime, backups, a tested restore.** No managed Postgres yet. `restore-drill.sh` now
  produces the restore-time number — with and without the image bytes — which is also what
  decides whether images move out of the database. Running it is a decision, not code.
- **A CDN.** The images are content-addressed and served immutable, so they are CDN-ready —
  there is simply no CDN, and every image request currently holds a database connection and
  competes with checkout.
- **Deliverability.** Resend is configured; the domain has no SPF, DKIM or DMARC and has never
  been warmed. The order confirmation is the message that can least afford the spam folder.
- **PCI scope.** Medusa's Stripe provider is PaymentIntents plus Elements, so the assessment is
  SAQ A-EP rather than Shopify's SAQ A — requirements 6.4.3 and 11.6.1 apply annually.

---

*Compiled 5 September 2026, from the comparison against cruxchristi.com and Shopify's
documented feature set.*
