import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { CATALOG_MODULE } from '../../../modules/catalog'

/** GET /admin/reviews?status=pending — the moderation queue. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const status = (req.query.status as string) || 'pending'

  const all = await catalog.listProductReviews({}, { take: 5000, order: { created_at: 'DESC' } })
  const rows = status === 'all' ? all : all.filter((r: any) => r.status === status)

  const counts: Record<string, number> = { all: all.length }
  for (const r of all) counts[r.status] = (counts[r.status] ?? 0) + 1

  res.json({
    reviews: rows.map((r: any) => ({
      id: r.id, product_id: r.product_id, rating: r.rating, title: r.title, body: r.body,
      author: r.author_name, email: r.email, verified_purchase: r.verified_purchase,
      fit_feedback: r.fit_feedback, status: r.status,
      rejection_reason: r.rejection_reason, created_at: r.created_at,
    })),
    counts,
    rejection_reasons: ['spam', 'abusive', 'off_topic', 'personal_info', 'not_a_customer'],
    policy:
      'Rejection requires a policy reason. A low rating is not one — suppressing negative ' +
      'reviews is named explicitly in the FTC Consumer Reviews rule (research.md §7.10).',
  })
}
