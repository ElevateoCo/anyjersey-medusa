import {
  fulfilmentState, paymentState, filterAndSortOrders, selectOrders, summariseOrders,
  toLineCsv, toOrderCsv, LINE_COLUMNS, ORDER_COLUMNS,
  type OrderLine, type OrderRow,
} from '../orders'

/**
 * The register's pure half.
 *
 * `orders.spec.ts` proves the fields resolve out of a real database. This proves the
 * branches, including the ones an integration suite cannot reach: a refund needs a captured
 * payment to reverse and there is no Stripe key here, and a second currency is not something
 * to introduce into a shop that has one just to test a guard.
 */
const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: 'ordli_1',
  title: 'Buffalo Bills Josh Allen Blue Jersey',
  variant_title: 'L',
  sku: 'AJ-M09FD-L',
  quantity: 1,
  unit_price: 64.99,
  total: 64.99,
  personalisation: null,
  ...over,
})

const row = (over: Partial<OrderRow> = {}): OrderRow => ({
  id: 'order_1',
  display_id: '11247',
  created_at: '2026-02-01T00:00:00.000Z',
  status: 'pending',
  email: 'norby@example.com',
  customer_name: 'Norby Krenik',
  customer_id: null,
  has_account: false,
  currency_code: 'usd',
  subtotal: 64.99,
  shipping_total: 4.99,
  tax_total: 0,
  discount_total: 0,
  total: 69.98,
  items: 1,
  lines: [line()],
  payment: 'authorized',
  fulfilment: 'unfulfilled',
  personalisations: 0,
  personalisations_pending: 0,
  region: 'United States',
  sales_channel: 'Default',
  ship_name: 'Norby Krenik',
  address_1: '17 Nokomis Ave',
  city: 'Lake Hiawatha',
  province: 'New Jersey',
  postal_code: '07034',
  country_code: 'us',
  phone: '+1 718 902 1256',
  ...over,
})

describe('paymentState', () => {
  it('is not_paid with no collection at all', () => {
    expect(paymentState({})).toBe('not_paid')
    expect(paymentState({ payment_collections: [] })).toBe('not_paid')
  })

  it('reads the strongest state present, not the first', () => {
    // A later capture creates a second collection, and the order is paid the moment one of
    // them completes. Reading collection[0] would report the wrong thing for a week.
    expect(paymentState({
      payment_collections: [{ status: 'not_paid' }, { status: 'completed' }],
    })).toBe('paid')

    expect(paymentState({
      payment_collections: [{ status: 'authorized' }, { status: 'not_paid' }],
    })).toBe('authorized')
  })

  it('distinguishes a partial authorisation from a whole one', () => {
    expect(paymentState({ payment_collections: [{ status: 'partially_authorized' }] }))
      .toBe('partially_authorized')
  })

  it('is canceled only when every collection is', () => {
    expect(paymentState({ payment_collections: [{ status: 'canceled' }] })).toBe('canceled')
    // One live collection means money can still move, so this is not a cancelled order.
    expect(paymentState({
      payment_collections: [{ status: 'canceled' }, { status: 'authorized' }],
    })).toBe('authorized')
  })

  describe('refunds', () => {
    /**
     * The regression this file was written for.
     *
     * These amounts used to be summed off each *payment*, and `payment` has no
     * `captured_amount` or `refunded_amount` column — on the Payment model both are
     * computed from the `captures` and `refunds` relations, so neither arrives through
     * `query.graph` even under `.*`. Both sums were always 0, the branch below was
     * unreachable, and a fully refunded order reported as `paid` on the screen a bookkeeper
     * reconciles from. They now come off the collection, where they are stored columns.
     */
    it('reports a fully refunded order as refunded, not as paid', () => {
      expect(paymentState({
        payment_collections: [
          { status: 'completed', captured_amount: 69.98, refunded_amount: 69.98 },
        ],
      })).toBe('refunded')
    })

    it('leaves a partial refund as paid, because the order still holds money', () => {
      expect(paymentState({
        payment_collections: [
          { status: 'completed', captured_amount: 69.98, refunded_amount: 10 },
        ],
      })).toBe('paid')
    })

    it('ignores a refund with nothing captured behind it', () => {
      // Defensive: a refund exceeding a capture of zero is not a refunded order, it is bad
      // data, and `refunded` would send somebody looking for money that never moved.
      expect(paymentState({
        payment_collections: [{ status: 'authorized', captured_amount: 0, refunded_amount: 5 }],
      })).toBe('authorized')
    })

    it('sums across collections before deciding', () => {
      expect(paymentState({
        payment_collections: [
          { status: 'completed', captured_amount: 40, refunded_amount: 40 },
          { status: 'completed', captured_amount: 30, refunded_amount: 30 },
        ],
      })).toBe('refunded')
    })

    it('copes with the numeric column arriving as a string', () => {
      // Postgres `numeric` comes back as a string through some paths, and '69.98' > 0 is
      // true while Number('69.98') is what has to be compared.
      expect(paymentState({
        payment_collections: [
          { status: 'completed', captured_amount: '69.98', refunded_amount: '69.98' },
        ],
      })).toBe('refunded')
    })
  })
})

describe('fulfilmentState', () => {
  it('is unfulfilled with no fulfilment', () => {
    expect(fulfilmentState({ items: [{ quantity: 1 }] })).toBe('unfulfilled')
  })

  it('is canceled when the only fulfilment was cancelled', () => {
    expect(fulfilmentState({
      fulfillments: [{ canceled_at: '2026-02-02T00:00:00.000Z' }],
      items: [{ quantity: 1 }],
    })).toBe('canceled')
  })

  it('ignores a cancelled fulfilment when a live one exists', () => {
    expect(fulfilmentState({
      fulfillments: [
        { canceled_at: '2026-02-02T00:00:00.000Z' },
        { items: [{ quantity: 1 }] },
      ],
      items: [{ quantity: 1 }],
    })).toBe('fulfilled')
  })

  it('is partially_fulfilled when some of the order is packed', () => {
    expect(fulfilmentState({
      fulfillments: [{ items: [{ quantity: 1 }] }],
      items: [{ quantity: 3 }],
    })).toBe('partially_fulfilled')
  })

  it('is fulfilled when everything is packed but nothing has left', () => {
    expect(fulfilmentState({
      fulfillments: [{ items: [{ quantity: 3 }] }],
      items: [{ quantity: 3 }],
    })).toBe('fulfilled')
  })

  it('is shipped once any parcel has left', () => {
    expect(fulfilmentState({
      fulfillments: [
        { shipped_at: '2026-02-03T00:00:00.000Z', items: [{ quantity: 1 }] },
        { items: [{ quantity: 2 }] },
      ],
      items: [{ quantity: 3 }],
    })).toBe('shipped')
  })

  it('reports delivered only when every live parcel has arrived', () => {
    // Deliberately stricter than the reverse: a partly delivered order is still in motion,
    // and calling it delivered closes a case that is open.
    const delivered = { delivered_at: '2026-02-05T00:00:00.000Z', items: [{ quantity: 1 }] }
    expect(fulfilmentState({ fulfillments: [delivered], items: [{ quantity: 1 }] }))
      .toBe('delivered')

    expect(fulfilmentState({
      fulfillments: [delivered, { shipped_at: '2026-02-04T00:00:00.000Z', items: [{ quantity: 1 }] }],
      items: [{ quantity: 2 }],
    })).toBe('shipped')
  })
})

describe('filterAndSortOrders', () => {
  const bills = row({ id: 'a', display_id: '1', total: 69.98 })
  const jets = row({
    id: 'b', display_id: '2', total: 200, email: 'other@example.com',
    customer_name: 'Ada Lovelace', city: 'Dallas', postal_code: '75201',
    lines: [line({ title: 'New York Jets Home Jersey', sku: 'AJ-JETS-M' })],
    payment: 'paid', fulfilment: 'shipped', personalisations: 2, personalisations_pending: 1,
  })
  const all = [bills, jets]

  it('searches the order number, the person and where it is going', () => {
    expect(filterAndSortOrders(all, { q: '75201' }).map((r) => r.id)).toEqual(['b'])
    expect(filterAndSortOrders(all, { q: 'lovelace' }).map((r) => r.id)).toEqual(['b'])
    expect(filterAndSortOrders(all, { q: 'norby' }).map((r) => r.id)).toEqual(['a'])
  })

  it('searches the products in the order', () => {
    // "Who bought the shirt we have to recall" is the question this answers.
    expect(filterAndSortOrders(all, { q: 'jets' }).map((r) => r.id)).toEqual(['b'])
    expect(filterAndSortOrders(all, { q: 'AJ-JETS-M' }).map((r) => r.id)).toEqual(['b'])
  })

  it('filters on payment and on fulfilment', () => {
    expect(filterAndSortOrders(all, { payment: 'paid' }).map((r) => r.id)).toEqual(['b'])
    expect(filterAndSortOrders(all, { fulfilment: 'unfulfilled' }).map((r) => r.id))
      .toEqual(['a'])
  })

  it('filters to what cannot be printed yet', () => {
    expect(filterAndSortOrders(all, { needs_approval: true }).map((r) => r.id)).toEqual(['b'])
  })

  it('sorts newest first by default', () => {
    const old = row({ id: 'old', display_id: '0', created_at: '2025-01-01T00:00:00.000Z' })
    expect(filterAndSortOrders([old, bills], {}).map((r) => r.id)).toEqual(['a', 'old'])
  })

  it('sorts by total and by item count when asked', () => {
    expect(filterAndSortOrders(all, { sort: 'total' }).map((r) => r.id)).toEqual(['b', 'a'])
    expect(filterAndSortOrders(all, { sort: 'total', direction: 'asc' }).map((r) => r.id))
      .toEqual(['a', 'b'])
  })

  it('settles a tied timestamp on the order number', () => {
    // Two orders can share a created_at to the millisecond, and a stable sort then returns
    // whatever the query happened to give. display_id is monotonic, so it is the only tie
    // break that can be right.
    const a = row({ id: 'first', display_id: '10', created_at: '2026-02-01T00:00:00.000Z' })
    const b = row({ id: 'second', display_id: '11', created_at: '2026-02-01T00:00:00.000Z' })
    expect(filterAndSortOrders([a, b], {}).map((r) => r.id)).toEqual(['second', 'first'])
    expect(filterAndSortOrders([b, a], {}).map((r) => r.id)).toEqual(['second', 'first'])
  })

  it('does not mutate what it was given', () => {
    const input = [jets, bills]
    filterAndSortOrders(input, { sort: 'total' })
    expect(input.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('selectOrders', () => {
  const many = Array.from({ length: 120 }, (_, i) =>
    row({ id: `o${i}`, display_id: String(1000 + i), total: i }))

  it('reports the size of the selection, not of the page', () => {
    const page = selectOrders(many, { limit: 10 })
    expect(page.rows).toHaveLength(10)
    expect(page.count).toBe(120)
  })

  it('clamps a limit somebody would use to pull the whole table', () => {
    expect(selectOrders(many, { limit: 5000 }).rows).toHaveLength(120)
  })

  it('clamps a zero limit down to one row, not up to everything', () => {
    // Deliberately the timid direction. In plenty of APIs `limit=0` means "no limit", and
    // reading it that way here would turn a typo into a full table dump of every customer
    // address. The route never passes 0 anyway — `Number(req.query.limit ?? 50) || 50`
    // turns it into the default before it gets here — so this is the second line of it.
    expect(selectOrders(many, { limit: 0 }).rows).toHaveLength(1)
  })

  it('pages without dropping or repeating a row', () => {
    const first = selectOrders(many, { limit: 50, offset: 0 }).rows.map((r) => r.id)
    const second = selectOrders(many, { limit: 50, offset: 50 }).rows.map((r) => r.id)
    expect(new Set([...first, ...second]).size).toBe(100)
  })
})

describe('summariseOrders', () => {
  it('totals the selection and counts the states in it', () => {
    const rows = [
      row({ total: 69.98, items: 1, payment: 'paid' }),
      row({ total: 30.02, items: 2, payment: 'authorized', personalisations_pending: 1 }),
    ]
    const s = summariseOrders(rows)

    expect(s.orders).toBe(2)
    expect(s.items).toBe(3)
    expect(s.revenue).toBe(100)
    expect(s.currency_code).toBe('usd')
    expect(s.needs_approval).toBe(1)
    expect(s.by_payment).toEqual({ paid: 1, authorized: 1 })
  })

  it('withholds a revenue total across currencies rather than adding them up', () => {
    // A number that is wrong rather than rounded. The screen shows a dash instead.
    const s = summariseOrders([row(), row({ currency_code: 'eur' })])
    expect(s.revenue).toBeNull()
    expect(s.currency_code).toBeNull()
  })

  it('is zero-safe on an empty selection', () => {
    const s = summariseOrders([])
    expect(s).toMatchObject({ orders: 0, items: 0, revenue: 0, needs_approval: 0 })
  })
})

describe('the two CSV shapes', () => {
  it('gives the register one row per order', () => {
    const csv = toOrderCsv([row({ lines: [line(), line({ id: 'ordli_2' })] })])
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(2)
  })

  it('gives the line file one row per line', () => {
    const csv = toLineCsv([row({ lines: [line(), line({ id: 'ordli_2' })] })])
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3)
  })

  it('keeps the order-level money out of the line file', () => {
    // Summing a line file that repeated shipping on every row double-counts it on every
    // row. The two files are not substitutes and the columns say so.
    const labels = LINE_COLUMNS.map((c) => c.label)
    for (const money of ['Subtotal', 'Shipping', 'Tax', 'Discount', 'Total']) {
      expect(labels).not.toContain(money)
    }
    expect(labels).toContain('Line total')
    expect(ORDER_COLUMNS.map((c) => c.label)).toContain('Subtotal')
  })

  it('puts the personalisation on the line that gets printed', () => {
    const csv = toLineCsv([row({
      lines: [line({ personalisation: 'name: Allen; number: 17' })],
    })])
    expect(csv).toContain('name: Allen; number: 17')
  })

  it('escapes a delivery name that would execute in a spreadsheet', () => {
    const csv = toOrderCsv([row({ customer_name: '=HYPERLINK("http://evil","click")' })])
    for (const cell of csv.split('\r\n').slice(1).flatMap((l) => l.split(','))) {
      expect(cell.replace(/^"?﻿?"?/, '').replace(/^"/, '').startsWith('=')).toBe(false)
    }
  })
})
