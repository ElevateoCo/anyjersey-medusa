# Switched off, and how to switch it back

Things that **exist and are not running**, why, and what it takes to reverse each one.

Distinct from `DEFERRED.md` on purpose. That file is about work not built and what building
it would cost. This one is about work that *is* built and is currently disabled, dormant, or
deleted — a different question with a different failure mode. Something deferred is missing
and obvious; something switched off looks finished and behaves as though it is not, which is
how a compliance gate stays lifted for a year because nobody remembered it was a switch.

Ordered by what it costs to leave as it is.

---

## 1. The EU/UK sales gate is lifted

**State:** off. `NEXT_PUBLIC_LIFT_EU_GATE=true` in `storefront/.env.local`.

EU and UK regions are selectable even though the three appointments that gate them are
outstanding — a GPSR responsible person, a GDPR Article 27 representative, and an IOSS
registration. See README Step 47.

**What it is hiding.** Nothing about the underlying position changed when the flag went on.
Without a GPSR responsible person, apparel may not lawfully be placed on the EU market at
all. Without an Article 27 representative there is nobody in the Union to receive a
data-subject request. Without IOSS, import VAT lands on the customer at the door, which they
find out about from a courier rather than from us.

**Why it is not dangerous today.** It is compiled out of a production build — `NODE_ENV` is
read at build time, so the override cannot be turned on by an environment variable on a
host. Verified by building with the flag set and confirming the region picker still disables
Europe and the United Kingdom. And `/shipping` prints a development notice naming exactly
what is outstanding whenever the flag is on, so a storefront cannot quietly look compliant.

**To reverse:** delete the line from `.env.local`. To make it unnecessary, set
`NEXT_PUBLIC_GPSR_RESPONSIBLE_PERSON`, `NEXT_PUBLIC_EU_REPRESENTATIVE` and
`NEXT_PUBLIC_IOSS_NUMBER`. Those are appointments, not code.

**Do not** collapse `euBlocked()` and `euGatesOutstanding()`. The first is what the UI
enforces and the flag empties it; the second is what is genuinely unappointed, and nothing
empties that. The shipping page reads the second.

---

## 2. The homepage personaliser was deleted, and is not in git

**State:** removed. **Not recoverable from version control.**

A "Put your name on it" band sat on the homepage: a picker over all 173 teams, name and
number fields with the spec's shape rules, a live print proof in the team's real colours
with the ink contrast computed rather than chosen, and a `localStorage` draft that followed
the visitor to a product page and opened the real control already filled in. It worked end
to end across a real navigation.

It was removed because it sat directly under the Custom Jerseys band and the two read as the
same thing said twice. That judgement stands — this note is not an argument for putting it
back.

**What matters here is that it was built and deleted inside the same uncommitted window, so
it never reached a commit.** `git log --all --diff-filter=A -- '*Maker.tsx'` returns nothing.
There is no revert. Rebuilding it means rebuilding it.

Three files, about 350 lines with tests: `components/Maker.tsx`, `lib/maker-draft.ts`,
`lib/maker-draft.test.ts`. The parts worth knowing if it is ever rebuilt:

- It was a **teaser, not a second personaliser**. `components/Personalise.tsx` on the product
  page stays the real control — it prices the selection, applies the bundle, and validates
  against a server-side blocklist that is deliberately not in the browser bundle.
- The draft was **input, not a decision**: whatever was seeded from `localStorage` went
  through the same server check as anything typed directly.
- The shirt colours came from `lib/team-colors.ts`, which is still here, and the readable
  ink from `readableInk()`, which is still here and still tested. Those are the expensive
  parts and they survived.
- The seeding hook in `Personalise.tsx` was removed with it, because nothing wrote the draft
  any more and it would have read an always-empty store.

---

## 3. Free shipping is off, and the mechanic is dormant

**State:** every zone's `freeOver` is `0` in `backend/src/shipping-zones.ts`. Shipping is
charged on every order at the zone's rate.

The **mechanic is intact**, not deleted. `research.md` §9.1 argues for a free-shipping
threshold over percentage discount codes for this shop, so it is a lever worth being able to
pull: set a zone's `freeOver` to a number and the provider, the cart, the cart drawer, the
buybox and the checkout summary all start honouring it again, because every one of them
already guards on `> 0`.

**Two things will need attention if it comes back:**

- `/shipping` hides the "Free over" column while no zone has a threshold. It reappears on
  its own — the guard is `zones.some((z) => z.freeOver > 0)`.
- The provider's `freeOver > 0` branch is currently **unreachable through its public API**,
  so it has no test. One was removed rather than rewritten, because with every threshold at
  zero a test cannot distinguish the two outcomes and would pass whether the code worked or
  not. Restoring a threshold means restoring a test that can actually fail.

---

## 4. The custom line has no premium

**State:** all 28,998 catalogue prices are $65.99, the 777 custom jerseys included.

They were $89.99 against a $65.99 base — the highest-margin product in the shop and the one
a competitor cannot copy off a supplier list. They now cost the same as a blank shirt with
the printing still included.

Nothing in the customer-facing copy names a figure, so nothing reads as false. The margin
story is simply gone.

**To reverse:** `backend/src/scripts/set-catalog-price.ts` sets **one** figure across the
whole catalogue, so it cannot do this on its own. Restoring the premium needs a narrower
scope — the custom products are the ones with `jersey_detail.is_custom = true`.

---

## 5. The `.todo` notes are hidden

**State:** off. `NEXT_PUBLIC_SHOW_TODO` is unset.

Two blocks that were rendering to customers: one on the homepage, and one on **every product
page directly under the buybox**, telling a shopper something was blocked at the moment they
were deciding to buy.

What they record is still true — the size guide's chest and length measurements are
outstanding, and so is the supplier's print-file format (`personalisation-spec.md` §6).
Hiding them did not resolve either.

**To reverse:** `NEXT_PUBLIC_SHOW_TODO=true`. Useful when reviewing what is still missing;
it should never be set in production.

---

## 6. The campaign banner has no asset

**State:** no `NEXT_PUBLIC_HERO_VIDEO` or `NEXT_PUBLIC_HERO_IMAGE`, so the band renders
**nothing in production** and a sized placeholder in development. That is the intended
resting state, not an oversight — an unfinished campaign slot must not reach a customer.

**To reverse:** drop a file in `storefront/public/hero/` and point the variable at it. If a
video is served from anywhere other than `public/`, check `media-src` in
`storefront/next.config.ts` first: a blocked `<video>` produces no error a customer can see,
it simply never plays.
