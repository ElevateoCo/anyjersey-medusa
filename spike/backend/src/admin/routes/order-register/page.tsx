import { defineRouteConfig } from '@medusajs/admin-sdk'
import { ReceiptPercent } from '@medusajs/icons'
import {
  Badge, Button, Container, Heading, Input, Select, Table, Text, toast,
} from '@medusajs/ui'
import { useEffect, useMemo, useState } from 'react'

/**
 * The order register.
 *
 * Labelled "Order register" rather than "Orders" on purpose: Medusa's own orders screen is
 * still there and is still where you go to *work* an order. This is the other question — show
 * me every order in a period, with the money broken out and the things that stop one shipping
 * visible — and having two sidebar items both called Orders would be worse than either.
 *
 * Three things it is built around:
 *
 *  - **Personalisation is a first-class column.** It is the only thing in this shop that stops
 *    an otherwise-paid, in-stock order from shipping, and a shirt printed with the wrong name
 *    is a total loss rather than a restock (§12.4). "Awaiting approval" is a filter, not a
 *    detail you find by opening orders one at a time.
 *  - **The totals describe the selection.** Filter to unfulfilled and the header tells you
 *    what unfulfilled is worth. Answering with the month's revenue would be answering a
 *    different question.
 *  - **Two exports, because they are two files.** The register reconciles a month; the line
 *    file picks and packs. Neither substitutes for the other, and summing the line file
 *    double-counts the shipping on every row.
 */
type Line = {
  id: string
  title: string
  variant_title: string | null
  sku: string | null
  quantity: number
  personalisation: string | null
}

type Order = {
  id: string
  display_id: string
  created_at: string
  status: string
  email: string
  customer_name: string
  has_account: boolean
  currency_code: string
  subtotal: number
  shipping_total: number
  tax_total: number
  discount_total: number
  total: number
  items: number
  lines: Line[]
  payment: string
  fulfilment: string
  personalisations: number
  personalisations_pending: number
  region: string | null
  city: string | null
  province: string | null
  country_code: string | null
}

type Payload = {
  orders: Order[]
  count: number
  summary: {
    orders: number
    items: number
    revenue: number | null
    currency_code: string | null
    needs_approval: number
    by_payment: Record<string, number>
    by_fulfilment: Record<string, number>
  }
}

const PAYMENT_LABEL: Record<string, string> = {
  not_paid: 'Not paid', authorized: 'Authorised', partially_authorized: 'Part authorised',
  paid: 'Paid', refunded: 'Refunded', canceled: 'Cancelled',
}
const PAYMENT_COLOUR: Record<string, 'green' | 'orange' | 'red' | 'blue' | 'grey'> = {
  not_paid: 'orange', authorized: 'blue', partially_authorized: 'orange',
  paid: 'green', refunded: 'grey', canceled: 'red',
}

const FULFIL_LABEL: Record<string, string> = {
  unfulfilled: 'Unfulfilled', partially_fulfilled: 'Part packed', fulfilled: 'Packed',
  shipped: 'Shipped', delivered: 'Delivered', canceled: 'Cancelled',
}
const FULFIL_COLOUR: Record<string, 'green' | 'orange' | 'red' | 'blue' | 'grey'> = {
  unfulfilled: 'orange', partially_fulfilled: 'orange', fulfilled: 'blue',
  shipped: 'blue', delivered: 'green', canceled: 'red',
}

const PAGE = 25

const money = (amount: number | null, currency: string | null) => {
  if (amount === null) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: currency ?? 'USD',
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ''}`.trim()
  }
}

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

const place = (o: Order) =>
  [o.city, o.province, o.country_code?.toUpperCase()].filter(Boolean).join(', ') || '—'

type Sort = 'created_at' | 'total' | 'items' | 'display_id'

const OrderRegisterPage = () => {
  const [data, setData] = useState<Payload | null>(null)
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [days, setDays] = useState('30')
  const [payment, setPayment] = useState('all')
  const [fulfilment, setFulfilment] = useState('all')
  const [needsApproval, setNeedsApproval] = useState(false)
  const [sort, setSort] = useState<Sort>('created_at')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const [offset, setOffset] = useState(0)
  const [exporting, setExporting] = useState('')

  // Debounced: the endpoint assembles every order in the period on each call, so a request
  // per keystroke would make typing an order number the most expensive thing in the admin.
  useEffect(() => {
    const t = setTimeout(() => { setTerm(q); setOffset(0) }, 300)
    return () => clearTimeout(t)
  }, [q])

  const filters = useMemo(() => {
    const p = new URLSearchParams({ sort, direction })
    if (days !== 'all') p.set('days', days)
    if (term) p.set('q', term)
    if (payment !== 'all') p.set('payment', payment)
    if (fulfilment !== 'all') p.set('fulfilment', fulfilment)
    if (needsApproval) p.set('needs_approval', 'true')
    return p
  }, [term, days, payment, fulfilment, needsApproval, sort, direction])

  const params = useMemo(() => {
    const p = new URLSearchParams(filters)
    p.set('limit', String(PAGE))
    p.set('offset', String(offset))
    return p
  }, [filters, offset])

  useEffect(() => {
    fetch(`/admin/order-list?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => toast.error('Could not load the order register'))
  }, [params])

  /**
   * Fetched rather than linked.
   *
   * A plain `<a download>` would send the session cookie and work — right up until an account
   * without `privacy:read` clicks it, at which point the browser downloads a file containing
   * a JSON authorisation error and calls it orders.csv.
   */
  async function exportCsv(rows: 'orders' | 'items') {
    setExporting(rows)
    try {
      const p = new URLSearchParams(filters)
      p.set('rows', rows)
      const res = await fetch(`/admin/order-list/export?${p}`, { credentials: 'include' })
      if (!res.ok) {
        toast.error(
          res.status === 403
            ? 'Exporting orders is restricted to the shop owner.'
            : 'The export failed.'
        )
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('content-disposition')?.match(/filename="(.+?)"/)?.[1]
        ?? `orders-${rows}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(rows === 'items' ? 'Line items exported' : 'Order register exported')
    } catch {
      toast.error('The export failed.')
    } finally {
      setExporting('')
    }
  }

  const sortBy = (key: Sort) => {
    if (sort === key) setDirection((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSort(key); setDirection('desc') }
    setOffset(0)
  }

  const Th = ({ label, sortKey }: { label: string; sortKey?: Sort }) => (
    <Table.HeaderCell>
      {sortKey ? (
        <button
          type="button"
          onClick={() => sortBy(sortKey)}
          className="txt-compact-small-plus hover:text-ui-fg-base"
          style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
        >
          {label}
          {sort === sortKey && <span aria-hidden>{direction === 'desc' ? '↓' : '↑'}</span>}
        </button>
      ) : label}
    </Table.HeaderCell>
  )

  const rows = data?.orders ?? []
  const count = data?.count ?? 0
  const s = data?.summary

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div>
          <Heading level="h2">Order register</Heading>
          {s && (
            <Text size="small" className="text-ui-fg-subtle">
              {s.orders} order{s.orders === 1 ? '' : 's'} · {s.items} item
              {s.items === 1 ? '' : 's'} · {money(s.revenue, s.currency_code)}
              {s.needs_approval > 0 && ` · ${s.needs_approval} awaiting approval`}
            </Text>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary" disabled={!!exporting || !count}
            onClick={() => exportCsv('orders')}
          >
            {exporting === 'orders' ? 'Exporting…' : `Export ${count} orders`}
          </Button>
          <Button
            variant="secondary" disabled={!!exporting || !count}
            onClick={() => exportCsv('items')}
          >
            {exporting === 'items' ? 'Exporting…' : 'Export line items'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 px-6 py-3">
        <Input
          placeholder="Search order number, email, name, city, product"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 300, flex: 1 }}
        />
        <Select value={days} onValueChange={(v) => { setDays(v); setOffset(0) }}>
          <Select.Trigger style={{ minWidth: 140 }}>
            <Select.Value placeholder="Period" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="7">Last 7 days</Select.Item>
            <Select.Item value="30">Last 30 days</Select.Item>
            <Select.Item value="90">Last 90 days</Select.Item>
            <Select.Item value="365">Last year</Select.Item>
            <Select.Item value="all">All time</Select.Item>
          </Select.Content>
        </Select>
        <Select value={payment} onValueChange={(v) => { setPayment(v); setOffset(0) }}>
          <Select.Trigger style={{ minWidth: 150 }}>
            <Select.Value placeholder="Payment" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">Any payment</Select.Item>
            {Object.entries(PAYMENT_LABEL).map(([k, v]) => (
              <Select.Item key={k} value={k}>{v}</Select.Item>
            ))}
          </Select.Content>
        </Select>
        <Select value={fulfilment} onValueChange={(v) => { setFulfilment(v); setOffset(0) }}>
          <Select.Trigger style={{ minWidth: 150 }}>
            <Select.Value placeholder="Fulfilment" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">Any fulfilment</Select.Item>
            {Object.entries(FULFIL_LABEL).map(([k, v]) => (
              <Select.Item key={k} value={k}>{v}</Select.Item>
            ))}
          </Select.Content>
        </Select>
        <Button
          variant={needsApproval ? 'primary' : 'secondary'}
          onClick={() => { setNeedsApproval((v) => !v); setOffset(0) }}
        >
          Awaiting approval{s ? ` (${s.needs_approval})` : ''}
        </Button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <Table>
          <Table.Header>
            <Table.Row>
              <Th label="Order" sortKey="display_id" />
              <Th label="Placed" sortKey="created_at" />
              <Th label="Customer" />
              <Th label="Items" sortKey="items" />
              <Th label="Total" sortKey="total" />
              <Th label="Payment" />
              <Th label="Fulfilment" />
              <Th label="Printing" />
              <Th label="Destination" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 && (
              <Table.Row>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-subtle">
                    {data ? 'No orders match that.' : 'Loading…'}
                  </Text>
                </Table.Cell>
              </Table.Row>
            )}
            {rows.map((o) => (
              <Table.Row key={o.id}>
                <Table.Cell>
                  {/* Medusa's own order page, which is where an order is actually worked. */}
                  <a href={`/app/orders/${o.id}`} className="txt-compact-small-plus">
                    #{o.display_id}
                  </a>
                </Table.Cell>
                <Table.Cell><Text size="small">{when(o.created_at)}</Text></Table.Cell>
                <Table.Cell>
                  <Text size="small">{o.customer_name}</Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">{o.email}</Text>
                </Table.Cell>
                <Table.Cell><Text size="small">{o.items}</Text></Table.Cell>
                <Table.Cell>
                  <Text size="small">{money(o.total, o.currency_code)}</Text>
                  {o.discount_total > 0 && (
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      −{money(o.discount_total, o.currency_code)} discount
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Badge size="2xsmall" color={PAYMENT_COLOUR[o.payment] ?? 'grey'}>
                    {PAYMENT_LABEL[o.payment] ?? o.payment}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <Badge size="2xsmall" color={FULFIL_COLOUR[o.fulfilment] ?? 'grey'}>
                    {FULFIL_LABEL[o.fulfilment] ?? o.fulfilment}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  {o.personalisations === 0 ? (
                    <Text size="small" className="text-ui-fg-subtle">—</Text>
                  ) : o.personalisations_pending > 0 ? (
                    <Badge size="2xsmall" color="orange">
                      {o.personalisations_pending} to approve
                    </Badge>
                  ) : (
                    <Badge size="2xsmall" color="green">
                      {o.personalisations} approved
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell><Text size="small">{place(o)}</Text></Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>

      <div className="flex items-center justify-between px-6 py-3">
        <Text size="small" className="text-ui-fg-subtle">
          {count === 0
            ? 'No results'
            : `${offset + 1}–${Math.min(offset + PAGE, count)} of ${count}`}
        </Text>
        <div className="flex gap-2">
          <Button
            size="small" variant="secondary" disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
          >
            Previous
          </Button>
          <Button
            size="small" variant="secondary" disabled={offset + PAGE >= count}
            onClick={() => setOffset((o) => o + PAGE)}
          >
            Next
          </Button>
        </div>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: 'Order register',
  icon: ReceiptPercent,
})

export default OrderRegisterPage
