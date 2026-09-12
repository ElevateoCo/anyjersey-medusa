# History — where things were left

A running note of the most recent piece of work, what state it is in, and what has to happen
next. Written for whoever picks this up cold, including me after a break.

`README.md` is the record of *what was built and why*. This file is the record of *what is
half-finished right now*. `SWITCHED-OFF.md` is the record of *what is built and currently
turned off* — read it before wondering why something that exists is not happening.

---

## 2026-09-12 — taxonomy gaps closed, team tiles are photographs

**4,322 of 4,323 products now carry a sport**, up from 4,250.
`backend/src/scripts/fix-taxonomy-gaps.ts` holds the table; it is explicit and re-runnable.

**The rule it follows, if you extend it: the title names the team, and the job is to spell
it correctly — not to look up a roster.** Where a title names no team, `team` stays null.
Super Bowl 51 was the Patriots; the listing does not say so, and a wrong team is worse than
a missing one.

**One product is deliberately unclassified.** "Rolex Watches" is published, is not a jersey,
and is flagged `needs_review`. Whether it belongs in the catalogue is a merchandising call.

**Two numbers in the status report were stale, not open.** "111 shorts missing" and "122
unresolved Best Sellers handles" came from `layout-plan.md` §3b, measured against the
3,155-product catalogue that **Step 26 replaced**. Re-measured: 417 of 417 Best Sellers
resolve, every shorts collection resolves in full, shorts went 70 → 177. Two handles are
genuinely absent and both are still live on cruxchristi.com — a two-stage import, not a
one-off.

**Team tiles are photographs.** `/store/facets` returns one image per team (first
photo-bearing product, catalogue order — deterministic, so the rail cannot reshuffle between
loads). `lib/team-colors.ts` did not become dead: the ring is still the team's secondary
colour, and an unphotographed team still falls back to colours and initials.

---

## 2026-09-12 — `medusa build` no longer touches ~/Downloads

**Status: fixed, and not the way the 2026-09-10 entry expected.**

Two findings, and the order matters.

**It had already stopped hanging.** Full Disk Access has been granted to the terminal at
some point since, so the build completed in 55 seconds with the symlink still in place, and
`ls` on the archive returns its 6,632 files. That is fix #1 from the 2026-09-10 entry,
applied by hand.

**That fixes one machine, which is not the same as fixing it.** A colleague's laptop and any
CI runner have no such grant, and the failure there is the one that cost a day: not an
error, not a timeout, a process sitting inside `open()` at 1.5 seconds of CPU. So fix #2 was
done as well and the dependency is gone.

### What changed

- `static/media` — the symlink into `~/Downloads` — **deleted**. `medusa build` scans
  `static/`, and that is the only reason it ever went near the archive.
- `ingest-media.ts` reads `MEDIA_ARCHIVE_DIR` and `MEDIA_SERVING_DIR` instead of a hardcoded
  path and the symlink. Unset, it refuses with an explanation rather than reporting nothing
  to do — which is indistinguishable from a completed run.
- `import-catalog.ts`, `apply-dedupe.ts`, `reimport-changed.ts` read `MEDIA_HTTP_BASE`
  instead of `http://localhost:9000/static/media`.
- `import-reviews.ts` reads `REVIEWS_JSON` instead of a hardcoded path. That one never
  blocked a build — a string in a script is inert until the script runs — but it fails the
  same way for the next person.

**Nothing in normal operation was using any of it.** All 6,673 image rows point at
`/media/<sha>`, served out of Postgres; zero point at `/static/media`. Verified after the
change: the build passes in 45s, a product image still serves 106KB of WebP, 459 backend
unit tests and the 20 media integration tests pass.

### If you ever re-import

Point `MEDIA_ARCHIVE_DIR` at the archive. **Do not symlink it back into the project tree.**
A variable that is unset fails loudly; a symlink into a privacy-gated folder hangs, and
gives you no way to tell which of those two things is happening.

---

## 2026-09-12 — a register of what is switched off

`SWITCHED-OFF.md`. Six entries, and one of them is time-sensitive.

**The homepage personaliser is not in git.** It was built and deleted inside the same
uncommitted window, so it never reached a commit and there is no revert —
`git log --all --diff-filter=A -- '*Maker.tsx'` returns nothing. The removal was the right
call and is not being argued with; what the note records is that rebuilding it means
rebuilding it, and which parts survived (`lib/team-colors.ts` and `readableInk()`, which are
the expensive bits).

The other five: the EU/UK gate is lifted, free shipping is off with the mechanic left
dormant, the custom line has lost its $89.99 premium, the `.todo` notes are hidden, and the
campaign banner has no asset.

The reason this is its own file rather than a section of `DEFERRED.md`: deferred work is
missing and obvious, and switched-off work looks finished while behaving as though it is
not. That is how a compliance gate stays lifted for a year.

---

## 2026-09-12 — no free shipping, one catalogue price

Every zone's `freeOver` is now `0`; rates unchanged ($4.99 US, $19.99 CA, $24.99 UK/EU,
$29.99 APAC). All 28,998 catalogue prices are **$65.99**, custom jerseys included. (It went
to $64.99 first and back on the next instruction — the script takes the figure as an
argument, so a reprice is one command and not an edit.)

**If you reprice, use `backend/src/scripts/set-catalog-price.ts` and not a bare UPDATE.**
Shipping rates and the personalisation add-on's variants live in the same `price` table; the
add-on is *inside* the variant join and has to be excluded by id, which the script does and
reports. A blanket update sets shipping to the price of a shirt.

**The custom line is no longer a premium product.** It was $89.99 with printing included and
is now $64.99, the same as a blank. No customer-facing copy names a figure so nothing reads
as false, but the margin story is gone until somebody puts it back:
the script sets one figure across everything, so restoring it is a narrower job than the
script currently does.

**A rate change takes a minute to appear, not an hour.** `getZones()` cached for 3600s and
the shipping page published the old thresholds until it expired — under a module whose whole
stated purpose is that the storefront cannot disagree with checkout. Now 60s.

---

## 2026-09-12 — EU/UK gate made switchable

`NEXT_PUBLIC_LIFT_EU_GATE=true` is set in `.env.local`, so EU and UK regions are selectable
locally. **The three appointments are still unmade** — GPSR responsible person, Article 27
representative, IOSS. The flag only stops the storefront saying so, and the shipping page
prints a development notice naming what is outstanding whenever it is on.

Written as a flag rather than a commented-out block on purpose: a comment is invisible to
the type checker and to `grep`, and is what gets shipped by accident. `NODE_ENV` is read at
build time so a production bundle compiles the override out — verified by building with the
flag set and confirming the region picker still disables Europe and the UK.

`euBlocked()` is what the UI enforces; `euGatesOutstanding()` is the truth. Do not collapse
them.

---

## 2026-09-12 (later still) — campaign banner

A full-bleed 8:3 hero for a video or still, `NEXT_PUBLIC_HERO_VIDEO` / `_IMAGE`. **With
neither set it renders nothing in production** and a sized placeholder in development —
check that before wondering where the band went.

Three things the reference markup gets wrong and this does not: `muted` (without it autoplay
simply does not happen), `preload="metadata"` rather than `none` (which contradicts
autoplay), and a pause control (WCAG 2.2.2). Reduced motion is checked *before* play is
attempted, not after.

**The CSP had no `media-src`** — media fell through to `default-src 'self'`, which allows a
file from `public/` and silently blocks one from the API or a CDN. Added, including the API
origin. If a hero video ever "just doesn't play", that directive is the first place to look.

---

## 2026-09-12 (later) — the sport rail, rebuilt to the editorial pattern

Small but worth recording, because it removed a class of problem rather than a look.

The rail's tiles were full-bleed photographs with the label set over them under a scrim.
That is nflshop.com's *hero* treatment; its *editorial* rail puts the caption underneath, and
that is what the tiles do now — square photograph, gutters between, label and count in ink on
paper below.

**Why it matters beyond taste:** type over an uncontrolled photograph has no guaranteed
contrast, so the scrim had to cover the worst case (a white shirt on a white wall) and
darkened every image that did not need it. `contrast_check.py` cannot evaluate text over an
image at all, so that pair had to be argued in a comment. Three special-case entries came out
of that file when the caption moved; the label is now just ink on paper, already checked.

**One thing to not repeat:** the first attempt bled the row to the viewport and reconstructed
the page gutter with `100vw` arithmetic. `100vw` includes the scrollbar, so it was ~7px out —
and more simply, it put the first tile at x=0 while every heading on the page started at 96.
The rail lives inside `.wrap` now and overflows its container instead of the window, which
keeps the peek and fixes the alignment. Verified at 1440 and 390: tile, lede and section
heading share a left edge and neither width scrolls sideways.

---

## 2026-09-12 — the rest of the privacy policy follows the visitor

**Status: done and green.** README **Step 45**. Closes the item the previous entry left open.

Yesterday's work made the cookie *banner* depend on location and left the policy global. Now
the rights, the deadline, the complaint route and the one jurisdiction-set retention period
follow the reader too — `lib/jurisdiction.ts`, nine profiles off the same edge header.

### Three things to know before editing that file

**Only verified statutory facts go in it.** Every deadline was checked against the statute or
the regulator, not recalled. Switzerland's was not confirmed, so `responseDays` is `null` and
the page says we are confirming it. That is not an oversight to tidy up later by guessing —
a published deadline is a promise a regulator can hold us to.

**The document stays complete.** The panel is emphasis, not a variant policy. A regulator
opening `/policies/privacy` sees what a customer sees; only the ordering and the labelling
change. Do not be tempted to trim the US disclosure out of the EU view or vice versa.

**One number was actively wrong before this.** The policy promised "within 30 days" to
everybody. That is the GDPR period and it is slower than Brazil's fifteen, so as a global
sentence it committed the shop to missing the LGPD deadline for every Brazilian customer.

### The retention row

Invoice retention is the tax law of the place of supply and the register's seven years is the
US figure. `backend/src/privacy.ts` now flags it `jurisdictionSet` and exports
`JURISDICTION_SET` next to `UNRESOLVED`. **They are not the same thing** — an unresolved row
has no period and nothing prunes it; this one has a period that runs, and it is simply the
wrong country's number for a non-US customer. Resolving it is an accountant's job per market,
not an engineering one; the flag exists so the seven stops reading as settled.

### The accessibility checker had a hole, and it has been closed

The panel was first rendered above the document, which opened the page `h2` then `h1`. The
checker passed it: it looks for jumps *down* and starts at `prev = 0`, so a late `h1` is not
a jump. It now asserts the outline starts at `h1` — scoped to `<main>` and to headings
**outside any `<nav>`**, because the mega panels and the facet rail both carry `h3`s that are
landmark structure rather than document outline. Without that second exclusion the new rule
fires on every listing page; it did, before it was refined. `a11y_selftest.py` pins the
defect and both exclusions, 27 of 27.

### The consent dialog's buttons were not aligned

`.btn.ghost.dark` carried `margin-top:1rem` — spacing the reviews block wanted, travelling on
the class into the consent banner and the privacy-choices page. With `align-items:center` a
top margin on one flex item offsets it by *half*, so "Essential only" sat 8px low and the
action row was 60px tall for a 44px button. Scoped to `.reviews .btn.ghost.dark`. Worth
remembering as a shape: spacing on a component class is a spring-loaded trap the moment the
class is reused.

### Left open — two, not three

`NEXT_PUBLIC_PRIVACY_EMAIL` now falls back to the support mailbox. That is a real fix, not a
fudge: every one of these laws requires a *contactable channel* and none requires a
*dedicated* address, so an empty variable was a shop with a working mailbox refusing to name
it. The page marks the value as standing in rather than appointed.

The other two cannot be code and should not be attempted:

- **Registered address** — a fact about the company. The Shopify MCP token has expired, and
  the 2026-08-18 backup is in `~/Downloads`, which is the privacy-gated folder that hangs
  `medusa build` (see the 2026-09-10 entry). Do not go looking there for it. One env var.
- **Article 27 EU representative** — a contract with a firm established in the EU.

Both are still enforced rather than merely disclosed: `EU_GATES` blocks EU and UK orders
while they are unset, and a test asserts the request-channel fallback does not quietly
unblock them. Everything else from the entry below is unchanged, including the commit.

---

## 2026-09-11 (evening) — consent by jurisdiction, and one band removed

**Status: done and green.** README **Step 44**, plus an amendment to Step 43.

### The personaliser band came out

The homepage band built earlier today — "Put your name on it" — was removed after seeing it
in place. It sat directly under the Custom Jerseys grid, two adjacent ink bands both headed
some version of the same sentence. The live control was never the homepage one: `Personalise`
on the product page is priced, bundled and server-validated, and it is untouched.

`components/Maker.tsx`, `lib/maker-draft.ts`, its test, the CSS block and the draft-seeding
hook in `Personalise` all went with it — leaving them unreferenced would have left a
`localStorage` key nothing writes and a hook that reads it.

**A copy of the three deleted files is in this session's scratchpad only.** The tree is
uncommitted, so if that band is ever wanted back it is a re-add, not a revert. Committing is
still the outstanding item at the bottom of this file.

### The cookie banner now depends on where the visitor is

`lib/geo.ts` reads a CDN edge header and returns `opt-in` or `opt-out`; the banner renders a
question or a notice accordingly. Two things worth knowing before touching it:

**California is on the opt-in side, and not because of the CCPA.** CIPA is a wiretapping
statute and the 2026 case law turns on ordering, not on having a banner — defendants who
blocked everything until an affirmative opt-in win. Québec is there from Law 25, Brazil from
the LGPD. None of that is guessable from the continent, which is why the list is by regime.

**No edge header means `opt-in`.** Local development has no such header, so the question is
what you see here — that is correct, not a bug. The failure direction was chosen: the
opt-out notice served into Europe would be an ePrivacy violation on every page view; the
opt-in question served into Texas is an annoyance.

Verified through a real browser against nine simulated locations with cookies cleared
between each. Canada and California both abbreviate to `CA`, so the subdivision key carries
the country and a test pins that Canada does not become opt-in.

### Left open, unchanged

§8 item 1 (the ~86 unsported products), §8 item 5 (per-team thumbnails), the missing shorts,
a keyboard and screen-reader pass — and the commit, which now also covers everything above.
One new one: the regime decides the *ask* but not yet the retention period, the DSAR routes
or the privacy-policy text, which still read as one global document. That is §31 work.

---

## 2026-09-11 (later) — the demo concept's functionality, integrated

**Status: done and green.** README **Step 43**. Built on top of the layout from earlier the
same day; nothing here is half-finished.

`anyjersey_files/demo` is a single-file storefront concept over the same catalogue. The brief
was to take its functionality *without overwriting what already works*, and to make its sport
grid horizontal.

### What was taken, and what was left alone

Left alone, because the spike's version is equal or better: the bag drawer, the free-shipping
threshold, search suggestions, the mega-panel nav, the sticky add-to-bag, and the
product-page personaliser — which prices and server-validates where the demo's does neither.

Taken: the sport tile band (as a **rail**, not the demo's 4 × 2 grid), a homepage
personaliser, recently viewed, multi-select filters, `/` to focus search, and a related-
products fallback that reaches past the team.

### Two things worth knowing before touching this again

**1. Recently viewed was built wrong first.** The first version intersected the visitor's
history with the products the page already held — no request, and almost never a rail,
because a homepage holds ~60 of 4,323 products. Caught by driving it end to end in a
browser, not by reading it. The fix put a `handle` filter on `/store/jerseys` (a *product*
column, assembled separately from the `jersey_detail` facet filters — there is a test that
they compose) so the browser can hold handles, which never go stale, rather than cards,
which carry a price.

**2. The homepage rails were showing one club six times.** `/store/jerseys` sorts
alphabetically by handle, so every sport rail opened with six Arizona Cardinals shirts;
`newest` clusters too, because the catalogue was imported a team at a time. `lib/rails.ts`
thins by team without re-sorting. If a rail ever looks repetitive again, that is the file.

### One contrast failure, found by the checker rather than the eye

The personaliser's field border was `#3A3A36` on `#1C1C1A` — 1.49:1, where WCAG 1.4.11 wants
3:1 on a control boundary. It looked fine. Now `#6E6E69` at 3.33:1, and the pair is in
`contrast_check.py` along with five others for the new dark band.

### Deliberately not taken

Star ratings on cards (the demo generates them; this catalogue has almost no per-product
review data, and a fabricated rating is the §12.7 defect with worse consequences), and
folding college football into football (a rail has no tile budget to make room in).

### Still open

Unchanged from the entry below — §8 item 1 (the ~86 unsported products), §8 item 5 (per-team
thumbnails), the missing shorts, a keyboard and screen-reader pass, and the commit. The tree
has now been uncommitted since 2026-09-08 and holds the order register, the layout, and this.

---

## 2026-09-11 — the layout is built

**Status: done and green.** Written up as **README Step 42**, and `layout-plan.md` §11 is the
short version against the plan it was built from. Nothing here is half-finished; what is left
is listed at the bottom and none of it blocks anything.

`layout-plan.md` had been a plan since 2026-09-07 with decisions 1–7 awaiting an answer. Six
were taken as recommended. **Decision 4 moved**: team tiles are the team's *colours* with its
initials, not cropped product photos, because the photo version needs a per-team thumbnail
endpoint that is still §8 item 5. Decision 2 also went the other way on its own data — NBA is
on the bar rather than in More, because the Step 26 re-sync took it from 30 products to 477.

### What is running that was not before

- Bands A–E, all five, and a phone shape: 56px row, drawer accordion, full-screen search
  sheet. There was no mobile menu at all before this.
- Twelve nav slots and an overflow, from `storefront/lib/nav.ts`, built off the catalogue.
- Mega-panels on eight of them, server-rendered — `NavItem` owns a boolean and nothing else.
- `storefront/lib/team-colors.ts`: 173 teams, with the readable ink computed rather than
  chosen.

### The data change, because it is the part that touched the database

`backend/src/scripts/classify-mma.ts` ran with `write` against the live spike database and
updated **13 `jersey_detail` rows**: `sport='mma'`, plus three fighter names that had a garment
word on the end. Derived from membership of the `mma-2026` collection. It is idempotent and
re-runnable, and a dry run is the default.

Ten fighters who were invisible to every rail and every nav item are reachable now. What it
also did was expose the rest of §8 item 1: with the fighters classified, the unsported
`player` bucket contains only misspelled team names and title fragments. `lib/nav.ts` drops
that bucket from the Athletes panel on purpose and a test pins it.

**One thing worth knowing before touching Redis again.** Flushing it to clear a warm facet
cache also clears the workflow engine's and the event bus's keys — this is a local spike
database and nothing was lost, but the right move is the one that ended up in the code:
`cacheKey('facets', 'v3')` carries the payload shape, so a changed response body invalidates
itself.

### The 2026-09-10 blocker is unchanged

`npx medusa build` still hangs on the privacy-gated symlink at `backend/static/media`. Nothing
in this piece of work went near it, and the storefront's own `next build` is clean. The two
ways out are still the two ways out.

### Left open, in the order I would take them

1. **§8 item 1** — classify the ~86 products with no sport, and fix the misspellings behind
   them ("Detriot Lions", "Philidelphia 76ers", "Memphis Grizzles"). They sit in the `player`
   column, so they are one bad join away from appearing as athletes.
2. **§8 item 5** — a thumbnail per team, which is what turns decision 4 back into photo crops.
   The data shape in `Rail` does not change.
3. **§8 items 6 and 7** — the 111 missing shorts and the unresolved Best Sellers handles.
4. **A keyboard traversal and a screen-reader pass over the mega-panels.** The mechanical
   checks say the markup is right; they cannot say whether the panel is pleasant to operate,
   and a twelve-slot bar with eight panels is exactly where that goes wrong.
5. **Commit.** The tree has been uncommitted since 2026-09-08 and now holds the order register,
   its two money bugs, and all of this.

---

## 2026-09-10 — order register verified, two bugs fixed

**Status: done and green.** The register from 2026-09-06 has now run against a real database.
Written up as **README Step 41**. One thing is still blocked and it is not code — see the last
section.

### The 2026-09-06 blocker is cleared

| | |
|---|---|
| Disk | was 98% full with 10Gi free; now **21Gi free** |
| Colima | was stopped; started clean |
| `aj-postgres` · `aj-redis` | both had exited unclean. Postgres replayed its WAL on start (*"database system was not properly shut down; automatic recovery in progress"*) and came up healthy |
| The data | intact — **4,856 products, 32,660 variants, 41 orders** |

Worth knowing: the containers are `aj-postgres` and `aj-redis`. The 2026-09-06 note called the
database one `aj-pg`, and there *is* a stale container by that name with no ports bound. It is
not the one this project uses.

### What the verification found

The register derived payment and fulfilment from relations rather than trusting Medusa's
computed `payment_status` and `fulfillment_status` — the right call, and unchecked until now
because the database went unreachable before it could be. Checking it found two bugs, both in
the money.

**1. The refund branch could never fire.** `paymentState()` summed `captured_amount` and
`refunded_amount` off each *payment*, and `payment` has neither column — on the Payment model
both are computed from the `captures` and `refunds` relations, so neither arrives through
`query.graph` even under `.*`. Both sums were always 0, so a fully refunded order reported as
`paid`. The totals now come off `payment_collection`, where all three amounts are stored
numeric columns.

**2. The Subtotal column double-counted shipping.** Medusa's `order.subtotal` *includes* the
shipping: on a real two-item order, `item_subtotal` 129.98, `shipping_subtotal` 4.99,
`subtotal` 134.97, `total` 134.97. So the register's Subtotal + Shipping came to 139.96
against a total of 134.97 — wrong by the shipping on every row of every month, in the one file
built for a bookkeeper. Now sourced from `item_subtotal` and `shipping_subtotal`, both net of
tax, and an integration test asserts the identity rather than the columns.

### What is now proven against a real database

- `paymentState()` resolves, and reads `authorized` for a system-provider order — not `paid`,
  because that provider authorises without capturing, and **not `not_paid`**, which is the
  column default and exactly what a failed resolution would produce silently
- The full parcel lifecycle through Medusa's own admin endpoints: unfulfilled → fulfilled →
  shipped → delivered
- The money identity: items + shipping + tax − discount = total
- Both CSV shapes, one row per order and one per line, with the order-level money absent from
  the line file
- Personalisation counts, the `needs_approval` filter, and that the printed name is
  upper-cased at capture (`name: ALLEN`)
- Formula injection through a customer-chosen delivery name
- The RBAC split: Staff reads the register, Staff is refused the export, Owner gets it

### The trap that cost the most time

**The integration runner truncates the database between tests.** An order created in one test
is gone by the next — measured, with `/admin/orders` agreeing with the register at every step.
Three tests in the first draft asserted on "the orders that exist" and read 0 or 1, which
looks exactly like a broken endpoint; I went as far as ruling out an inner join in
`query.graph` before testing the obvious thing. Every test now builds the orders it counts.

The comment in `customers.spec.ts` claiming the runner keeps data across a file is misleading.
Its own tests are all self-sufficient, which is why they pass.

### `medusa build` — RESOLVED 2026-09-12, see that entry

*Left as written, because the diagnosis is the useful part and it took a day to get.*

`npx medusa build` **hangs**, and it is an operating-system permission rather than a defect.

`spike/backend/static/media` is a symlink to
`/Users/emil/Downloads/Anyjersey backup/Backup/backups/2026-08-18-FULL-anyjersey/media/blobs`.
The build scans `static/`, follows it, and blocks in the kernel on `open()` of a directory:

```
node::fs::ReadDir → uv_fs_scandir → scandir → __opendir2 → open$NOCANCEL   ← blocked
```

`~/Downloads` and `~/Desktop` both hang on `ls`; `~/Documents` does not. Those first two are
exactly the folders macOS gates behind a privacy prompt, and a prompt nobody can answer blocks
the syscall instead of failing it. Not the archive's fault and nothing to do with disk space —
the same build reached *"Starting build..."* and then sat at 1.5 seconds of CPU for twenty
minutes, twice.

**Two ways out, and the choice is a real one:**

1. Grant the terminal Full Disk Access in System Settings → Privacy & Security. Fixes it for
   every tool, needs a human at the machine.
2. Stop keeping a symlink into a privacy-gated folder inside the project tree. Only
   `src/scripts/ingest-media.ts` reads it (`join(process.cwd(), 'static', 'media')`) and only
   during a re-import; the 4,635 assets it produced are already in Postgres. Pointing that
   script at an env var and dropping the symlink removes the hazard permanently.

Everything else in the 2026-09-06 list is done. Nothing in this piece of work depends on the
build: the integration runner compiles from source and does not read `.medusa/server`.
