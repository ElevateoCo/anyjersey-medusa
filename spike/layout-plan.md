# Layout plan — NFL Shop structure, generalised across the whole catalogue

**Status:** plan only. No code written. Supersedes nothing; sits alongside `DEFERRED.md`.

**Reference:** `europe.nflshop.com/en` (Fanatics). We are copying its *structure*, not its
content, and not its logos — see "Two things we cannot copy" below.

**The correction that shaped this document:** the first pass of this plan treated the layout
as an NFL layout. It is not. AnyJersey sells seven leagues, six sports, MMA athletes with no
league at all, and six garment types. The layout has to carry all of it, on a phone.

---

## 1. What the NFL Shop layout actually is

Five stacked bands. The ordering is the whole idea.

| Band | Content | Height |
|---|---|---|
| A | Thin dark utility bar — promo left; account / help / language / currency / cart right | ~40px |
| B | White brand row — logo left, **large centred search**, partner badges right | ~96px |
| C | Full-bleed **dark category bar** with mega-menu panels | ~48px |
| D | **"Shop Your Teams"** — label + favourites link, then a horizontal rail of circular team tiles | ~150px |
| E | Full-bleed **4-across editorial mosaic**, zero gutters | 2 rows |

The structural bet: search is promoted to the centre of the page, categories get a bar of
their own, and the *who* axis (teams) gets a rail above any product grid. Nothing about
shopping is left in a wrapped link list.

## 2. Why it cannot be copied item-for-item: NFL Shop is a single-sport store

Their nav bar spends its twelve slots like this:

```
[WHO]          Shop By Team
[AUDIENCE]     Men · Women · Kids
[PRODUCT TYPE] Jerseys · T-Shirts · Sweatshirts · Headwear · Collectibles
[MERCH]        Clearance · Collections · More
```

They can give five slots to product type because **sport is a given** — every product in the
store is NFL. We do not have that luxury. Sport is our largest and most useful division, so it
has to appear on the bar, and product type has to compress:

```
[ENTRY]        Shop All · Best Sellers
[WHO]          Shop by Team · Shop by Athlete   (mega-panels)
[SPORT]        Football · Soccer · Baseball · College
[PRODUCT TYPE] Jerseys · Shorts & Kits
[OURS]         Custom
[OVERFLOW]     More  (Basketball · Hockey · Collections · Everything Else)
```

Twelve slots, the same budget the reference spends. **Shop All** and **Best Sellers** are the
two entry points that belong to no axis: one is the whole catalogue, the other is the only
nav item that is cross-sport *and* cross-garment (see §3b). Both exist in the header today and
must survive the re-layout — `layout.tsx` already renders `All Jerseys` and a conditional
`Best Sellers`, and dropping either would be a regression, not a simplification.

Same shape, same scan pattern, different axis priority. This is the single most important
decision in the document, and everything in band C and the mobile drawer follows from it.

## 3. The catalogue we are actually navigating

Measured from `backend/src/scripts/catalog.json` (3,155 classified products) and cross-checked
against the 2026-08-18 live-store snapshot (3,593 ACTIVE products). Not estimated.

**Garment — the "not just jerseys" axis**

| Garment | Count | Share |
|---|---|---|
| jersey | 3,062 | 97.1% |
| shorts | 70 | 2.2% |
| longsleeve-jersey | 9 | 0.3% |
| set (UFC shirt+shorts combos) | 8 | 0.3% |
| jacket (World Cup windbreakers) | 5 | 0.2% |
| hat | 1 | 0.03% |

**Sport**

| Sport | Count | League |
|---|---|---|
| football | 2,018 | NFL |
| soccer | 432 | SOCCER 397 / CLUB 35 |
| baseball | 413 | MLB |
| college football | 192 | NCAA |
| basketball | 30 | NBA |
| hockey | 9 | NHL |
| **(null)** | **61** | **(null)** |

**What this tells us, and it is not what the brief assumed**

1. The store is 97% jerseys. A nav bar that gives equal billing to five product types would be
   four mostly-empty categories. "Shorts & Kits" (78 products — 70 shorts plus 8 sets) is a real destination;
   "Headwear" (1 hat) is not. Product type earns **two** slots, not five.
2. The long tail is where the layout breaks. Those **61 null-sport products** are precisely
   the ones a sport-first nav renders unreachable, and they include the entire MMA range.
3. Other axes already exist in the data and are not yet navigation: `player` is populated on
   **2,973 of 3,155** products (94%), and `edition` carries values like `combo`. Neither is
   exposed by `/store/facets`, which tallies only league, team, sport, colourway, garment and
   season.

**The MMA problem, stated precisely.** A UFC product looks like this today:

```json
{ "title": "Islam Makhachev Black Combo",
  "sport": null, "league": null, "team": null,
  "player": "Islam Makhachev", "edition": "combo", "garment": "set" }
```

Ten fighters — Makhachev, McGregor, Khabib, Pereira, Topuria, Gaethje, Oliveira, O'Malley,
Volkanovski, Poirier — with no sport, no league and **no team**. Every team-keyed rail and
every sport-keyed nav item is blind to them. They are also inconsistently garmented: the same
fighter's combos are filed as `set` on one row and `shorts` on another, so `edition = 'combo'`
is currently the more reliable signal than `garment`.

So the *who* axis is not "team". It is **team or athlete**, and the nav model has to say so.

## 3b. The curated collections we already have

From `backend/src/scripts/data/collections.json`, fetched 2026-08-29. "Resolve" means the
listed product handle joins to a row in the spike catalogue, matched on `handle` **or**
`jersey_detail.source_handle` — the dedupe merge rewrote about a thousand local handles, so
`source_handle` is the only key that works and joining on `handle` alone under-reports badly.

| Collection | Listed | Resolve | Note |
|---|---|---|---|
| world-cup-2026 | 514 | **408** | Largest collection in the store |
| best-sellers | 417 | **295** | Cross-sport and cross-garment — see below |
| football-2026 | 359 | 330 | |
| basketball-shorts | 75 | **5** | A real hole, not a join artefact |
| baseball-shorts | 54 | 28 | |
| rookie-draft-class-2026 | 49 | 49 | Clean |
| football-shorts | 46 | 33 | |
| shop-by-team | 27 | 25 | A nav construct, not merchandise |
| mma-2026 | 13 | **12** | See below — this one is a gift |
| hockey-shorts | 7 | 6 | |
| college-shorts | 3 | 2 | |

Three things fall out of this table:

**Best Sellers is the best cross-cutting nav item we have.** Its 295 resolved products break
down as football 188 · baseball 42 · soccer 33 · basketball 13 · college 3 · hockey 3 · null 13,
and jersey 287 · set 5 · shorts 3 — all published. Every other nav slot is single-axis. This
one is the only place a shopper sees the breadth of the store in one grid, which is why it
earns a top-level slot rather than a line inside a Collections panel.

**`mma-2026` already identifies the MMA range.** All 12 resolved members are among the 61
null-sport products, and their garments are exactly `shorts` and `set`. So §8 item 2 —
"classify MMA" — is not a manual pass over unlabelled rows: it is
`set sport='mma' where collection_handle='mma-2026'`, plus a look at the 13th listed handle
that does not resolve. That takes the largest data blocker on this plan down to near zero.

**The shorts range is under-imported, and it is not a join problem.** The five sport-scoped
shorts collections list 185 products; 74 resolve, and the spike catalogue holds 70 rows with
`garment='shorts'`. Those two numbers agreeing is the tell — the catalogue genuinely does not
contain the other 111. Basketball is the worst case: 75 listed, 5 present. So "Shorts & Kits"
is a 78-product destination today (70 shorts + 8 sets) and a ~190-product one after a
re-import. Worth knowing before deciding how much bar real-estate it gets.

## 4. Where we are starting from

`app/layout.tsx` puts nine nav links **plus** a 280px right-aligned search **plus** the cart
into one 66px flex row (`.hrow`). The CSS comment at `app/globals.css:67` already records that
this wrapped at 1280px and had to be clamped to survive. There is no category bar, no
mega-menu, no team rail, and **no mobile menu at all** — at 720px `nav.main` becomes a
full-width wrapping list of nine ~26px-tall links.

The homepage leads with a dark hero whose main job is a second copy of the search box.

This is a re-layout, not a re-skin.

---

## 5. Band-by-band specification

### Band A — Utility bar

`.announce` (`globals.css:54`) is already dark ink with a yellow accent. It becomes a two-slot
row instead of centred text.

- **Left:** keep *"Can't find your jersey? Request it"*. NFL Shop's slot holds "SIGN UP & SAVE
  15%" — that is their offer. The request line is our actual differentiator and the one thing
  no competitor's layout has a slot for.
- **Right:** **Track Order · Help · Sign in/Account**, pulled out of `nav.main`. This is what
  frees the room for band C.
- **Not** a currency picker. All five regions are USD (`DEFERRED.md` §3), so a currency chooser
  would advertise a choice that changes no price. `RegionPicker` goes up as **"Ship to: US"**
  instead, which is real — it drives `getZone()` and the free-shipping threshold.

### Band B — Brand row

- Logo left.
- `SearchBox` loses `compact`, moves to centre, ~640px max, full-height field. The existing
  `ul.suggest` dropdown carries over unchanged. For a 3,591-product catalogue spanning six
  sports, **search is the primary navigation** — and a 280px box in the corner says otherwise.
  It is also the only control that finds "Makhachev" today.
- Right slot: `CartButton` plus the store rating (84 reviews / ★4.9 — `layout.tsx` already
  fetches `getStoreReviews(1)` for the footer). Not invented payment badges.

### Band C — Category bar

Full-bleed dark strip. Items derived from data, never typed:

| # | Slot | Destination | Size | Panel |
|---|---|---|---|---|
| 1 | **Shop All** | `/jerseys` — already the all-products listing | 3,591 | — |
| 2 | Shop by Team | `facets.teams` + `backend/src/teams.ts` `TEAM_LEAGUE` | 140 teams | Columns per league, top teams each, "All NFL teams →" |
| 3 | Shop by Athlete | `facets.players` *(new)* | 2,973 tagged | Columns per sport; the only route to the MMA range |
| 4 | **Best Sellers** | `/collections/best-sellers` | 295 | — |
| 5 | Football | `?league=NFL` | 2,018 | Teams + garments in that sport |
| 6 | Soccer | `?league=SOCCER,CLUB` | 432 | ditto |
| 7 | Baseball | `?league=MLB` | 413 | ditto |
| 8 | College | `?league=NCAA` | 192 | ditto |
| 9 | Jerseys | `garment in (jersey, longsleeve-jersey)` | 3,071 | — |
| 10 | Shorts & Kits | `garment in (shorts, set)` or `edition = combo` | 78 | Five sport-scoped shorts collections already exist |
| 11 | Custom | `custom=true` | — | — |
| 12 | More | overflow | — | Basketball (30) · Hockey (9) · Collections · Everything Else (jackets, hat) |

**On slot 1.** `/jerseys` is *already* the all-products listing — `/store/jerseys` filters on
`jersey_detail` rows regardless of garment, so shorts, sets, jackets and the hat are all in
there. The route name is the only thing that says otherwise, and the current header compounds
it by labelling the link "All Jerseys". The label becomes **Shop All**; whether the route
becomes `/shop` with a 301 from `/jerseys` is a separate SEO call (§10.6).

**On slot 4.** Best Sellers is not decoration. It is the single most *representative* entry in
the bar — 295 products spanning six sports and three garments — and the only one that puts an
MMA combo set next to an NFL jersey. It is also editorial and cannot be derived: no property of
a product says "best seller", which is exactly why `layout.tsx` already guards it with
`collections.some(c => c.handle === 'best-sellers')`. Keep that guard.

**On slot 11/12 being seasonal.** `world-cup-2026` resolves to **408 products** — larger than
Best Sellers. In a World Cup summer it earns a bar slot and Custom moves into More. The bar
model must therefore be ordered data with a position field, not a hand-written list.

Rules:
- Cap at **twelve** visible slots, overflow into **More**. Sports below a threshold
  (hockey, 9 products) live in More rather than on the bar — a top-level nav item leading to
  nine products is a dead end that looks like a section.
- **Sport counts go in the panels, not on the bar.** "Hockey 9" on a dark nav bar reads as an
  apology.
- New files: `components/SiteNav.tsx` (server — panel content renders into the HTML),
  a thin client wrapper for hover/tap/Escape state, `lib/nav.ts` for the model.
- The RSC-boundary rule noted at `layout.tsx:76` applies: panels are server data, only the
  open/closed state is client. This codebase has made that mistake twice and has a test for it.

### Band D — The "who" rail

NFL Shop puts official team logos here. We cannot (see §7). The tile becomes a **tight square
crop of that team's best product photo** with the team name below — same circular shape, same
scan pattern, no marks.

Generalised beyond one sport, the rail is **context-dependent**:

| Page | Rail shows |
|---|---|
| Homepage | Top teams across all sports, ordered by product count (NFL dominates, and that is honest) |
| Sport page (`?league=NFL`) | Teams in that sport only |
| MMA / combos | **Athletes**, not teams — same tile, `player` as the label |
| Team page | Players for that team |

One rail component, one data shape (`{ label, href, image }`), four fillings. That is the
generalisation that keeps this from becoming four components.

**Backend work required:** a representative thumbnail per team and per athlete — one query for
the first photo-bearing product per value. Either as fields on `/store/facets` or a new
`/store/nav-tiles`. This is the only backend change in bands A–D.

**"Add Favorites"** has no model behind it (`DEFERRED.md` §7, wishlist). Ship the rail without
it; add a cookie-backed "your teams" later using the same pattern as the consent cookie. No
schema needed.

### Band E — The mosaic, and the thing blocking it

NFL Shop's four full-bleed tiles are lifestyle campaign films. `DEFERRED.md` §6: **67% of our
products have exactly one photograph**, and there is no lifestyle photography or video at all.
Built literally, this band is four grey boxes.

Keep the shape, change the content. A 4-up full-bleed band of **destination** tiles:

1. **Custom Jerseys** — $89.99, highest margin, the one product a competitor cannot copy off a
   supplier list.
2. **Request a Jersey** — the proposition.
3. **Best Sellers** — curated collection.
4. **One sport in season** — rotates; football in autumn, World Cup in summer.

Each tile: an existing product photo bled and darkened under a large Oswald label. Same visual
weight as the reference, buildable today, and tile 4 is where multi-sport becomes visible above
the fold instead of being buried in a nav panel.

If the real version is wanted, it is the same shoot §6 already calls for: four 2000×2000 stills
or four short loops.

### Homepage rhythm after this

Mosaic → who-rail → **Best Sellers rail** → custom band → sport rails (one per sport with ≥30
products) → shorts & kits rail → trust strip → reviews → request.

The Best Sellers rail is new to the homepage — today `app/page.tsx` runs custom → NFL → soccer,
so the one genuinely cross-sport list in the store appears nowhere on it. It goes directly
under the who-rail, because it is the answer to "what is good here?" and every rail below it is
an answer to "what is here?". It also ends the homepage's implicit claim that the store is NFL
and soccer only. Each rail keeps its "See all N →" affordance, and the Shop All link sits at
the end of the last rail as well as in the bar.

Two deletions:
- The dark `.hero` goes. Its search moves to the header; its headline is now the mosaic's job.
  Keeping both means two search boxes above the fold.
- The `.todo` block currently rendering publicly on the homepage goes behind an env flag.

---

## 6. Phone

The reference's mobile shape: hamburger · logo · search · bag; nav as a full-height accordion;
rail as a swipe carousel; mosaic 2-up. Concretely for us:

1. **One 56px row** at ≤900px: ☰ · logo · search · bag. Band A collapses to the request line
   alone; account links move into the drawer.
2. **Menu drawer** reuses the existing `.drawer` / `.drawer-scrim` primitives
   (`globals.css:484`) that `FilterDrawer` and `CartDrawer` already share — no new interaction
   vocabulary. Accordion order mirrors band C: Sports → teams, Athletes, Jerseys, Shorts &
   Kits, Custom, Collections, then account rows at the bottom.
3. **Search becomes a full-screen sheet** on tap, reusing `ul.suggest`. A 280px inline field
   with a dropdown under a phone keyboard is unusable.
4. **iOS input-zoom bug, live today:** `.search.compact input` is `.85rem` ≈ 13.6px
   (`globals.css:369`). Safari zooms the page on focus below 16px. Same audit needed on
   `.cform` and `.pers-field` inputs.
5. **Two-up product grid.** `minmax(210px,1fr)` on a 390px phone resolves to *one* column —
   358px of content cannot fit 2×210 plus a gutter. Drop to `minmax(150px,1fr)` under 640px.
   That halves the scroll depth to the tenth product.
6. **Tap targets.** `nav.main a` is `padding:.35rem 0` ≈ 26px tall. Drawer rows need ≥44px;
   `.chip` and `.sizes button` need the same check.
7. **`--headerh` as a custom property.** `.facets` is `top:80px` hard-coded
   (`globals.css:138`) against a 66px header. Header height is about to change twice
   (desktop/mobile), so the sticky rail, the skip link and the drawer offsets all read the
   variable instead of a magic number.
8. **Sticky add-to-bag on the PDP**, phone only, with safe-area inset — the buybox scrolls off
   a 6-inch screen. `100dvh` not `100vh` for both drawers.
9. **Rail performance.** Up to 140 team tiles plus athlete tiles: lazy past the first eight,
   real `sizes`, and the mosaic must not ship four 2000px JPEGs over 4G.

---

## 7. Two things we cannot copy

**Official team logos.** Fanatics is an NFL licensee; we are a reseller. Using the marks in
site chrome is trademark use. Using the team *name* as text is ordinary nominative use and
stays. Hence photo-crop tiles in band D. This applies to all seven leagues, not just the NFL.

**Lifestyle campaign imagery.** `DEFERRED.md` §6 — one photograph on two products in three, no
lifestyle shots, no video. Band E ships as destination tiles until there is a shoot.

---

## 8. Data work that gates parts of this

The layout is mostly storefront work. These items gate specific pieces, and none of them is
layout work:

| # | Item | Gates | Size |
|---|---|---|---|
| 1 | Classify the **61 null-sport products** — World Cup jackets and misspelled teams ("Detriot Lions", "Flordia Panthers", "Golden State Warrios", "Colombus Blue Jackets", "Eastern Confrence") | Any sport-first nav; these are unreachable otherwise | ~49 rows, after item 2 takes 12 of them |
| 2 | Add **`sport='mma'`** — derivable from `collection_handle='mma-2026'`, which covers 12 of the 12 resolved members | The Athletes panel, the MMA rail | One UPDATE, not a manual pass |
| 3 | Normalise **garment on the combos** — same fighter filed as `set` and `shorts`; `edition='combo'` is the reliable signal | "Shorts & Kits" being a coherent category | 18 rows |
| 4 | Expose **`player`** (94% populated) and **`edition`** in `/store/facets` | Shop by Athlete | Two lines in the tally |
| 5 | **Per-value nav thumbnails** (team, athlete, sport) | Band D | One endpoint |
| 6 | Re-import the **111 missing shorts** — 185 listed across five collections, 74 present, basketball worst at 5 of 75 | Whether "Shorts & Kits" is a 74- or 185-product slot | Re-import + classify |
| 7 | Chase the **122 unresolved Best Sellers** handles (417 listed, 295 resolve) — most likely the 609 DRAFT products in the live snapshot | Whether slot 4 shows 295 or ~417 | Reconcile against the snapshot |

Items 1 and 2 are the highest-value things on this list and have nothing to do with design: 61
products are currently invisible to navigation regardless of what layout sits on top. Item 2
turned out to be nearly free once `mma-2026` was checked, which is the argument for doing this
data pass *before* building band D rather than after.

---

## 9. Phases

**Phase 1 — storefront only, no new data.** Bands A, B, C (sports and garments from existing
facets), the mobile drawer, the search sheet, plus phone items 4–8. This is most of the visible
change and it is unblocked.

**Phase 2 — data pass + one endpoint.** §8 items 1–5, then band D with both fillings (teams
and athletes) and the sport-scoped rails.

**Phase 3 — assets and decisions.** Band E as destination tiles now, photography swapped in
later; favourites cookie; per-sport seasonal rotation of mosaic tile 4.

**Gates before each phase lands:** `a11y_check.py` and `contrast_check.py` — the mega-panels
must be keyboard-operable with Escape, and yellow-on-ink in the new dark bar needs checking —
plus a clean build.

---

## 10. Open decisions

1. **Product type gets two slots, not five.** "Jerseys" and "Shorts & Kits", with the hat, the
   jackets and the tail inside "Everything Else". The alternative is five slots that are four
   empty rooms. Recommend two.
2. **Hockey (9) and NBA (30) start in "More", not on the bar.** They graduate when they have
   the stock to justify a top-level entry. Recommend More.
3. **Shop by Athlete as its own nav slot** — it is the only route to the MMA range and it uses
   the best-populated field we have (94%). Recommend yes, and it is the piece that makes the
   layout genuinely multi-sport rather than NFL-with-extras.
4. **Team tiles as cropped product photos**, not typographic chips. Logos are out either way.
5. **Kill the dark hero.** Recommend yes.
6. **Rename `/jerseys` to `/shop`?** The label becomes "Shop All" either way. Renaming the route
   is honest — the listing has never been jerseys-only — but it means a 301 and a sitemap
   change on the store's highest-traffic non-product URL. Recommend keeping `/jerseys` for now
   and revisiting at launch, when there is no ranking to lose.
7. **Does Best Sellers stay guarded?** Yes — keep `collections.some(...)`. A nav slot that
   404s if a collection is emptied for a season is worse than one that quietly disappears.

Awaiting: 1–7.
