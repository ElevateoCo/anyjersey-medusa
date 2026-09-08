import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import type { MedusaContainer } from '@medusajs/framework/types'
import { CATALOG_MODULE } from './modules/catalog'
import {
  csvDate, csvMoney, toCsvFile, yesNo, type Column,
} from './csv'

/**
 * The customer list, and the export of it.
 *
 * Medusa ships a customers screen; it lists the `customer` table and nothing else. What an
 * operator actually opens a customer for — how much they have spent, how many orders, when
 * they first bought, whether they may be marketed to — is spread across three modules and
 * none of it is on that screen. This assembles it.
 *
 * Four things shape the result, and each of them is a decision rather than a detail.
 *
 * **1. Guests are customers.** The shop deliberately has no account requirement (§12.1), so a
 * list filtered to `has_account = true` would show a handful of people and hide almost every
 * buyer. Medusa creates a `customer` row for a guest checkout too, so both are here — with
 * the distinction on the row, because it changes what you can do next. There is no password
 * to reset on an account that does not exist.
 *
 * **2. Amount spent is computed, not stored.** Medusa v2 has no `order.total` column: totals
 * live in `order_summary.totals` as JSON whose shape is an internal detail, and reading it
 * with SQL would be a query that breaks silently on an upgrade. So this aggregates through
 * `query.graph`, the same way `/admin/reports/overview` does, and carries the same honest
 * note about where that stops scaling.
 *
 * **3. A total across currencies is a wrong number, not a rounded one.** Multi-currency is
 * deferred (DEFERRED.md §3) so in practice every order is USD — but "in practice" is how
 * wrong totals get shipped. A customer with orders in more than one currency gets
 * `amount_spent: null` and `mixed_currency: true`, which the screen renders as "—". Better a
 * missing number than a plausible one.
 *
 * **4. Marketing status has three values, not two.** Shopify shows subscribed or not. This
 * shop actually sends on two different bases, and conflating them is how a compliance
 * mistake happens:
 *
 *   - `subscribed`   — a newsletter signup that has not been withdrawn. Consent.
 *   - `implied`      — has ordered, never signed up. PECR reg. 22(3) soft opt-in: receives
 *                      the cart-recovery email and nothing else.
 *   - `unsubscribed` — withdrew, anywhere. Suppression is marketing-wide by design
 *                      (src/suppression.ts), so one refusal covers every commercial message.
 */
export type MarketingStatus = 'subscribed' | 'implied' | 'unsubscribed'

export type CustomerRow = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  name: string
  phone: string | null
  has_account: boolean
  created_at: string
  orders: number
  amount_spent: number | null
  currency_code: string | null
  mixed_currency: boolean
  last_order_at: string | null
  last_order_display_id: string | null
  marketing: MarketingStatus
  address_1: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  country_code: string | null
}

/**
 * The default address, chosen the way the customer would expect.
 *
 * Medusa flags one address `is_default_shipping`; a guest who checked out has addresses on
 * the order and none flagged. So: the flagged one, else the most recently added. Falling
 * back to "the first row Postgres happened to return" would show a customer the address they
 * used two years ago and call it current.
 */
function savedAddress(addresses: any[] | undefined) {
  const list = addresses ?? []
  if (!list.length) return null
  return (
    list.find((a) => a.is_default_shipping) ??
    [...list].sort(
      (a, b) => Date.parse(b.created_at ?? 0) - Date.parse(a.created_at ?? 0)
    )[0]
  )
}

/** Medusa returns a to-one relation as an object or a one-element array, depending. */
const one = (v: any) => (Array.isArray(v) ? v[0] : v) ?? null

/** Postgres numerics arrive as strings, and `+=` on those is string concatenation. */
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0))
  return Number.isFinite(n) ? n : 0
}

const fullName = (first: string | null, last: string | null, email: string) =>
  [first, last].filter(Boolean).join(' ').trim() || email.split('@')[0]

export type BuildResult = {
  rows: CustomerRow[]
  /** Orders that could not be attributed to a customer row — see below. */
  orphan_orders: number
}

/**
 * Assemble every customer row. Filtering, sorting and paging happen on the result, because
 * "amount spent" and "orders" are computed here and cannot be sorted by in the database.
 */
export async function buildCustomerRows(
  container: MedusaContainer
): Promise<BuildResult> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const [{ data: customers }, { data: orders }] = await Promise.all([
    query.graph({
      entity: 'customer',
      fields: [
        'id', 'email', 'first_name', 'last_name', 'phone', 'has_account', 'created_at',
        // `addresses.*` rather than named fields: this is the trap the README records at
        // every layer — relations requested field-by-field resolve as undefined without
        // erroring, and the screen renders blank addresses that look like missing data.
        'addresses.*',
      ],
      pagination: { take: 100000, skip: 0 },
    }),
    query.graph({
      entity: 'order',
      fields: [
        // `version` is required or Medusa cannot resolve shipping-method adjustments and the
        // whole query fails with an error that says nothing about the missing field.
        'id', 'display_id', 'customer_id', 'email', 'created_at', 'currency_code',
        'total', 'version',
        /**
         * The delivery address, and it is not a nicety.
         *
         * Medusa does **not** copy an order's shipping address into `customer_address` for a
         * guest checkout — that table is for saved addresses on a real account. Since guests
         * are most of this shop's buyers (§12.1), a list built only on `customer.addresses`
         * shows a blank location column for almost everybody, and a blank name too: a guest
         * customer row carries no `first_name` either.
         *
         * The first version of this did exactly that, and the tests caught it. Shopify shows
         * a guest's address on the same screen for the same reason — it is the address a
         * courier used, which is the one an operator is asking about.
         *
         * `.*` rather than named fields: relations requested field-by-field resolve as
         * undefined without erroring, which is the trap the README records at every layer.
         */
        'shipping_address.*',
      ],
      pagination: { take: 100000, skip: 0 },
    }),
  ])

  /**
   * Orders are attributed by `customer_id`, falling back to the email.
   *
   * The fallback is not defensive padding: an order placed before a customer record existed,
   * or one whose customer was erased under a GDPR request while the order was retained for
   * tax (privacy.ts keeps orders for six years and anonymises them), has no usable id. The
   * email match catches the first case; the second is deliberately *not* matched, because an
   * anonymised order no longer carries an address to match on. Whatever cannot be attributed
   * is counted and reported rather than silently dropped from the totals.
   */
  const byCustomer = new Map<string, any[]>()
  const byEmail = new Map<string, any[]>()
  for (const o of orders as any[]) {
    if (o.customer_id) {
      const list = byCustomer.get(o.customer_id) ?? []
      list.push(o)
      byCustomer.set(o.customer_id, list)
    }
    const email = String(o.email ?? '').trim().toLowerCase()
    if (email) {
      const list = byEmail.get(email) ?? []
      list.push(o)
      byEmail.set(email, list)
    }
  }

  // Marketing state, one query rather than one per customer.
  const catalog: any = container.resolve(CATALOG_MODULE)
  const messages = await catalog.listInboundMessages({}, { take: 100000 })
  const unsubscribed = new Set<string>()
  const subscribed = new Set<string>()
  for (const m of messages as any[]) {
    const email = String(m.email ?? '').trim().toLowerCase()
    if (!email) continue
    if (m.unsubscribed_at) unsubscribed.add(email)
    else if (m.kind === 'newsletter') subscribed.add(email)
  }

  const attributed = new Set<string>()
  const rows: CustomerRow[] = (customers as any[]).map((c) => {
    const email = String(c.email ?? '').trim().toLowerCase()
    const mine = byCustomer.get(c.id) ?? byEmail.get(email) ?? []
    for (const o of mine) attributed.add(o.id)

    /**
     * The most recent order, tie-broken on `display_id`.
     *
     * Two orders can share a `created_at` to the millisecond, and when they do a
     * timestamp-only sort is stable — it keeps whatever order the query returned, which put
     * the *older* order first and made the list report a customer's last order as their
     * first. A test placing two orders back to back caught it. `display_id` is monotonic per
     * order, so it settles the tie in the only direction that can be right.
     */
    const latest = [...mine].sort((a, b) => {
      const byTime = Date.parse(b.created_at) - Date.parse(a.created_at)
      return byTime !== 0 ? byTime : Number(b.display_id ?? 0) - Number(a.display_id ?? 0)
    })[0]

    const currencies = new Set(mine.map((o) => o.currency_code).filter(Boolean))
    const mixed = currencies.size > 1
    const spent = mixed ? null : Math.round(mine.reduce((s, o) => s + num(o.total), 0) * 100) / 100

    /**
     * The saved address if there is one, otherwise the one the courier used.
     *
     * An account holder who has kept an address on file means that address; a guest has
     * none, and the most recent order's is the only one that exists.
     */
    const address = savedAddress(c.addresses) ?? one(latest?.shipping_address)

    const marketing: MarketingStatus = unsubscribed.has(email)
      ? 'unsubscribed'
      : subscribed.has(email)
        ? 'subscribed'
        : 'implied'

    return {
      id: c.id,
      email: c.email,
      first_name: c.first_name ?? address?.first_name ?? null,
      last_name: c.last_name ?? address?.last_name ?? null,
      name: fullName(
        c.first_name ?? address?.first_name ?? null,
        c.last_name ?? address?.last_name ?? null,
        String(c.email ?? '')
      ),
      // The order's address is the one a courier actually used; the customer record's phone
      // is often empty for a guest, because nothing ever asked for it outside checkout.
      phone: c.phone ?? address?.phone ?? null,
      has_account: !!c.has_account,
      created_at: c.created_at,
      orders: mine.length,
      amount_spent: spent,
      currency_code: mixed ? null : ([...currencies][0] ?? null),
      mixed_currency: mixed,
      last_order_at: latest?.created_at ?? null,
      last_order_display_id: latest?.display_id != null ? String(latest.display_id) : null,
      marketing,
      address_1: address?.address_1 ?? null,
      city: address?.city ?? null,
      province: address?.province ?? null,
      postal_code: address?.postal_code ?? null,
      country_code: address?.country_code ?? null,
    }
  })

  return {
    rows,
    orphan_orders: (orders as any[]).filter((o) => !attributed.has(o.id)).length,
  }
}

export type SortKey = 'created_at' | 'amount_spent' | 'orders' | 'last_order_at' | 'name'

export type Selection = {
  q?: string
  marketing?: MarketingStatus
  account?: 'account' | 'guest'
  sort?: SortKey
  direction?: 'asc' | 'desc'
}

/**
 * Search and sort. Paging is separate on purpose: the screen wants a page, the export wants
 * the whole selection, and both must apply *identical* filters. Sharing one function is what
 * guarantees that the file matches what the operator was looking at when they clicked export.
 */
export function filterAndSort(rows: CustomerRow[], opts: Selection): CustomerRow[] {
  let out = rows

  const q = (opts.q ?? '').trim().toLowerCase()
  if (q) {
    out = out.filter((r) =>
      [r.email, r.name, r.phone, r.city, r.postal_code, r.last_order_display_id]
        .some((v) => String(v ?? '').toLowerCase().includes(q))
    )
  }
  if (opts.marketing) out = out.filter((r) => r.marketing === opts.marketing)
  if (opts.account) out = out.filter((r) => r.has_account === (opts.account === 'account'))

  const sort = opts.sort ?? 'created_at'
  // Descending by default: the useful question is almost always "who is new" or "who spends
  // most", and both of those are the top of a descending list.
  const dir = opts.direction === 'asc' ? 1 : -1

  /**
   * Absent data sorts last in **both** directions.
   *
   * A customer who has never ordered has no last-order date, and a mixed-currency customer
   * has no meaningful total. Treating those as a very small number puts "never ordered" at
   * the top of "oldest last order", which reads as a real answer and is not one. They are
   * missing values, not extreme ones, so they go to the end whichever way the arrow points.
   */
  const missing = (r: CustomerRow): boolean => {
    switch (sort) {
      case 'amount_spent': return r.amount_spent === null
      case 'last_order_at': return !r.last_order_at
      default: return false
    }
  }

  const value = (r: CustomerRow): number | string => {
    switch (sort) {
      case 'amount_spent': return r.amount_spent ?? 0
      case 'orders': return r.orders
      case 'last_order_at': return r.last_order_at ? Date.parse(r.last_order_at) : 0
      case 'name': return r.name.toLowerCase()
      default: return Date.parse(r.created_at)
    }
  }

  return [...out].sort((a, b) => {
    const ma = missing(a)
    const mb = missing(b)
    if (ma !== mb) return ma ? 1 : -1

    const x = value(a)
    const y = value(b)
    if (typeof x === 'string' || typeof y === 'string') {
      return String(x).localeCompare(String(y)) * dir
    }
    return (x - y) * dir
  })
}

/** One page of the selection, for the screen. */
export function selectCustomers(
  rows: CustomerRow[],
  opts: Selection & { limit?: number; offset?: number }
): { rows: CustomerRow[]; count: number } {
  const matched = filterAndSort(rows, opts)
  const offset = Math.max(0, opts.offset ?? 0)
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  return { rows: matched.slice(offset, offset + limit), count: matched.length }
}

export const CSV_COLUMNS: Column<CustomerRow>[] = [
  { label: 'Name', value: (r) => r.name },
  { label: 'First name', value: (r) => r.first_name },
  { label: 'Last name', value: (r) => r.last_name },
  { label: 'Email', value: (r) => r.email },
  { label: 'Phone', value: (r) => r.phone },
  { label: 'Has account', value: (r) => yesNo(r.has_account) },
  { label: 'Customer since', value: (r) => csvDate(r.created_at) },
  { label: 'Orders', value: (r) => r.orders },
  // Blank rather than 0 for a mixed-currency customer: a spreadsheet will sum this column,
  // and a fabricated zero is a wrong total that nobody questions.
  { label: 'Amount spent', value: (r) => csvMoney(r.amount_spent) },
  { label: 'Currency', value: (r) => r.currency_code },
  { label: 'Last order', value: (r) => csvDate(r.last_order_at) },
  { label: 'Last order number', value: (r) => r.last_order_display_id },
  { label: 'Marketing', value: (r) => r.marketing },
  { label: 'Address', value: (r) => r.address_1 },
  { label: 'City', value: (r) => r.city },
  { label: 'Province', value: (r) => r.province },
  { label: 'Postal code', value: (r) => r.postal_code },
  { label: 'Country', value: (r) => r.country_code },
]

export const toCsv = (rows: CustomerRow[]) => toCsvFile(CSV_COLUMNS, rows)
