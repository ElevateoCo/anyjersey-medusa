import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { cacheKey, serveCached } from '../../../cache'
import { limited } from '../../../rate-limit'

/**
 * GET /store/sitemap
 *
 * Everything a sitemap needs, in one query: handles and last-modified dates for every
 * published product, plus the facet values that have their own indexable listing URL.
 *
 * This exists because `/store/jerseys` caps `limit` at 100, so a 3,155-product sitemap
 * built on it would be 32 round trips on every rebuild. It selects three columns instead
 * of the listing payload, so walking the whole catalog is one cheap query rather than a
 * paginated crawl of the API the customer uses.
 *
 * Drafts and soft-deleted rows are excluded by the `status: 'published'` filter, not by
 * post-filtering — a sitemap that lists a 404 is worse than one that omits a page, because
 * it spends the crawl budget and then teaches the crawler to distrust the file.
 */
/** Shared across instances once REDIS_URL is set — see src/cache.ts. */
const TTL_SECONDS = 15 * 60
const KEY = cacheKey('sitemap')

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  // The whole catalogue in one query. The storefront asks once an hour and caches it, so ten
  // a minute is unreachable in normal use — this exists to stop a loop, not a person.
  if (await limited(req, res, 'sitemap', 10, 60_000)) return

  return serveCached(
    req,
    res,
    { key: KEY, ttlSeconds: TTL_SECONDS, header: 'x-sitemap-cache' },
    () => build(req)
  )
}

async function build(req: MedusaRequest) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'product',
    fields: ['handle', 'updated_at', 'jersey_detail.league', 'jersey_detail.team'],
    filters: { status: 'published' },
    pagination: { take: 100000, skip: 0 },
  })

  // Facet values are collected from the same rows rather than from /store/facets, so a
  // listing URL can never appear in the sitemap for a facet with no live products behind
  // it. The two endpoints cache independently and would otherwise drift.
  const leagues = new Set<string>()
  const teams = new Set<string>()
  const products: { handle: string; updated_at: string }[] = []

  for (const p of data as any[]) {
    if (!p.handle) continue
    products.push({
      handle: p.handle,
      updated_at: new Date(p.updated_at ?? Date.now()).toISOString(),
    })
    const d = p.jersey_detail
    if (d?.league) leagues.add(d.league)
    if (d?.team) teams.add(d.team)
  }

  const body = {
    products,
    leagues: [...leagues].sort(),
    teams: [...teams].sort(),
    generated_at: new Date().toISOString(),
  }

  return body
}
