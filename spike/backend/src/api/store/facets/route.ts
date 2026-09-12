import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { CATALOG_MODULE } from '../../../modules/catalog'
import { cacheKey, serveCached } from '../../../cache'
import { limited } from '../../../rate-limit'

/**
 * GET /store/facets
 *
 * Navigation for a 3,591-product catalog. The counts come off the indexed columns in
 * jersey_detail (research.md §13.3) — the source catalog's own tags and metafields are
 * unusable, so this is the only real taxonomy the store has.
 */
/**
 * Cached for 5 minutes, **through Medusa's cache module** rather than in a module-scoped
 * variable.
 *
 * Facet counts are aggregates over the whole catalog, so the tally reads every row —
 * 3,155 today. That was happening on every request. Caching makes it once per window
 * instead, which is the cheap fix; the real one is a search engine that computes facets
 * natively (research.md §4) or a materialised view.
 *
 * The in-process version of this was correct on one instance and wrong on two: each process
 * kept its own copy, so two shoppers could be shown different counts for the same catalog.
 * With REDIS_URL set the window is now shared. See src/cache.ts.
 */
const TTL_SECONDS = 5 * 60
/**
 * The suffix is the payload *shape*, not a version of the data.
 *
 * Without it, adding `players` and the per-team league would have gone out behind a warm
 * cache: every instance would keep serving the previous shape for up to five minutes after
 * the deploy, and the storefront reading the new fields would render an empty navigation
 * with no error anywhere. Bump it whenever the body below changes.
 */
const KEY = cacheKey('facets', 'v3')

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  // Aggregation over the catalogue, cached both here and at the storefront. Same caveat as
  // `/store/jerseys`: one caller for most legitimate traffic, so the budget is a ceiling on
  // runaway behaviour rather than a per-customer limit.
  if (await limited(req, res, 'facets', 300, 60_000)) return

  return serveCached(
    req,
    res,
    { key: KEY, ttlSeconds: TTL_SECONDS, header: 'x-facet-cache' },
    () => build(req)
  )
}

async function build(req: MedusaRequest) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const details = await catalog.listJerseyDetails(
    {},
    {
      select: ['league', 'team', 'sport', 'colourway', 'garment', 'season', 'is_custom',
        'player'],
      take: 100000,
    }
  )

  const tally = (key: string) => {
    const m = new Map<string, number>()
    for (const d of details) {
      const v = d[key]
      if (v) m.set(v, (m.get(v) ?? 0) + 1)
    }
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, count }))
  }

  /**
   * The value a second column most often carries for each value of the first.
   *
   * "Most often" rather than "the first one seen": a handful of rows carry a stale league
   * for a team that has since moved (Washington, the Raiders), and picking by frequency
   * puts the team in the league it actually sells in rather than the league of whichever
   * row the tally happened to read first.
   */
  const pairedWith = (key: string, parent: string) => {
    const m = new Map<string, Map<string, number>>()
    for (const d of details) {
      const v = d[key]
      const p = d[parent]
      if (!v || !p) continue
      if (!m.has(v)) m.set(v, new Map())
      const inner = m.get(v)!
      inner.set(p, (inner.get(p) ?? 0) + 1)
    }
    const out = new Map<string, string>()
    for (const [v, inner] of m) {
      out.set(v, [...inner.entries()].sort((a, b) => b[1] - a[1])[0][0])
    }
    return out
  }

  const teamLeague = pairedWith('team', 'league')
  const teamSport = pairedWith('team', 'sport')
  const playerSport = pairedWith('player', 'sport')
  const playerTeam = pairedWith('player', 'team')

  /**
   * Players, capped per sport rather than globally.
   *
   * `player` is populated on 94% of the catalogue — some 3,000 distinct values — and
   * shipping all of them would put a quarter of a megabyte into a response that every page
   * of the storefront waits on. A global top-N is worse than useless here: it would be
   * entirely NFL, and the athletes who are the *only* reason this facet exists — the MMA
   * range, which carries no sport, no league and no team — have one or two products each
   * and would never make the cut. Capping per bucket, the unsported bucket included, is
   * what keeps them reachable.
   */
  const PER_SPORT = 24
  const playersBySport = new Map<string, { value: string; count: number; team: string | null }[]>()
  for (const { value, count } of tally('player')) {
    const sport = playerSport.get(value) ?? ''
    const bucket = playersBySport.get(sport) ?? []
    if (bucket.length >= PER_SPORT) continue
    bucket.push({ value, count, team: playerTeam.get(value) ?? null })
    playersBySport.set(sport, bucket)
  }

  const body = {
    total: details.length,
    // A count rather than a tally: `custom` is one boolean, and rendering it as a facet
    // list of ["true", "false"] would put "false" in the navigation.
    custom: details.filter((d: any) => d.is_custom).length,
    leagues: tally('league'),
    // `league` and `sport` ride along on each team so the navigation can group 173 teams
    // without a hand-maintained map in the storefront — the kind of list that goes stale
    // the first time a team is renamed. The two axes are not the same shape: the team
    // panel groups by league (Barcelona is CLUB, England is SOCCER), the sport bar groups
    // by sport (both are soccer).
    teams: tally('team').map((t) => ({
      ...t,
      league: teamLeague.get(t.value) ?? null,
      sport: teamSport.get(t.value) ?? null,
    })),
    players: [...playersBySport.entries()]
      .map(([sport, players]) => ({ sport: sport || null, players }))
      .sort((a, b) => {
        const n = (x: typeof a) => x.players.reduce((s, p) => s + p.count, 0)
        return n(b) - n(a)
      }),
    sports: tally('sport'),
    colourways: tally('colourway'),
    garments: tally('garment'),
    seasons: tally('season').slice(0, 40),
  }

  return body
}
