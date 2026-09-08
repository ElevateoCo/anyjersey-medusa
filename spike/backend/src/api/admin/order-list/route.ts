import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import {
  buildOrderRows, selectOrders, summariseOrders, filterAndSortOrders,
  type FulfilmentState, type OrderSortKey, type PaymentState,
} from '../../../orders'

/**
 * GET /admin/order-list
 *
 * **Not `/admin/orders`**, for the reason `/admin/customer-list` is not `/admin/customers`:
 * Medusa owns that path, a route file of ours there registers a second handler on it, and
 * whichever loses the load-order race is the admin's own orders screen rendering blank
 * columns — a failure that reads as missing data rather than a routing collision.
 *
 * The register that screen is not. Money broken out rather than collapsed into a total,
 * payment and fulfilment derived from the relations rather than trusted as computed fields,
 * and personalisation on the row — the one thing in this shop that stops a paid, in-stock
 * order from shipping.
 */
const SORTS: OrderSortKey[] = ['created_at', 'total', 'items', 'display_id']
const PAYMENTS: PaymentState[] = [
  'not_paid', 'authorized', 'partially_authorized', 'paid', 'refunded', 'canceled',
]
const FULFILMENTS: FulfilmentState[] = [
  'unfulfilled', 'partially_fulfilled', 'fulfilled', 'shipped', 'delivered', 'canceled',
]

export function selectionFrom(req: MedusaRequest) {
  return {
    q: req.query.q as string,
    payment: PAYMENTS.includes(req.query.payment as PaymentState)
      ? (req.query.payment as PaymentState)
      : undefined,
    fulfilment: FULFILMENTS.includes(req.query.fulfilment as FulfilmentState)
      ? (req.query.fulfilment as FulfilmentState)
      : undefined,
    needs_approval: req.query.needs_approval === 'true',
    sort: SORTS.includes(req.query.sort as OrderSortKey)
      ? (req.query.sort as OrderSortKey)
      : ('created_at' as OrderSortKey),
    direction: (req.query.direction === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc',
  }
}

/** `days` bounds the query itself, so a long history does not have to be assembled to read a week. */
export const daysFrom = (req: MedusaRequest): number | undefined => {
  const raw = Number(req.query.days)
  if (!Number.isFinite(raw) || raw <= 0) return undefined
  return Math.min(raw, 3650)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const rows = await buildOrderRows(req.scope, { days: daysFrom(req) })
  const selection = selectionFrom(req)

  const page = selectOrders(rows, {
    ...selection,
    limit: Number(req.query.limit ?? 50) || 50,
    offset: Number(req.query.offset ?? 0) || 0,
  })

  res.json({
    orders: page.rows,
    count: page.count,
    // Totals for the **selection**, not the page and not the whole base: an operator who has
    // filtered to "unfulfilled" is asking what that is worth, and answering with the month's
    // revenue would be answering a different question.
    summary: summariseOrders(filterAndSortOrders(rows, selection)),
    _performance:
      'Assembled in JS over the period, like /admin/reports/overview. Fine into the low ' +
      'tens of thousands; past that it wants SQL aggregation over an orders rollup.',
  })
}
