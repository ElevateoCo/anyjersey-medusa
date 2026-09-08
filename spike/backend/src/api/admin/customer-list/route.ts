import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import {
  buildCustomerRows, selectCustomers,
  type MarketingStatus, type SortKey,
} from '../../../customers'

/**
 * GET /admin/customer-list
 *
 * **Not `/admin/customers`**, and the reason is the same one the storefront's
 * `curated-collections` records: Medusa owns that path. A route file of ours there would
 * register a second handler on it, one of the two would win depending on load order, and
 * whichever lost would be the admin's own customers screen rendering blank columns — a
 * failure that looks like missing data rather than a routing collision.
 *
 * So this is a separate path serving a separate screen. Medusa's built-in list still works;
 * this is the one with the numbers an operator actually opens a customer to find — spend,
 * order count, first purchase, whether they may be marketed to.
 *
 * Everything computed — spend, order count, last order — is computed in JS over the whole
 * order set, so it cannot be filtered or sorted in the database. That is why paging happens
 * after assembly and why `_performance` says where this stops being free.
 */
const SORTS: SortKey[] = ['created_at', 'amount_spent', 'orders', 'last_order_at', 'name']
const MARKETING: MarketingStatus[] = ['subscribed', 'implied', 'unsubscribed']

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { rows, orphan_orders } = await buildCustomerRows(req.scope)

  const sort = SORTS.includes(req.query.sort as SortKey)
    ? (req.query.sort as SortKey)
    : 'created_at'
  const marketing = MARKETING.includes(req.query.marketing as MarketingStatus)
    ? (req.query.marketing as MarketingStatus)
    : undefined
  const account = req.query.account === 'account' || req.query.account === 'guest'
    ? (req.query.account as 'account' | 'guest')
    : undefined

  const page = selectCustomers(rows, {
    q: req.query.q as string,
    marketing,
    account,
    sort,
    direction: req.query.direction === 'asc' ? 'asc' : 'desc',
    limit: Number(req.query.limit ?? 50) || 50,
    offset: Number(req.query.offset ?? 0) || 0,
  })

  res.json({
    customers: page.rows,
    count: page.count,
    // Totals for the whole base, not the filtered page: the header numbers should not move
    // when somebody types in the search box.
    summary: {
      total: rows.length,
      with_account: rows.filter((r) => r.has_account).length,
      subscribed: rows.filter((r) => r.marketing === 'subscribed').length,
      unsubscribed: rows.filter((r) => r.marketing === 'unsubscribed').length,
      /**
       * Orders that belong to no customer row.
       *
       * Expected to be non-zero and not a bug: an order whose customer was erased under a
       * subject request is retained for six years and anonymised (src/privacy.ts), so it
       * has no customer and no address left to match on. Surfaced rather than hidden,
       * because "the customer totals do not add up to the revenue report" is otherwise an
       * afternoon of somebody's life.
       */
      unattributed_orders: orphan_orders,
    },
    _performance:
      'Assembled in JS over every order, like /admin/reports/overview. Fine into the low ' +
      'tens of thousands; past that it wants a rollup table keyed by customer.',
  })
}
