import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { buildOrderRows, filterAndSortOrders, toLineCsv, toOrderCsv } from '../../../../orders'
import { daysFrom, selectionFrom } from '../route'

/**
 * GET /admin/order-list/export?rows=orders|items
 *
 * **Two shapes, because they answer different questions and neither substitutes for the
 * other.** `orders` is one row per order — what a bookkeeper reconciles a month against, with
 * tax, shipping and discount broken out because each lands in a different place. `items` is
 * one row per line, which is what a shop actually picks and packs from and what Shopify's own
 * order export produces; the order-level money is deliberately absent from it, because
 * summing a line file double-counts the shipping on every row.
 *
 * **Owner-only, gated on `privacy:read`.** An order register carries every customer's name,
 * address and phone number — the same personal data the customer export does, arranged
 * differently. Gating it on `order:read`, which Staff has for the revenue report, would mean
 * the bulk extract this shop is careful about has a second door with a weaker lock.
 *
 * Logged with who took it and how many rows, for the same reason: Art. 5(2) is
 * accountability, and a bulk extract with no record of who took it is the gap that turns a
 * lost laptop into an unanswerable question. Filters are honoured, so narrowing the screen
 * narrows the file — the Art. 5(1)(c) half.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const rows = await buildOrderRows(req.scope, { days: daysFrom(req) })
  const selected = filterAndSortOrders(rows, selectionFrom(req))

  const perLine = req.query.rows === 'items'
  const body = perLine ? toLineCsv(selected) : toOrderCsv(selected)
  const lines = perLine
    ? selected.reduce((s, o) => s + o.lines.length, 0)
    : selected.length

  const actor = (req as any).auth_context?.actor_id ?? 'unknown'
  req.scope.resolve(ContainerRegistrationKeys.LOGGER).info(
    `[privacy] order ${perLine ? 'line-item' : 'register'} CSV export: ${lines} rows ` +
      `from ${selected.length} of ${rows.length} orders by user ${actor}`
  )

  const stamp = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="orders-${perLine ? 'items-' : ''}${stamp}.csv"`
  )
  // A file of customer records must not sit in a proxy cache.
  res.setHeader('Cache-Control', 'no-store')
  res.send(body)
}
