import { defineRouteConfig } from '@medusajs/admin-sdk'
import { Users } from '@medusajs/icons'
import {
  Badge, Button, Container, Heading, Input, Select, Table, Text, toast,
} from '@medusajs/ui'
import { useEffect, useMemo, useState } from 'react'

/**
 * Customers.
 *
 * Medusa's own customers screen lists the `customer` table. Everything an operator opens a
 * customer *for* — how much they have spent, how many orders, when they first bought, whether
 * they may be marketed to — lives in three other modules and is on none of it. This is that
 * screen, at `/admin/customer-list` so Medusa's keeps working.
 *
 * Three things it is built around:
 *
 *  - **Guests are customers.** The shop has no account requirement (§12.1), so filtering to
 *    real accounts would hide almost every buyer. Both are listed, with the distinction on
 *    the row — there is no password to reset on an account that does not exist.
 *  - **Marketing has three states, not two.** `subscribed` is consent, `implied` is the PECR
 *    soft opt-in a checkout creates (cart-recovery email only), `unsubscribed` is a refusal
 *    that covers every commercial message. Collapsing those into a checkbox is how somebody
 *    ends up mailing a person who opted out.
 *  - **The export is a different act from the list, and says so.** It is owner-only, it is
 *    logged, and it exports *what is on screen* rather than everything — so narrowing the
 *    filters narrows the file. The button says how many rows it will take.
 */
type Customer = {
  id: string
  email: string
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
  marketing: 'subscribed' | 'implied' | 'unsubscribed'
  address_1: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  country_code: string | null
}

type Payload = {
  customers: Customer[]
  count: number
  summary: {
    total: number
    with_account: number
    subscribed: number
    unsubscribed: number
    unattributed_orders: number
  }
}

const MARKETING_LABEL = {
  subscribed: 'Subscribed',
  implied: 'Soft opt-in',
  unsubscribed: 'Unsubscribed',
} as const

const MARKETING_COLOUR = {
  subscribed: 'green',
  implied: 'grey',
  unsubscribed: 'red',
} as const

const PAGE = 25

const money = (amount: number | null, currency: string | null) => {
  if (amount === null) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ''}`.trim()
  }
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  }) : '—'

const place = (c: Customer) =>
  [c.city, c.province, c.country_code?.toUpperCase()].filter(Boolean).join(', ') || '—'

type Sort = 'created_at' | 'amount_spent' | 'orders' | 'last_order_at' | 'name'

const CustomersPage = () => {
  const [data, setData] = useState<Payload | null>(null)
  const [q, setQ] = useState('')
  const [marketing, setMarketing] = useState('all')
  const [account, setAccount] = useState('all')
  const [sort, setSort] = useState<Sort>('created_at')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const [offset, setOffset] = useState(0)
  const [exporting, setExporting] = useState(false)

  // Debounced, because the endpoint aggregates every order on each call and a keystroke per
  // request would make typing a name the most expensive thing in the admin.
  const [term, setTerm] = useState('')
  useEffect(() => {
    const t = setTimeout(() => { setTerm(q); setOffset(0) }, 300)
    return () => clearTimeout(t)
  }, [q])

  const params = useMemo(() => {
    const p = new URLSearchParams({
      sort, direction, limit: String(PAGE), offset: String(offset),
    })
    if (term) p.set('q', term)
    if (marketing !== 'all') p.set('marketing', marketing)
    if (account !== 'all') p.set('account', account)
    return p
  }, [term, marketing, account, sort, direction, offset])

  useEffect(() => {
    fetch(`/admin/customer-list?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => toast.error('Could not load customers'))
  }, [params])

  /**
   * Fetched rather than linked.
   *
   * A plain `<a download>` would send the session cookie and work — right up until an
   * account without `privacy:read` clicks it, at which point the browser downloads a file
   * containing a JSON authorisation error and calls it customers.csv. Fetching lets a refusal
   * be a refusal.
   */
  async function exportCsv() {
    setExporting(true)
    try {
      const p = new URLSearchParams(params)
      p.delete('limit')
      p.delete('offset')
      const res = await fetch(`/admin/customer-list/export?${p}`, { credentials: 'include' })
      if (!res.ok) {
        toast.error(
          res.status === 403
            ? 'Exporting customer data is restricted to the shop owner.'
            : 'The export failed.'
        )
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('content-disposition')?.match(/filename="(.+?)"/)?.[1]
        ?? 'customers.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${data?.count ?? 0} customers`)
    } catch {
      toast.error('The export failed.')
    } finally {
      setExporting(false)
    }
  }

  const sortBy = (key: Sort) => {
    if (sort === key) setDirection((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSort(key); setDirection(key === 'name' ? 'asc' : 'desc') }
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

  const rows = data?.customers ?? []
  const count = data?.count ?? 0

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div>
          <Heading level="h2">Customers</Heading>
          {data && (
            <Text size="small" className="text-ui-fg-subtle">
              {data.summary.total} total · {data.summary.with_account} with an account ·{' '}
              {data.summary.subscribed} subscribed · {data.summary.unsubscribed} unsubscribed
            </Text>
          )}
        </div>
        <Button
          variant="secondary"
          onClick={exportCsv}
          disabled={exporting || !count}
        >
          {exporting ? 'Exporting…' : `Export ${count} to CSV`}
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 px-6 py-3">
        <Input
          placeholder="Search name, email, phone, city, order number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 320, flex: 1 }}
        />
        <Select value={marketing} onValueChange={(v) => { setMarketing(v); setOffset(0) }}>
          <Select.Trigger style={{ minWidth: 170 }}>
            <Select.Value placeholder="Marketing" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">All marketing</Select.Item>
            <Select.Item value="subscribed">Subscribed</Select.Item>
            <Select.Item value="implied">Soft opt-in</Select.Item>
            <Select.Item value="unsubscribed">Unsubscribed</Select.Item>
          </Select.Content>
        </Select>
        <Select value={account} onValueChange={(v) => { setAccount(v); setOffset(0) }}>
          <Select.Trigger style={{ minWidth: 150 }}>
            <Select.Value placeholder="Account" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">Everyone</Select.Item>
            <Select.Item value="account">Has an account</Select.Item>
            <Select.Item value="guest">Guest checkout</Select.Item>
          </Select.Content>
        </Select>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <Table>
          <Table.Header>
            <Table.Row>
              <Th label="Customer" sortKey="name" />
              <Th label="Location" />
              <Th label="Orders" sortKey="orders" />
              <Th label="Spent" sortKey="amount_spent" />
              <Th label="Last order" sortKey="last_order_at" />
              <Th label="Since" sortKey="created_at" />
              <Th label="Marketing" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 && (
              // No `colSpan`: Medusa's Table.Cell does not accept it, and adding it made
              // the admin bundle build fine and the type check fail — the admin is compiled
              // by Vite without type checking, so `tsc` is the only thing that sees this.
              <Table.Row>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-subtle">
                    {data ? 'No customers match that.' : 'Loading…'}
                  </Text>
                </Table.Cell>
              </Table.Row>
            )}
            {rows.map((c) => (
              <Table.Row key={c.id}>
                <Table.Cell>
                  <div>
                    {/* Medusa's own detail page, which this screen deliberately does not
                        duplicate — it is a good page, it just has no numbers on it. */}
                    <a href={`/app/customers/${c.id}`} className="txt-compact-small-plus">
                      {c.name}
                    </a>
                    {!c.has_account && (
                      <Badge size="2xsmall" color="grey" className="ml-2">Guest</Badge>
                    )}
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {c.email}{c.phone ? ` · ${c.phone}` : ''}
                    </Text>
                  </div>
                </Table.Cell>
                <Table.Cell><Text size="small">{place(c)}</Text></Table.Cell>
                <Table.Cell><Text size="small">{c.orders}</Text></Table.Cell>
                <Table.Cell>
                  <Text size="small">
                    {money(c.amount_spent, c.currency_code)}
                    {c.mixed_currency && (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        mixed currencies
                      </Text>
                    )}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small">
                    {day(c.last_order_at)}
                    {c.last_order_display_id && (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        #{c.last_order_display_id}
                      </Text>
                    )}
                  </Text>
                </Table.Cell>
                <Table.Cell><Text size="small">{day(c.created_at)}</Text></Table.Cell>
                <Table.Cell>
                  <Badge size="2xsmall" color={MARKETING_COLOUR[c.marketing]}>
                    {MARKETING_LABEL[c.marketing]}
                  </Badge>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>

      <div className="flex items-center justify-between px-6 py-3">
        <Text size="small" className="text-ui-fg-subtle">
          {count === 0 ? 'No results' : `${offset + 1}–${Math.min(offset + PAGE, count)} of ${count}`}
          {data && data.summary.unattributed_orders > 0 && (
            <>
              {' · '}
              {/* Expected, not a bug: an order whose customer was erased under a subject
                  request is retained for tax and anonymised, so it belongs to nobody. */}
              {data.summary.unattributed_orders} order
              {data.summary.unattributed_orders === 1 ? '' : 's'} not attributed to a customer
            </>
          )}
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
  label: 'Customers',
  icon: Users,
})

export default CustomersPage
