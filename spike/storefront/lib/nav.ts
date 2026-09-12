import type { Facets, CuratedCollection } from './medusa'

/**
 * The category bar, as a model rather than a hand-written list.
 *
 * `layout-plan.md` §5 band C. The reference store spends twelve nav slots on a single
 * sport, which lets it give five of them to product type. We sell six sports across seven
 * leagues, so sport is the largest useful division and has to be on the bar, and product
 * type compresses to two slots — the catalogue is 95% jerseys, and five product-type slots
 * would be four empty rooms.
 *
 * Three rules hold this together:
 *
 * 1. **Ordered data with a position, not a list in JSX.** §5 calls this out specifically:
 *    `world-cup-2026` resolves to more products than Best Sellers and in a World Cup summer
 *    it earns a bar slot while Custom moves into the overflow. A hand-written list makes
 *    that an edit; a position field makes it a number.
 * 2. **Derived from facets, never typed.** Every count and every team on this bar comes
 *    from `/store/facets`. The one exception is Best Sellers, which is editorial — no
 *    property of a product says "best seller" — and is guarded on the collection existing.
 * 3. **A sport below the threshold goes into More.** A top-level nav item leading to
 *    sixteen products is a dead end that looks like a section.
 *
 * Counts go in the panels, never on the bar. "Hockey 16" on a dark nav bar reads as an
 * apology.
 */
export type NavLink = { label: string; href: string; count?: number }
export type NavColumn = { title: string; href?: string; links: NavLink[] }
export type NavPanel = { columns: NavColumn[]; footer?: NavLink }
export type NavSlot = {
  key: string
  label: string
  href: string
  position: number
  /** The yellow flag on Custom. One item may carry it; two is noise. */
  flag?: string
  panel?: NavPanel
}

/** Slots on the bar before the rest fall into More. Twelve is the reference's own budget. */
const MAX_BAR = 12

/** A sport earns a bar slot at this many products. Below it, More. */
const SPORT_ON_BAR = 100

/** Teams per league column in the Shop by Team panel, before "All N →". */
const PER_COLUMN = 8

/** Athletes per sport column. The facet endpoint already caps its own buckets at 24. */
const ATHLETES_PER_COLUMN = 8

const SPORT_LABEL: Record<string, string> = {
  football: 'Football',
  soccer: 'Soccer',
  baseball: 'Baseball',
  basketball: 'Basketball',
  'college football': 'College',
  hockey: 'Hockey',
  mma: 'MMA',
}

/** League display order in the team panel — biggest first, then the two that are not leagues. */
const LEAGUE_ORDER = ['NFL', 'NBA', 'MLB', 'NCAA', 'SOCCER', 'CLUB', 'NHL']

const LEAGUE_LABEL: Record<string, string> = {
  SOCCER: 'International',
  CLUB: 'Clubs',
  NCAA: 'College',
}

const sportHref = (sport: string) => `/jerseys?sport=${encodeURIComponent(sport)}`
const teamHref = (team: string) => `/jerseys?team=${encodeURIComponent(team)}`
const playerHref = (player: string) => `/jerseys?player=${encodeURIComponent(player)}`

/**
 * Teams grouped by league, biggest league first and biggest team first inside it.
 *
 * The facet list arrives sorted by count already, so the grouping preserves that without
 * re-sorting: the first eight teams in a column are the eight with the most stock.
 */
function teamColumns(facets: Facets): NavColumn[] {
  const byLeague = new Map<string, Facets['teams']>()
  for (const t of facets.teams) {
    const key = t.league ?? 'OTHER'
    byLeague.set(key, [...(byLeague.get(key) ?? []), t])
  }
  const order = (l: string) => {
    const i = LEAGUE_ORDER.indexOf(l)
    return i === -1 ? LEAGUE_ORDER.length : i
  }
  return [...byLeague.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([league, teams]) => ({
      title: LEAGUE_LABEL[league] ?? league,
      href: `/jerseys?league=${encodeURIComponent(league)}`,
      links: teams.slice(0, PER_COLUMN).map((t) => ({
        label: t.value, href: teamHref(t.value), count: t.count,
      })),
    }))
}

/**
 * Athletes grouped by sport.
 *
 * **The unsported bucket is deliberately dropped, and the reason has changed.**
 *
 * It used to be wreckage: misspelled team names sitting in the `player` column ("Detriot
 * Lions", "Philidelphia 76ers", "Memphis Grizzles") and title fragments ("Wyoming Cowboys
 * Josh Allen"), because the parser leaves the whole phrase in `player` when it cannot find
 * a team. `backend/src/scripts/fix-taxonomy-gaps.ts` classified all 72 of those, and
 * `classify-mma.ts` did the fighters before them — 4,322 of 4,323 products now carry a
 * sport.
 *
 * The bucket is still dropped because what is left in it is one product called "Rolex
 * Watches", which is not an athlete and is flagged for review. The rule earns its keep as a
 * guard rather than as a cleanup: anything that fails classification in future lands here,
 * and the Athletes panel is the last place it should surface.
 */
function athleteColumns(facets: Facets): NavColumn[] {
  return (facets.players ?? [])
    .filter((b) => b.sport)
    .map((b) => ({
      title: SPORT_LABEL[b.sport!] ?? b.sport!,
      href: sportHref(b.sport!),
      links: b.players.slice(0, ATHLETES_PER_COLUMN).map((p) => ({
        label: p.value, href: playerHref(p.value), count: p.count,
      })),
    }))
}

/** The teams in one sport, as a panel under that sport's bar slot. */
function sportPanel(facets: Facets, sport: string): NavPanel {
  const teams = facets.teams.filter((t) => t.sport === sport)
  const cols: NavColumn[] = []
  for (let i = 0; i < teams.length && cols.length < 4; i += PER_COLUMN) {
    cols.push({
      title: cols.length === 0 ? 'Teams' : '',
      links: teams.slice(i, i + PER_COLUMN).map((t) => ({
        label: t.value, href: teamHref(t.value), count: t.count,
      })),
    })
  }
  return {
    columns: cols,
    footer: {
      label: `All ${SPORT_LABEL[sport] ?? sport}`,
      href: sportHref(sport),
      count: facets.sports.find((s) => s.value === sport)?.count,
    },
  }
}

export type Nav = { bar: NavSlot[]; more: NavSlot[] }

export function buildNav(facets: Facets, collections: CuratedCollection[]): Nav {
  const has = (handle: string) => collections.some((c) => c.handle === handle)
  const collection = (handle: string) => collections.find((c) => c.handle === handle)
  const slots: NavSlot[] = []

  // 1 — the whole catalogue. `/jerseys` has always been the all-products listing: it
  // filters on jersey_detail regardless of garment, so the shorts, the sets, the jackets
  // and the one hat are already in there. Only the old "All Jerseys" label said otherwise.
  slots.push({ key: 'all', label: 'Shop All', href: '/jerseys', position: 10 })

  // 2 and 3 — the *who* axis, which is not "team": it is team **or** athlete. Ten MMA
  // fighters have no team at all, and the athlete panel is the only route to them.
  slots.push({
    key: 'teams', label: 'Shop by Team', href: '/jerseys', position: 20,
    panel: {
      columns: teamColumns(facets),
      footer: { label: 'All teams', href: '/jerseys', count: facets.teams.length },
    },
  })
  const athletes = athleteColumns(facets)
  if (athletes.length) {
    slots.push({
      key: 'athletes', label: 'Shop by Athlete', href: '/jerseys', position: 30,
      panel: { columns: athletes },
    })
  }

  // 4 — editorial, and the only entry on the bar that is cross-sport *and* cross-garment.
  // Guarded: a nav slot that 404s because a collection was emptied for a season is worse
  // than one that quietly disappears.
  if (has('best-sellers')) {
    slots.push({
      key: 'best-sellers', label: 'Best Sellers',
      href: '/collections/best-sellers', position: 40,
    })
  }

  // 5–9 — sport, in catalogue order, and only where there is enough stock to be a section.
  let pos = 50
  for (const s of facets.sports) {
    if (s.count < SPORT_ON_BAR) continue
    slots.push({
      key: `sport-${s.value}`,
      label: SPORT_LABEL[s.value] ?? s.value,
      href: sportHref(s.value),
      position: pos,
      panel: sportPanel(facets, s.value),
    })
    pos += 2
  }

  // 10 and 11 — product type, two slots. `garment` is repeated rather than comma-joined:
  // Express parses a repeated key into an array and MikroORM reads an array as an IN, so
  // `?garment=shorts&garment=set` is one query. A comma would be matched as a literal.
  slots.push({ key: 'jerseys', label: 'Jerseys', position: 90,
    href: '/jerseys?garment=jersey&garment=longsleeve-jersey' })
  slots.push({ key: 'shorts', label: 'Shorts & Kits', position: 100,
    href: '/jerseys?garment=shorts&garment=set' })

  // 12 — a different product at a different price, not a filter of the main catalogue.
  if (facets.custom > 0) {
    slots.push({ key: 'custom', label: 'Custom', href: '/jerseys?custom=true',
      position: 110, flag: 'New' })
  }

  // Everything the bar could not hold, plus the sports under the threshold and the
  // collections nobody gave a slot to.
  const belowThreshold = facets.sports.filter((s) => s.count < SPORT_ON_BAR)
  const spare = collections.filter((c) => c.handle !== 'best-sellers' && c.count > 0)
  const overflow: NavSlot[] = []

  const ordered = slots.sort((a, b) => a.position - b.position)
  const bar = ordered.slice(0, MAX_BAR)
  overflow.push(...ordered.slice(MAX_BAR))

  const moreColumns: NavColumn[] = []
  if (belowThreshold.length) {
    moreColumns.push({
      title: 'More sports',
      links: belowThreshold.map((s) => ({
        label: SPORT_LABEL[s.value] ?? s.value, href: sportHref(s.value), count: s.count,
      })),
    })
  }
  if (spare.length) {
    moreColumns.push({
      title: 'Collections',
      links: spare.slice(0, PER_COLUMN).map((c) => ({
        label: c.title, href: `/collections/${c.handle}`, count: c.count,
      })),
    })
  }
  // The tail: jackets, the one hat, and anything else that is neither a jersey nor a kit.
  const tail = facets.garments.filter(
    (g) => !['jersey', 'longsleeve-jersey', 'shorts', 'set'].includes(g.value)
  )
  const everythingElse: NavLink[] = [
    ...overflow.map((s) => ({ label: s.label, href: s.href })),
    ...tail.map((g) => ({
      label: g.value.replace(/^./, (c) => c.toUpperCase()),
      href: `/jerseys?garment=${encodeURIComponent(g.value)}`,
      count: g.count,
    })),
  ]
  if (everythingElse.length) {
    moreColumns.push({ title: 'Everything else', links: everythingElse })
  }

  if (moreColumns.length) {
    bar.push({
      key: 'more', label: 'More', href: '/jerseys', position: 999,
      panel: { columns: moreColumns },
    })
  }

  return { bar, more: overflow }
}

/** A seasonal collection promoted onto the bar, if one is running. */
export const seasonalSlot = (
  collections: CuratedCollection[], handle: string, label: string, position: number
): NavSlot | null => {
  const c = collections.find((x) => x.handle === handle && x.count > 0)
  return c ? { key: c.handle, label, href: `/collections/${c.handle}`, position } : null
}
