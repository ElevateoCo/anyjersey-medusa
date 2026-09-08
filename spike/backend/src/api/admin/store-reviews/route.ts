import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { CATALOG_MODULE } from '../../../modules/catalog'

/**
 * GET /admin/store-reviews — the 84 imported reviews, which had no admin surface.
 *
 * These are published on the storefront: the homepage aggregate and the cards under it are
 * these rows. There was no update and no delete path anywhere in the repository, so a review
 * with a typo, a mis-attributed product, or a name its author wants removed could only be
 * changed with SQL.
 *
 * They are also the ones that carry a disclosure obligation — reviews of eBay, Depop and
 * Facebook Marketplace transactions from before this shop opened, shown as written. So the
 * listing reports where they came from and how they were matched, which is what someone
 * auditing the claim needs.
 */
const intParam = (v: unknown, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && String(v ?? '') !== '' ? n : fallback
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)

  const limit = Math.min(Math.max(intParam(req.query.limit, 25), 1), 100)
  const offset = Math.max(intParam(req.query.offset, 0), 0)

  const where: Record<string, unknown> = {}
  if (req.query.source) where.source = String(req.query.source)
  if (req.query.product_id) where.product_id = String(req.query.product_id)
  if (req.query.match_method) where.match_method = String(req.query.match_method)

  const [reviews, count] = await catalog.listAndCountStoreReviews(where, {
    skip: offset, take: limit, order: { reviewed_at: 'DESC' },
  })

  const all = await catalog.listStoreReviews(
    {}, { select: ['rating', 'source', 'match_method', 'product_id'], take: 100000 }
  )
  const rows = all as any[]

  res.json({
    reviews, count, limit, offset,
    health: {
      total: rows.length,
      average: rows.length
        ? Math.round((rows.reduce((n, r) => n + r.rating, 0) / rows.length) * 100) / 100
        : null,
      // The 67 that name no product, or a shirt we no longer stock. Not a migration failure
      // to go back and fix — there is no more per-product data in existence — but it is the
      // number that explains why the homepage count and the product counts differ.
      attached: rows.filter((r) => r.product_id).length,
      unmatched: rows.filter((r) => r.match_method === 'unmatched').length,
    },
    sources: [...new Set(rows.map((r) => r.source))].sort(),
  })
}
