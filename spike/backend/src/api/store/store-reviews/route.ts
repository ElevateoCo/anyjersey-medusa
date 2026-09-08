import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { CATALOG_MODULE } from '../../../modules/catalog'
import { cached, cacheKey, invalidate } from '../../../cache'

/**
 * GET /store/store-reviews?limit=12
 *
 * The store-wide aggregate and a sample, for the homepage.
 *
 * All 84 imported reviews count here — including the 45 attached to a product, because a
 * review of a shirt we sold is also a review of the shop. What must never happen is the
 * reverse: the *store* aggregate appearing on a product page as that product's rating. That
 * is precisely the §12.7 finding about the reference storefront, which shows 137,135 reviews
 * on its homepage and 8,342 on a product page. `/store/reviews?product_id=` is the only
 * endpoint that answers for a product, and it counts only that product's reviews.
 *
 * Nothing first-party is included. Reviews submitted here are about a specific product and
 * are answered by the other endpoint; mixing them in would make this number cover two scopes
 * at once, which is the same defect one layer up.
 */
/** Shared across instances once REDIS_URL is set — see src/cache.ts. */
const TTL_SECONDS = 10 * 60
const KEY = cacheKey('store-reviews')

/**
 * Drop the cached aggregate.
 *
 * Two callers. Tests need it, because a ten-minute cache makes every assertion after the
 * first one read a stale body — which is how four tests here failed while the endpoint was
 * correct. And the import script should have it, because without a way to invalidate, a
 * freshly imported corpus is invisible for up to ten minutes and the operator's reasonable
 * conclusion is that the import did not work.
 *
 * It takes a container now: the cache lives in Medusa's cache module rather than in this
 * file, which is what makes the invalidation reach every instance rather than one.
 */
export const __resetCache = (container: { resolve: (k: string) => unknown }) =>
  invalidate(container, KEY)

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 12) || 12, 1), 50)

  // The whole corpus is cached and the limit is applied after, so two pages asking for
  // different sample sizes share one cached aggregate instead of storing a body each.
  const { value, hit } = await cached<Body>(req.scope as never, KEY, TTL_SECONDS,
    () => build(req))
  res.setHeader('x-store-reviews-cache', hit ? 'hit' : 'miss')
  return res.json(withLimit(value, limit))
}

async function build(req: MedusaRequest): Promise<Body> {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const rows = await catalog
    .listStoreReviews({}, { take: 500, order: { reviewed_at: 'DESC' } })
    .catch(() => [])

  const all = rows as any[]
  const count = all.length
  const average = count
    ? Math.round((all.reduce((n, r) => n + r.rating, 0) / count) * 100) / 100
    : null

  const body: Body = {
    count,
    average,
    distribution: [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: all.filter((r) => Math.round(r.rating) === stars).length,
    })),
    sources: Object.entries(
      all.reduce<Record<string, number>>((acc, r) => {
        acc[r.source] = (acc[r.source] ?? 0) + 1
        return acc
      }, {})
    )
      .map(([source, n]) => ({ source, count: n }))
      .sort((a, b) => b.count - a.count),
    reviews: all.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      author: r.author_name,
      source: r.source,
      reviewed_at: r.reviewed_at,
    })),
    // Stated in the payload rather than only in the theme, so any surface that renders these
    // carries the disclosure with them. §7.10.
    disclosure:
      'These reviews were left by buyers on eBay, Depop and Facebook Marketplace before this ' +
      'shop opened. They are shown as written, unfiltered, and are not verified against ' +
      'orders placed here.',
  }

  return body
}

type Body = {
  count: number
  average: number | null
  distribution: { stars: number; count: number }[]
  sources: { source: string; count: number }[]
  reviews: Record<string, unknown>[]
  disclosure: string
}

/**
 * The limit trims the sample, never the counts.
 *
 * Returning `count: 12` alongside twelve cards would be a different number for the same
 * scope on every page that asked for a different page size — the drift this whole endpoint
 * is shaped to avoid.
 */
const withLimit = (body: Body, limit: number): Body => ({
  ...body,
  reviews: body.reviews.slice(0, limit),
})
