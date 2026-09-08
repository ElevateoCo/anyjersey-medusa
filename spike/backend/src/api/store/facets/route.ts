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
const KEY = cacheKey('facets')

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
      select: ['league', 'team', 'sport', 'colourway', 'garment', 'season', 'is_custom'],
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

  const body = {
    total: details.length,
    // A count rather than a tally: `custom` is one boolean, and rendering it as a facet
    // list of ["true", "false"] would put "false" in the navigation.
    custom: details.filter((d: any) => d.is_custom).length,
    leagues: tally('league'),
    teams: tally('team'),
    sports: tally('sport'),
    colourways: tally('colourway'),
    garments: tally('garment'),
    seasons: tally('season').slice(0, 40),
  }

  return body
}
