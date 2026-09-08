import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { CATALOG_MODULE } from '../../../modules/catalog'

/**
 * GET /admin/personalisations?status=pending
 *
 * The review queue — spec §6. Every personalisation waits here before it prints, including
 * ones that passed the automated screen, because a blocklist catches the words it knows
 * about and the residual risk on a printed garment is a trademark claim rather than a rude
 * word.
 *
 * Ordered oldest first. A queue that shows the newest first silently starves its own
 * backlog, and the backlog is what holds up orders.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const status = String(req.query.status ?? 'pending')
  const limit = intParam(req.query.limit, 50)
  const offset = intParam(req.query.offset, 0)

  const filters: Record<string, unknown> = {}
  if (status !== 'all') filters.review_status = status

  const [rows, count] = await catalog.listAndCountLinePersonalisations(filters, {
    take: limit,
    skip: offset,
    order: { created_at: 'ASC' },
  })

  const counts = await queueCounts(catalog)
  res.json({ personalisations: rows, count, limit, offset, counts })
}

async function queueCounts(catalog: any) {
  const out: Record<string, number> = {}
  for (const s of ['pending', 'approved', 'rejected']) {
    const [, n] = await catalog.listAndCountLinePersonalisations({ review_status: s }, { take: 1 })
    out[s] = n
  }
  return out
}

/**
 * `Number(x) || fallback` is wrong whenever 0 is meaningful — it turned offset=0 into
 * offset=1 elsewhere in this codebase and showed 3 abandoned carts instead of 66.
 */
function intParam(raw: unknown, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}
