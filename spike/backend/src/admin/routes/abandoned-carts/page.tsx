import { defineRouteConfig } from '@medusajs/admin-sdk'
import { ShoppingCart } from '@medusajs/icons'
import { Badge, Button, Container, Heading, Select, Table, Text, toast } from '@medusajs/ui'
import { useEffect, useState } from 'react'

/**
 * Abandoned carts and one-click recovery — native in Shopify, absent in Medusa (§15.3).
 *
 * The idle window defaults to an hour rather than zero on purpose: emailing somebody who
 * is still mid-checkout is worse than not emailing them.
 */
type Cart = {
  id: string; email: string; created_at: string; updated_at: string
  region: string | null; currency: string
  items: { title: string; variant: string | null; quantity: number; subtotal: number }[]
  units: number; value: number; idle_hours: number
  recovery_sent_at: string | null
}
type Payload = {
  abandoned_carts: Cart[]
  summary: { count: number; value: number; units: number; never_contacted: number }
}

const WINDOWS = [
  { value: '1', label: 'Idle over 1 hour' },
  { value: '4', label: 'Idle over 4 hours' },
  { value: '24', label: 'Idle over 1 day' },
  { value: '72', label: 'Idle over 3 days' },
]

export default function AbandonedCartsPage() {
  const [hours, setHours] = useState('1')
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null)

  const load = (h = hours) => {
    setLoading(true)
    fetch(`/admin/abandoned-carts?hours=${h}`, { credentials: 'include' })
      .then((r) => r.json()).then(setData).finally(() => setLoading(false))
  }
  useEffect(() => { load(hours) }, [hours])

  async function recover(id: string) {
    setSending(id)
    try {
      const res = await fetch(`/admin/abandoned-carts/${id}/recover`, {
        method: 'POST', credentials: 'include',
      })
      const body = await res.json()
      if (res.ok) toast.success('Recovery email sent')
      else toast.warning(body.message ?? 'Could not send')
      load()
    } finally {
      setSending(null)
    }
  }

  const money = (n: number, cur = 'USD') =>
    `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Abandoned carts</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Carts with items and an email, never completed
          </Text>
        </div>
        <Select value={hours} onValueChange={setHours}>
          <Select.Trigger className="w-52"><Select.Value /></Select.Trigger>
          <Select.Content>
            {WINDOWS.map((w) => (
              <Select.Item key={w.value} value={w.value}>{w.label}</Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ui-border-base">
          {[
            { label: 'Carts', value: data.summary.count.toLocaleString() },
            { label: 'Recoverable value', value: money(data.summary.value) },
            { label: 'Units', value: data.summary.units.toLocaleString() },
            { label: 'Never contacted', value: data.summary.never_contacted.toLocaleString() },
          ].map((t) => (
            <div key={t.label} className="bg-ui-bg-base px-6 py-4">
              <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">
                {t.label}
              </Text>
              <Heading level="h2" className="tabular-nums mt-1">{t.value}</Heading>
            </div>
          ))}
        </div>
      )}

      <div className="px-6 py-4">
        {loading ? (
          <Text size="small" className="text-ui-fg-muted">Loading…</Text>
        ) : !data?.abandoned_carts.length ? (
          <Text size="small" className="text-ui-fg-muted">
            Nothing idle in that window.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Email</Table.HeaderCell>
                <Table.HeaderCell>Contents</Table.HeaderCell>
                <Table.HeaderCell>Value</Table.HeaderCell>
                <Table.HeaderCell>Idle</Table.HeaderCell>
                <Table.HeaderCell>Contacted</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.abandoned_carts.map((c) => (
                <Table.Row key={c.id}>
                  <Table.Cell>{c.email}</Table.Cell>
                  <Table.Cell className="max-w-sm">
                    <Text size="small" className="truncate">
                      {c.items.map((i) => `${i.quantity}× ${i.title}`).join(', ')}
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">{money(c.value, c.currency)}</Table.Cell>
                  <Table.Cell className="tabular-nums">{c.idle_hours}h</Table.Cell>
                  <Table.Cell>
                    {c.recovery_sent_at
                      ? <Badge size="small" color="green">sent</Badge>
                      : <Badge size="small" color="grey">no</Badge>}
                  </Table.Cell>
                  <Table.Cell>
                    <Button size="small" variant="secondary"
                            disabled={sending === c.id || !!c.recovery_sent_at}
                            onClick={() => recover(c.id)}>
                      {sending === c.id ? 'Sending…' : 'Send recovery'}
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>

      <div className="px-6 py-4">
        <Text size="xsmall" className="text-ui-fg-muted">
          One send per cart. A duplicate &ldquo;you left something behind&rdquo; email is a
          good way to lose the customer you were trying to recover. The email carries no
          countdown and no invented scarcity — those are blacklisted in the EU and
          actionable in the US (research.md §7.10).
        </Text>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({ label: 'Abandoned carts', icon: ShoppingCart })
