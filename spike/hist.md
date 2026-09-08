# History — where things were left

A running note of the most recent piece of work, what state it is in, and what has to happen
next. Written for whoever picks this up cold, including me after a break.

`README.md` is the record of *what was built and why*. This file is the record of *what is
half-finished right now*.

---

## 2026-09-06 — order register (`/admin/order-list`)

**Status: written, typechecked, unit-tested. Never run against a database. Not built.**

### The blocker, first

The machine's disk filled up mid-task and everything downstream failed:

| What failed | How it failed |
|---|---|
| `medusa build` | `ENOSPC: no space left on device` |
| The Bash tool itself | could not write its own output file |
| `docker restart aj-pg` | `open /var/lib/docker/containers/…/hosts: input/output error` |
| `docker logs aj-pg` | same I/O error |
| Postgres, from the test runner | `could not open file "global/pg_filenode.map": I/O error` |

None of that is this project's doing. The Docker VM sits on a full volume, which is why the
containers (including the unrelated `supabase_*_casino` set) all went unhealthy at once.

**Right now:** `/System/Volumes/Data` is 409Gi of 460Gi used — **10Gi free, 98% full**.
There is enough room to write files again; there is not enough room to be comfortable.

Worth checking first: `~/Library/Containers/com.docker.docker` or `~/.colima` (VM disk images
are usually the single biggest item), and `spike/backend/.medusa`, which is build output and
regenerates.

### What was built

An order register, alongside the customer list from earlier the same day. **Not**
`/admin/orders` — Medusa owns that path, and a second handler on it means one of the two
loses the load-order race and the admin's own orders screen renders blank columns. Same call
as `/admin/customer-list`.

| File | What it is |
|---|---|
| `src/csv.ts` | **New.** CSV primitives, pulled out of `customers.ts` so both exports share one implementation. This is where the formula-injection guard lives, and extracting it is specifically so the second export cannot quietly omit it. Own test suite. |
| `src/orders.ts` | The register: money broken out, payment and fulfilment state, personalisation counts, line items, filter/sort/select, summary, both CSV shapes. |
| `src/api/admin/order-list/route.ts` | The list. Exports `selectionFrom` and `daysFrom`, which the export route imports so the two cannot disagree about what a filter means. |
| `src/api/admin/order-list/export/route.ts` | `?rows=orders` (one row per order) or `?rows=items` (one row per line). |
| `src/admin/routes/order-register/page.tsx` | The screen. Labelled "Order register", not "Orders" — Medusa's own orders screen is still there and is still where an order is worked. |
| `src/api/middlewares.ts` | List is `order:read` (Staff has it); export is `privacy:read` (owner only). |
| `src/customers.ts`, `src/__tests__/csv.unit.spec.ts` | Refactored onto `csv.ts`; CSV tests moved to their own spec. |

### Three decisions that need checking against a real database

**Payment and fulfilment status are derived, not requested.** `payment_status` and
`fulfillment_status` are computed properties on Medusa's order DTO, and a computed field that
does not resolve through `query.graph` comes back `undefined` rather than erroring — the trap
that once produced a cart page showing $0.00 above a $4.99 total. I could not verify which way
they resolve, because the database was already unreachable by then. So `paymentState()` and
`fulfilmentState()` in `src/orders.ts` derive from `payment_collections` and `fulfillments`,
which are ordinary relations. **This is the single thing most likely to be wrong**, and it is
what the integration test has to assert against a real completed order.

**Two export shapes, deliberately.** One row per order reconciles a month; one row per line
picks and packs. Neither substitutes for the other — summing the line file double-counts
shipping on every row — so the order-level money columns are absent from `LINE_COLUMNS`.

**Personalisation is a first-class column and a filter.** It is the only thing in this shop
that stops a paid, in-stock order from shipping, and a shirt printed with the wrong name is a
total loss rather than a restock (§12.4).

### What is needed

1. **Free disk space.** Nothing below is possible until this is done.
2. **Restart the Docker VM**, then `aj-pg` and `aj-redis`. The containers could not even be
   restarted while the volume was full, so they will need bringing back up rather than just
   unpausing.
3. `cd spike/backend && npx medusa build` — has never run against this code.
4. `npm run test:integration:http` — the existing 382 must still pass. The customer-list and
   rate-limit suites both touch orders, so a mistake in `src/orders.ts` will not show up
   there; only a new suite will.
5. **Write `integration-tests/http/orders.spec.ts`.** It does not exist yet. It has to cover,
   at minimum:
   - `paymentState()` on a real completed order through the system provider — the derivation
     above is unverified
   - `fulfilmentState()` for unfulfilled, and for an order with a fulfilment created
   - money columns adding up: subtotal + shipping + tax − discount = total
   - the line export producing one row per line, and the register one row per order
   - personalisation counts, and the `needs_approval` filter
   - a formula-injection name reaching the export, as `customers.spec.ts` already does
   - the RBAC split: Staff reads the list, Staff is refused the export, Owner gets it
     (belongs in `rbac.spec.ts`, next to the customer-list pair already there)
6. **`README.md` Step 41** and the test count at line 35, once the numbers are real. It
   currently says 940, which does not include anything from this piece of work.

### What was finished and verified before the disk filled

- Step 40, the customer list and its CSV export — 413 unit, 382 integration, both builds clean.
- Step 39, rate limiting — Redis-backed counters, forwarded customer identity, limits on
  Medusa's own auth and checkout routes.

Both are documented in `README.md` and neither is affected by the above.
