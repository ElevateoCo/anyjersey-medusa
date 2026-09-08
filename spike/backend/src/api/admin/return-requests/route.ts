import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { CATALOG_MODULE } from '../../../modules/catalog'

/**
 * GET /admin/return-requests?status=new
 *
 * The returns queue. Oldest first, for the same reason the personalisation queue is: a
 * newest-first queue starves its own backlog, and here the backlog is a customer waiting
 * to be told whether they can send a shirt back.
 *
 * Counts are returned alongside so the page can show the tabs without a second round trip.
 */
const STATUSES = ['new', 'approved', 'label_sent', 'received', 'resolved', 'declined'] as const

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const status = String(req.query.status ?? 'new')
  const limit = intParam(req.query.limit, 50)
  const offset = intParam(req.query.offset, 0)

  const filters: Record<string, unknown> = {}
  if (status !== 'all') filters.status = status

  const [rows, count] = await catalog.listAndCountReturnRequests(filters, {
    take: limit,
    skip: offset,
    order: { created_at: 'ASC' },
  })

  const counts: Record<string, number> = {}
  for (const s of STATUSES) {
    const [, n] = await catalog.listAndCountReturnRequests({ status: s }, { take: 1 })
    counts[s] = n
  }

  res.json({ return_requests: rows, count, limit, offset, counts })
}

/** `Number(x) || fallback` is wrong when 0 is legitimate — it cost 63 abandoned carts once. */
function intParam(raw: unknown, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}
