# Personalisation — proposed spec

**Status: implemented, except the print-file generator.** Section 9 at the bottom records
exactly what is built and what each open decision still blocks. Prices remain **[confirm]** —
they are one exported table (`spike/backend/src/personalisation.ts`), so changing them is one
edit and no historical order reads them.

This is the store's business case: §9.6 of `research.md` puts the
own-build ~$4,725/month behind Shopify at 10,000 orders, and personalisation has to clear
**$0.47 of margin per order** to close that. Everything below is chosen to make that number
comfortable while staying buildable in the three weeks budgeted in Phase 2.

Numbers marked **[confirm]** are my proposals, not decisions.

---

## 1. What a customer can add

Three options, priced separately, combinable. A jersey with all three is a **$92.97** order instead
of $64.99 — the $19.99 bundle plus the $7.99 patch. (An earlier draft said $94.97, which did not
follow from the table below.)

| Option | Price **[confirm]** | What it is | Constraints |
|---|---|---|---|
| **Name** | **$14.99** | Surname across the upper back | 1–14 chars, `A–Z` + space + `.` `'` `-`, auto-uppercased |
| **Number** | **$9.99** | 1–2 digit number, back and optionally front | `0–99`, no leading zero except `0` itself |
| **Name + Number** | **$19.99** | Both, bundled | Saves $4.99 versus buying separately |
| **Patch** | **$7.99** | Sleeve or chest patch from a fixed set | Choose from a curated list per league; no free upload |

**Why these prices.** At a $64.99 base, $19.99 is a 31% uplift — high enough to matter, low enough
not to stall the decision. The bundle is the intended default: it is the option most likely to be
chosen, and it is why the tiers exist at all (§12.4 — make the decision *which*, not *whether*).

**Break-even check.** At 10,000 orders/month, a 20% attach rate on the $19.99 bundle at an assumed
55% margin **[confirm with supplier cost]** produces roughly **$22,000/month of gross margin** against
a $4,725/month bar. Even a 5% attach rate clears it. The business case is not fragile.

### The live store does it a different way, and both now exist

Observed on **cruxchristi.com** (the shop currently trading) on 2026-08-29, after this spec
was written:

| | This spec | The live store |
|---|---|---|
| Where printing is sold | An add-on on any eligible jersey | A **separate product line** — 66 blank shirts, one per team and colourway |
| Price | $64.99 shirt + $19.99 bundle = **$84.98** | **$89.99** flat, printing included |
| On a regular player jersey | Offered | **Not offered at all** — the control is absent |
| Name limit | 12 characters | **14** (`maxlength="14"`) |
| Validation | Blocklist + human review queue | Free text, no visible screening |

Three things follow.

**The price point is already validated.** $89.99 against a $64.99 base is a $25 uplift, which
brackets the $19.99 bundle this spec proposed. The willingness-to-pay assumption in §1 is not
a guess any more.

**"Included" is a better offer than "+$19.99" at the same money.** $89.99 with printing
included and $84.98 as a base plus an add-on are within five dollars of each other, but the
first is one decision and the second is two — and §12.4's whole argument is that the goal is
to make the decision *which*, not *whether*.

**Both models are now implemented**, selected by `jersey_detail.is_custom`. A custom shirt
prices every printing line at zero and creates no add-on line, but still writes the
`line_personalisation` rows — so the blocklist, the human review queue and the chargeback
evidence in §7 apply to it exactly as they do to a paid one. The live store appears to have
none of that, which is a liability difference rather than a feature difference: a free-text
name field with no screening is how a trademarked name or a slur reaches a printer.

The name limit here has been changed to **14** to match the store, because refusing a name a
customer has already ordered under is a worse failure than a slightly tighter print width.

## 2. What a customer cannot do

Deliberate exclusions, each for a reason:

- **No free-text beyond a name.** No slogans, no phrases. It invites abuse and it invites
  trademark problems.
- **No custom uploads.** No logos, no images, no arbitrary patches.
- **No numbers above 99**, no symbols, no emoji, no non-Latin characters in v1.
- **No font or colour choice.** One typeface per league, matched to the shirt. Choice here multiplies
  print-file cases without raising willingness to pay.

**A blocklist is required**, not optional: profanity, slurs, and a list of protected names. Every
order also passes a human review queue before it goes to print — see §6.

## 3. Which products qualify

Not all 3,591. Gate on data we actually have:

```
eligible = garment in ('jersey', 'longsleeve-jersey')
       AND status = 'active'
       AND needs_review = false          -- 262 products excluded until reviewed
       AND team IS NOT NULL              -- need the team to pick the typeface
```

That is roughly **3,100 products**. Shorts, hats, jackets and combo sets are excluded in v1.

## 4. Storefront behaviour

On the product page, directly under the size selector and above add-to-cart (§12.8 block 4):

1. **Off by default.** A single control: "Add your name and number — from $9.99".
2. Expanding reveals name field, number field, and a patch picker if the league has any.
3. **Live preview** — the shirt back rendered from the parameters, updating as they type. This is the
   block that substitutes for the missing back photograph, so it has to be good rather than
   indicative. Canvas or SVG, one background plate per colourway.
4. **Price updates in place**, showing base + add-ons + total. Never a surprise at checkout.
5. **Validation inline**, not on submit: character count, disallowed characters explained in words
   ("letters, spaces, apostrophes and hyphens only"), not a regex.
6. **A clear non-returnable notice** next to the control, before it is used — not buried in the
   policy. This is a legal requirement (§7.10 and below), and burying it invites disputes.

Accessibility (§7.9): the preview needs a text alternative describing what it shows, the fields need
real labels, and errors must be announced. WCAG 2.1 AA applies to this module like everything else.

## 5. Data model

Extends `tools/schema.sql`. Parameters are the record of truth; the rendered print file is a cache
that can always be regenerated — so a print-spec change never orphans an old order.

```sql
-- what a product offers (populated per eligible product)
personalisation_options            -- already in schema.sql: kind, price_cents, max_length, charset

-- what the customer chose, captured at add-to-cart and frozen at order
create table line_personalisations (
  id              uuid primary key default gen_random_uuid(),
  order_line_id   uuid not null references order_lines (id) on delete cascade,
  kind            text not null check (kind in ('name','number','patch')),
  value           text not null,          -- 'ALLEN' | '17' | 'captain'
  price_cents     integer not null,       -- snapshot, never a live lookup
  typeface        text not null,          -- resolved from league at time of order
  placement       text not null,          -- 'back' | 'front' | 'sleeve'
  render_sha256   char(64),               -- cached print file in object storage, nullable
  review_status   text not null default 'pending'
                  check (review_status in ('pending','approved','rejected')),
  reviewed_by     text,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index line_personalisations_queue_idx on line_personalisations (review_status)
  where review_status = 'pending';
```

**Price snapshot, not a join.** Same rule as order lines (§6.2, trap 2): if you look up the current
add-on price to display an old order, every historical order changes the next time you reprice.

## 6. Production flow

```
customer submits  →  automated screen (blocklist, charset, length)
                        │  fail → rejected inline, never reaches the order
                        ▼
                     order placed, review_status = 'pending'
                        │
                        ▼
                     human review queue  ──reject──▶  refund add-on, contact customer,
                        │                             ship the plain jersey
                     approve
                        ▼
                     print file generated  →  private object storage, signed URL
                        │
                        ▼
                     supplier fetches  →  prints  →  fulfils
```

**Print file output [confirm with supplier].** My assumption is 300 DPI PNG with transparency at the
physical print dimensions, plus a JSON sidecar carrying name, number, typeface, placement and
colourway. **This is the single input I cannot guess** — if the supplier wants vector (PDF/SVG with
outlined text), spot colours, or a specific template, that changes the renderer. Ask them before
Phase 2 starts.

**Storage and retention.** Print files are private, served to the supplier by signed URL only,
retained through production plus the returns window, then lifecycle-expired. Parameters are retained
with the order for as long as tax law requires. Never public, never CDN-cached.

## 7. Commercial and legal consequences

| Consequence | Handling |
|---|---|
| **Not returnable** | Personalised goods are excluded from the standard right of return in most regimes, but that only holds if you **disclose it before purchase** (§7.10). Notice sits next to the control and repeats at checkout |
| **Free size exchange does not apply** | §12.4 leans on size confidence to offset one image. Personalised items cannot be exchanged, so the fit guide matters more here — consider showing it inline when personalisation is enabled |
| **Trademark exposure** | Player names are the point of the product, and they are also the risk. Whatever conclusion §13.9 reaches on licensing applies with more force to printing a name to order. Resolve licensing before this ships |
| **Lead time** | Personalised orders take longer. State the difference honestly on the page, per §12.8 block 6 |
| **Chargeback posture** | A personalised, non-returnable, made-to-order item is a common dispute pattern. Keep the rendered preview the customer approved, attached to the order, as evidence |

## 8. Build sequence (Phase 2, 3 weeks)

| | Work |
|---|---|
| Week 1 | Data model, eligibility, pricing; cart and order integration with price snapshots; validation and blocklist |
| Week 2 | Live preview renderer, one background plate per colourway, per-league typefaces; PDP module and accessibility pass |
| Week 3 | Print-file generator, signed-URL delivery, admin review queue, refund path for rejections |

**Blocked on:** the supplier's print-file format (§6). Everything else can proceed without it — the
renderer for the on-screen preview is independent of the production output format.

---

## Decisions needed from you

1. **Prices** — $14.99 / $9.99 / $19.99 / $7.99, or your own numbers
2. **Supplier print-file format** — the one thing I cannot assume
3. **Supplier cost per personalisation** — needed to confirm the margin, currently assumed 55%
4. **Patch list** — which patches per league, or drop patches from v1
5. **Who staffs the review queue**, and the turnaround target

---

## 9. Implementation status

Built and tested against a real database. 45 unit tests on the pricing/validation core, plus the
admin queue and the storefront module.

| Spec section | Status | Where |
|---|---|---|
| §1 Prices and tiers | **Built.** One `PRICES` table in cents; the bundle is applied automatically when a name and a number are both present | `backend/src/personalisation.ts` |
| §2 Exclusions and blocklist | **Built.** Charset, length, no free upload, profanity + liability name lists | same |
| §3 Eligibility | **Built.** Garment, `needs_review`, team-known gate, returned with a reason | same |
| §4 Storefront behaviour | **Built.** Off by default, live SVG preview, inline validation in words, price in place, notice beside the control | `storefront/components/Personalise.tsx`, `JerseyBack.tsx` |
| §5 Data model | **Built.** `line_personalisation` with a partial index on the pending queue | `backend/src/modules/catalog/models/line-personalisation.ts` |
| §6 Review queue | **Built.** Oldest-first queue, reason-gated rejection, waiting-time column | `backend/src/admin/routes/personalisations/`, `api/admin/personalisations/` |
| §6 Print-file generator | **Blocked.** Needs the supplier's required format — the one input that cannot be assumed | — |
| §7 Disclosure | **Built.** Shipped with the offer payload, rendered beside the control and repeated on the cart line | `api/store/personalisation/route.ts` |

### How the price is actually charged

Worth recording, because the obvious approach does not work. Setting a custom `unit_price` on the
shirt's line item is refused outright by Medusa — the spike confirmed it rejects the field with
"Unrecognized fields", for the same reason §5.2 rule 1 gives. So the add-on is **an ordinary
product** with one variant per tier, priced in the price list like everything else:

- the price comes from the pricing engine, not the browser;
- Stripe Tax sees it as a line with its own tax code (services and goods are treated differently);
- a promotion can include or exclude it without special-casing;
- refunding a rejected personalisation is refunding a line, not adjusting one.

The cost is that a personalised item is two cart lines. They are folded into one row for display
(`storefront/lib/line-groups.ts`) and stay separate on the order.

The `attach` endpoint re-validates everything server-side and checks that the add-on tier actually in
the cart matches the request — a client that adds the $9.99 number variant and then asks for a name
*and* number is refused rather than printed.

### Things found while building it

- **The "from" price was wrong.** It quoted `min(PRICES)` — the $7.99 patch — while no patch list is
  configured, so the page advertised a price for an option nobody could select. It now takes only
  what is offered. Under the UCPD that distinction is not cosmetic (research.md §7.6).
- **A refused name was still priced.** Validation returned the normalised name alongside the error,
  so a blocked name came back with `ok: false` and `total: $14.99`. Validation now returns only the
  fields it accepted.
- **The blocklist over-blocked real surnames.** Matching slurs against the de-spaced form catches
  "N I G G A" — and also refuses *Scunthorpe*. Squashing is now applied only to strings that look
  deliberately broken up (two or more single-letter tokens), because refusing a paying customer's own
  name is worse than an evasion that the human queue catches anyway.
- **§1's arithmetic did not follow from its own table.** It said a fully personalised shirt is
  $94.97; $19.99 + $7.99 on a $64.99 shirt is **$92.97**. Corrected above and pinned by a test.

### Still needed from you

Unchanged from the list above, and now each with what it blocks:

1. **Prices** — one edit if they change; nothing is blocked meanwhile.
2. **Supplier print-file format** — blocks the production renderer only. The on-screen preview is
   independent and is done.
3. **Supplier cost per personalisation** — blocks confirming the 55% margin assumption, not the build.
4. **Patch list per league** — the patch tier is built but offers nothing until `PATCHES_<LEAGUE>` is
   set, and the "from" price correctly reflects that.
5. **Who staffs the review queue** — nothing prints until someone does. This is the operational
   dependency, not a technical one.
