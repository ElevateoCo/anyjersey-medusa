import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import type { MedusaContainer } from '@medusajs/framework/types'
import { CATALOG_MODULE } from './modules/catalog'
import {
  csvDateTime, csvMoney, toCsvFile, yesNo, type Column,
} from './csv'

/**
 * The order register, and the export of it.
 *
 * Medusa has an orders screen. What it has no answer for is the question an order register
 * exists to answer — *show me every order in a period, with the money broken out and the
 * things that stop it shipping visible* — and it has no export at all, which is the half a
 * bookkeeper and a picker both need.
 *
 * Three things shape it.
 *
 * **1. Status is derived here, not requested.** `payment_status` and `fulfillment_status` are
 * computed properties on Medusa's order DTO, and a computed field requested through
 * `query.graph` that does not resolve comes back `undefined` rather than erroring — the trap
 * the README records at every layer, and the one that produced a cart page showing $0.00
 * above a $4.99 total. So these are derived from `payment_collections` and `fulfillments`,
 * which are ordinary relations, and the derivation is asserted against a real completed order
 * rather than trusted.
 *
 * **2. Money is broken out, because a total is not what anybody reconciles against.** Tax,
 * shipping and discount each land in a different place in a bookkeeper's month, and an export
 * with one `total` column means doing the split by hand from the order screen.
 *
 * **3. Personalisation is on the row.** It is the only thing in this shop that can stop an
 * otherwise-paid, in-stock order from shipping: a name and number have to be approved before
 * anything is printed, and a shirt printed with the wrong thing is a total loss rather than a
 * restock (§12.4). An order register for *this* shop that does not show it is a register of
 * the wrong thing.
 */
export type PaymentState =
  | 'not_paid' | 'authorized' | 'partially_authorized' | 'paid' | 'refunded' | 'canceled'
export type FulfilmentState =
  | 'unfulfilled' | 'partially_fulfilled' | 'fulfilled' | 'shipped' | 'delivered' | 'canceled'

export type OrderLine = {
  id: string
  title: string
  variant_title: string | null
  sku: string | null
  quantity: number
  unit_price: number
  total: number
  personalisation: string | null
}

export type OrderRow = {
  id: string
  display_id: string
  created_at: string
  status: string
  email: string
  customer_name: string
  customer_id: string | null
  has_account: boolean

  currency_code: string
  subtotal: number
  shipping_total: number
  tax_total: number
  discount_total: number
  total: number

  items: number
  lines: OrderLine[]

  payment: PaymentState
  fulfilment: FulfilmentState

  /** How many personalisations are on this order, and how many still block printing. */
  personalisations: number
  personalisations_pending: number

  region: string | null
  sales_channel: string | null
  ship_name: string | null
  address_1: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  country_code: string | null
  phone: string | null
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0))
  return Number.isFinite(n) ? n : 0
}

/** Medusa returns a to-one relation as an object or a one-element array, depending. */
const one = (v: any) => (Array.isArray(v) ? v[0] : v) ?? null

/**
 * Payment, from the collections rather than from a computed field.
 *
 * Medusa's `PaymentCollection.status` is the authority: `not_paid`, `awaiting`, `authorized`,
 * `partially_authorized`, `completed`, `canceled`. An order can carry more than one — a
 * later capture creates another — so the rule is the strongest state present, with refunds
 * checked first because a refunded order whose collection still reads `completed` is the case
 * somebody would otherwise chase.
 */
export function paymentState(order: any): PaymentState {
  const collections: any[] = order.payment_collections ?? []

  /**
   * The captured and refunded totals come off the **collection**, not off its payments.
   *
   * This was the other way round and was dead code. `payment` has no `captured_amount` or
   * `refunded_amount` column — checked against the running database — because on the Payment
   * model both are computed from the `captures` and `refunds` relations, and a computed field
   * does not come back through `query.graph` even under `.*`. So both sums were always 0,
   * `refunded > 0` was never true, and a fully refunded order reported as `paid`: precisely
   * the failure mode the README records at every other layer, and worse here because Step 38
   * made refunds actually execute.
   *
   * `payment_collection` carries `authorized_amount`, `captured_amount` and
   * `refunded_amount` as ordinary stored numeric columns, so these resolve.
   */
  const captured = collections.reduce((s, c) => s + num(c.captured_amount), 0)
  const refunded = collections.reduce((s, c) => s + num(c.refunded_amount), 0)
  if (refunded > 0 && captured > 0 && refunded >= captured) return 'refunded'

  const statuses = new Set(collections.map((c) => c.status))
  if (statuses.has('completed')) return 'paid'
  if (statuses.has('authorized')) return 'authorized'
  if (statuses.has('partially_authorized')) return 'partially_authorized'
  if (statuses.size && [...statuses].every((s) => s === 'canceled')) return 'canceled'
  return 'not_paid'
}

/**
 * Fulfilment, from the fulfilments.
 *
 * Ordered by how far the parcel has actually got, and **delivered outranks shipped** rather
 * than the reverse: a partially delivered order is still in motion, and reporting it as
 * delivered would close a case that is open. Cancelled fulfilments are ignored unless they
 * are all there is.
 */
export function fulfilmentState(order: any): FulfilmentState {
  const all: any[] = order.fulfillments ?? []
  const live = all.filter((f) => !f.canceled_at)
  if (!live.length) return all.length ? 'canceled' : 'unfulfilled'

  if (live.every((f) => f.delivered_at)) return 'delivered'
  if (live.some((f) => f.shipped_at)) return 'shipped'

  // Fulfilled but not shipped: a parcel exists and is sitting on the bench. Distinguished
  // from partial because "some items packed" and "everything packed" are different jobs.
  const packed = live.flatMap((f) => f.items ?? [])
    .reduce((s: number, i: any) => s + num(i.quantity), 0)
  const ordered = (order.items ?? []).reduce((s: number, i: any) => s + num(i.quantity), 0)
  return packed > 0 && ordered > 0 && packed < ordered ? 'partially_fulfilled' : 'fulfilled'
}

const fullName = (a: any, email: string) =>
  [a?.first_name, a?.last_name].filter(Boolean).join(' ').trim() ||
  String(email ?? '').split('@')[0]

export type BuildOptions = {
  /** Limit the query to a recent window. Absent means everything. */
  days?: number
}

export async function buildOrderRows(
  container: MedusaContainer,
  opts: BuildOptions = {}
): Promise<OrderRow[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: 'order',
    fields: [
      // `version` is required or Medusa cannot resolve shipping-method adjustments and the
      // whole query fails with an error that says nothing about the missing field.
      'id', 'display_id', 'status', 'version', 'created_at', 'email', 'customer_id',
      'currency_code', 'total', 'tax_total', 'discount_total',
      /**
       * `item_subtotal` and `shipping_subtotal`, **not** `subtotal` and `shipping_total`.
       *
       * Medusa's `subtotal` already includes the shipping — measured against a real order:
       * `item_subtotal` 129.98, `shipping_subtotal` 4.99, `subtotal` 134.97, `total` 134.97.
       * So a register whose Subtotal column held `subtotal` and whose Shipping column held
       * `shipping_total` invited exactly the addition it was built to prevent: 134.97 + 4.99
       * = 139.96 against a total of 134.97, off by the shipping on every single row.
       *
       * The two `_subtotal` figures are net of tax, which is why `tax_total` is a column of
       * its own and the four add up: items + shipping + tax − discount = total.
       */
      'item_subtotal', 'shipping_subtotal',
      // `.*` throughout: computed and relational fields requested individually resolve as
      // undefined without erroring, which fails as zeros rather than as an error.
      'items.*', 'items.variant.*',
      'shipping_address.*', 'region.*', 'sales_channel.*',
      'payment_collections.*', 'payment_collections.payments.*',
      'fulfillments.*', 'fulfillments.items.*',
      'customer.has_account',
    ],
    pagination: { take: 100000, skip: 0 },
  })

  const since = opts.days ? Date.now() - opts.days * 86400_000 : null
  const inPeriod = (orders as any[]).filter(
    (o) => !since || Date.parse(o.created_at) >= since
  )

  /**
   * Personalisations, one query rather than one per order.
   *
   * Keyed by `order_id` because that is the column the attach step writes — the link to the
   * order line was the gap Step 30 closed, and `order_line_id` is populated going forward but
   * not for anything created before it.
   */
  const catalog: any = container.resolve(CATALOG_MODULE)
  const personalisations = await catalog.listLinePersonalisations({}, { take: 100000 })
  const byOrder = new Map<string, any[]>()
  const byLine = new Map<string, any[]>()
  for (const p of personalisations as any[]) {
    if (p.order_id) {
      const list = byOrder.get(p.order_id) ?? []
      list.push(p)
      byOrder.set(p.order_id, list)
    }
    if (p.order_line_id) {
      const list = byLine.get(p.order_line_id) ?? []
      list.push(p)
      byLine.set(p.order_line_id, list)
    }
  }

  return inPeriod.map((o) => {
    const address = one(o.shipping_address)
    const mine = byOrder.get(o.id) ?? []
    const items: any[] = o.items ?? []

    return {
      id: o.id,
      display_id: String(o.display_id ?? ''),
      created_at: o.created_at,
      status: o.status,
      email: o.email,
      customer_name: fullName(address, o.email),
      customer_id: o.customer_id ?? null,
      has_account: !!one(o.customer)?.has_account,

      currency_code: o.currency_code,
      subtotal: num(o.item_subtotal),
      shipping_total: num(o.shipping_subtotal),
      tax_total: num(o.tax_total),
      discount_total: num(o.discount_total),
      total: num(o.total),

      items: items.reduce((s, i) => s + num(i.quantity), 0),
      lines: items.map((i) => ({
        id: i.id,
        title: i.title ?? i.product_title ?? '',
        variant_title: i.variant_title ?? one(i.variant)?.title ?? null,
        sku: i.variant_sku ?? one(i.variant)?.sku ?? null,
        quantity: num(i.quantity),
        unit_price: num(i.unit_price),
        total: num(i.total),
        personalisation: (byLine.get(i.id) ?? [])
          .map((p: any) => `${p.kind}: ${p.value}`)
          .join('; ') || null,
      })),

      payment: paymentState(o),
      fulfilment: fulfilmentState(o),

      personalisations: mine.length,
      personalisations_pending: mine.filter((p) => p.review_status === 'pending').length,

      region: one(o.region)?.name ?? null,
      sales_channel: one(o.sales_channel)?.name ?? null,
      ship_name: address ? [address.first_name, address.last_name].filter(Boolean).join(' ') : null,
      address_1: address?.address_1 ?? null,
      city: address?.city ?? null,
      province: address?.province ?? null,
      postal_code: address?.postal_code ?? null,
      country_code: address?.country_code ?? null,
      phone: address?.phone ?? null,
    }
  })
}

export type OrderSortKey = 'created_at' | 'total' | 'items' | 'display_id'

export type OrderSelection = {
  q?: string
  payment?: PaymentState
  fulfilment?: FulfilmentState
  /** Only orders carrying a personalisation that has not been approved. */
  needs_approval?: boolean
  sort?: OrderSortKey
  direction?: 'asc' | 'desc'
}

export function filterAndSortOrders(rows: OrderRow[], opts: OrderSelection): OrderRow[] {
  let out = rows

  const q = (opts.q ?? '').trim().toLowerCase()
  if (q) {
    out = out.filter((r) =>
      [r.display_id, r.email, r.customer_name, r.city, r.postal_code, r.phone]
        .some((v) => String(v ?? '').toLowerCase().includes(q)) ||
      // Searching a product title finds the orders containing it, which is how somebody
      // answers "who bought the Vikings shirt we have to recall".
      r.lines.some((l) => `${l.title} ${l.sku ?? ''}`.toLowerCase().includes(q))
    )
  }
  if (opts.payment) out = out.filter((r) => r.payment === opts.payment)
  if (opts.fulfilment) out = out.filter((r) => r.fulfilment === opts.fulfilment)
  if (opts.needs_approval) out = out.filter((r) => r.personalisations_pending > 0)

  const sort = opts.sort ?? 'created_at'
  const dir = opts.direction === 'asc' ? 1 : -1
  const value = (r: OrderRow): number => {
    switch (sort) {
      case 'total': return r.total
      case 'items': return r.items
      case 'display_id': return Number(r.display_id) || 0
      default: return Date.parse(r.created_at)
    }
  }
  return [...out].sort((a, b) => {
    const byValue = (value(a) - value(b)) * dir
    // Two orders can share a `created_at` to the millisecond, and a stable sort then keeps
    // whatever order the query returned. `display_id` is monotonic, so it settles the tie in
    // the only direction that can be right — the same fix the customer list needed.
    return byValue !== 0
      ? byValue
      : (Number(b.display_id) - Number(a.display_id)) * (dir === 1 ? -1 : 1)
  })
}

export function selectOrders(
  rows: OrderRow[],
  opts: OrderSelection & { limit?: number; offset?: number }
): { rows: OrderRow[]; count: number } {
  const matched = filterAndSortOrders(rows, opts)
  const offset = Math.max(0, opts.offset ?? 0)
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  return { rows: matched.slice(offset, offset + limit), count: matched.length }
}

/** Totals for the selection, so the header does not require adding up a page. */
export function summariseOrders(rows: OrderRow[]) {
  const by = <K extends string>(key: (r: OrderRow) => K) => {
    const m: Record<string, number> = {}
    for (const r of rows) m[key(r)] = (m[key(r)] ?? 0) + 1
    return m
  }
  const currencies = new Set(rows.map((r) => r.currency_code))
  return {
    orders: rows.length,
    items: rows.reduce((s, r) => s + r.items, 0),
    // Same rule as the customer list: a total across currencies is a wrong number, not a
    // rounded one, so it is withheld rather than fabricated.
    revenue: currencies.size > 1
      ? null
      : Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100,
    currency_code: currencies.size === 1 ? [...currencies][0] : null,
    needs_approval: rows.filter((r) => r.personalisations_pending > 0).length,
    by_payment: by((r) => r.payment),
    by_fulfilment: by((r) => r.fulfilment),
  }
}

/**
 * One row per order — the register. What a bookkeeper reconciles a month against, which is
 * why the money is broken out rather than collapsed into a total.
 */
export const ORDER_COLUMNS: Column<OrderRow>[] = [
  { label: 'Order', value: (r) => r.display_id },
  { label: 'Placed', value: (r) => csvDateTime(r.created_at) },
  { label: 'Status', value: (r) => r.status },
  { label: 'Payment', value: (r) => r.payment },
  { label: 'Fulfilment', value: (r) => r.fulfilment },
  { label: 'Customer', value: (r) => r.customer_name },
  { label: 'Email', value: (r) => r.email },
  { label: 'Has account', value: (r) => yesNo(r.has_account) },
  { label: 'Items', value: (r) => r.items },
  { label: 'Currency', value: (r) => r.currency_code },
  { label: 'Subtotal', value: (r) => csvMoney(r.subtotal) },
  { label: 'Discount', value: (r) => csvMoney(r.discount_total) },
  { label: 'Shipping', value: (r) => csvMoney(r.shipping_total) },
  { label: 'Tax', value: (r) => csvMoney(r.tax_total) },
  { label: 'Total', value: (r) => csvMoney(r.total) },
  { label: 'Personalisations', value: (r) => r.personalisations },
  { label: 'Awaiting approval', value: (r) => r.personalisations_pending },
  { label: 'Region', value: (r) => r.region },
  { label: 'Ship to', value: (r) => r.ship_name },
  { label: 'Address', value: (r) => r.address_1 },
  { label: 'City', value: (r) => r.city },
  { label: 'Province', value: (r) => r.province },
  { label: 'Postal code', value: (r) => r.postal_code },
  { label: 'Country', value: (r) => r.country_code },
  { label: 'Phone', value: (r) => r.phone },
]

/**
 * One row per line — what a shop picks and packs from, and what Shopify's own order export
 * produces.
 *
 * Both shapes exist because they answer different questions and neither substitutes for the
 * other: the register cannot tell you what to put in a box, and the line file cannot be
 * summed for a month without double-counting the shipping on every row. The order-level
 * money columns are therefore **not** repeated here.
 */
export const LINE_COLUMNS: Column<{ order: OrderRow; line: OrderLine }>[] = [
  { label: 'Order', value: (r) => r.order.display_id },
  { label: 'Placed', value: (r) => csvDateTime(r.order.created_at) },
  { label: 'Payment', value: (r) => r.order.payment },
  { label: 'Fulfilment', value: (r) => r.order.fulfilment },
  { label: 'Customer', value: (r) => r.order.customer_name },
  { label: 'Email', value: (r) => r.order.email },
  { label: 'Product', value: (r) => r.line.title },
  { label: 'Variant', value: (r) => r.line.variant_title },
  { label: 'SKU', value: (r) => r.line.sku },
  { label: 'Quantity', value: (r) => r.line.quantity },
  { label: 'Currency', value: (r) => r.order.currency_code },
  { label: 'Unit price', value: (r) => csvMoney(r.line.unit_price) },
  { label: 'Line total', value: (r) => csvMoney(r.line.total) },
  // The thing that gets printed, on the row it gets printed on. A picker with the register
  // alone has to open every order to find out.
  { label: 'Personalisation', value: (r) => r.line.personalisation },
  { label: 'Ship to', value: (r) => r.order.ship_name },
  { label: 'Address', value: (r) => r.order.address_1 },
  { label: 'City', value: (r) => r.order.city },
  { label: 'Province', value: (r) => r.order.province },
  { label: 'Postal code', value: (r) => r.order.postal_code },
  { label: 'Country', value: (r) => r.order.country_code },
  { label: 'Phone', value: (r) => r.order.phone },
]

export const toOrderCsv = (rows: OrderRow[]) => toCsvFile(ORDER_COLUMNS, rows)

export const toLineCsv = (rows: OrderRow[]) =>
  toCsvFile(
    LINE_COLUMNS,
    rows.flatMap((order) => order.lines.map((line) => ({ order, line })))
  )
