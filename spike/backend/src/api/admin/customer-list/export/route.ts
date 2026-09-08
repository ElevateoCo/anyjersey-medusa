import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import {
  buildCustomerRows, filterAndSort, toCsv,
  type MarketingStatus, type SortKey,
} from '../../../../customers'

/**
 * GET /admin/customer-list/export — the whole list as CSV.
 *
 * **Owner-only, and gated on `privacy:read` rather than `customer:read`.** Viewing the list
 * is daily work: somebody answering "where is my order" needs to find a person. Taking every
 * customer's name, address, phone and email off the system in one file is a different act,
 * and it is the same act `/admin/privacy/subject` is owner-only for. Reusing that permission
 * rather than inventing an `export` operation keeps one answer to "who can extract customer
 * data in bulk" instead of two that can drift apart.
 *
 * The export is **logged**, at info, with who did it and how many rows. Not for the log's
 * sake: GDPR Art. 5(2) is accountability, and a bulk extract with no record of who took it or
 * when is the gap that turns a laptop theft into an unanswerable question.
 *
 * Filters are honoured. An operator exporting "everyone who unsubscribed" should not get a
 * file containing everyone — a needlessly wide export is the data-minimisation failure
 * Art. 5(1)(c) is about, and the screen makes it easy to narrow.
 */
const SORTS: SortKey[] = ['created_at', 'amount_spent', 'orders', 'last_order_at', 'name']
const MARKETING: MarketingStatus[] = ['subscribed', 'implied', 'unsubscribed']

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { rows } = await buildCustomerRows(req.scope)

  const marketing = MARKETING.includes(req.query.marketing as MarketingStatus)
    ? (req.query.marketing as MarketingStatus)
    : undefined
  const account = req.query.account === 'account' || req.query.account === 'guest'
    ? (req.query.account as 'account' | 'guest')
    : undefined

  const selection = {
    q: req.query.q as string,
    marketing,
    account,
    sort: SORTS.includes(req.query.sort as SortKey) ? (req.query.sort as SortKey) : 'created_at',
    direction: (req.query.direction === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc',
  }
  // `filterAndSort`, not `selectCustomers`: the export is the whole selection rather than the
  // screen's page, and sharing the filter function is what guarantees the file matches what
  // the operator was looking at when they clicked.
  const selected = filterAndSort(rows, selection)

  const actor = (req as any).auth_context?.actor_id ?? 'unknown'
  req.scope.resolve(ContainerRegistrationKeys.LOGGER).info(
    `[privacy] customer CSV export: ${selected.length} of ${rows.length} rows by user ${actor}` +
      (marketing || account || req.query.q ? ` (filtered)` : '')
  )

  const stamp = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="customers-${stamp}.csv"`)
  // A file of customer records must not sit in a proxy cache.
  res.setHeader('Cache-Control', 'no-store')
  res.send(toCsv(selected))
}
