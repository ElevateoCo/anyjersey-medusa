import { defineRouteConfig } from '@medusajs/admin-sdk'
import { Badge, Button, Container, Heading, Select, Table, Text } from '@medusajs/ui'
import { InboxSolid } from '@medusajs/icons'
import { useEffect, useState } from 'react'

/**
 * The sourcing queue.
 *
 * "Can't find your jersey? Request it" is the store's differentiator (research.md §12.1),
 * but a captured request only has value if somebody works it. This is that surface: the
 * queue itself, and above it the demand ranking that says what to source next.
 */
type Req = {
  id: string; email: string; raw_request: string
  team: string | null; player: string | null; size_code: string | null
  status: string; source: string; created_at: string
}
type Demand = { key: string; team: string | null; player: string | null; count: number }

const TONE: Record<string, 'grey' | 'orange' | 'blue' | 'green' | 'red'> = {
  new: 'orange', sourcing: 'blue', quoted: 'grey', fulfilled: 'green', declined: 'red',
}

export default function JerseyRequestsPage() {
  const [rows, setRows] = useState<Req[]>([])
  const [demand, setDemand] = useState<Demand[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [status, setStatus] = useState('new')
  const [loading, setLoading] = useState(true)

  async function load(s = status) {
    setLoading(true)
    const res = await fetch(`/admin/jersey-requests?status=${s}`, { credentials: 'include' })
    const body = await res.json()
    setRows(body.requests ?? [])
    setDemand(body.demand ?? [])
    setCounts(body.counts ?? {})
    setLoading(false)
  }

  useEffect(() => { load(status) }, [status])

  async function move(id: string, next: string) {
    await fetch(`/admin/jersey-requests/${id}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    load()
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Jersey requests</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            What customers asked for and nobody stocked yet
          </Text>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <Select.Trigger className="w-56"><Select.Value /></Select.Trigger>
          <Select.Content>
            {['new', 'sourcing', 'quoted', 'fulfilled', 'declined', 'all'].map((s) => (
              <Select.Item key={s} value={s}>
                {s} {counts[s] != null ? `(${counts[s]})` : ''}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>

      {demand.length > 0 && (
        <div className="px-6 py-4">
          <Heading level="h3" className="mb-2">Source these next</Heading>
          <Text size="small" className="text-ui-fg-subtle mb-3">
            Open requests grouped by team and player — ranked by how many people asked.
          </Text>
          <div className="flex flex-wrap gap-2">
            {demand.map((d) => (
              <Badge key={d.key} size="small">
                {[d.player, d.team].filter(Boolean).join(' · ') || 'unspecified'} × {d.count}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="px-6 py-4">
        {loading ? (
          <Text size="small" className="text-ui-fg-subtle">Loading…</Text>
        ) : rows.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            Nothing with status “{status}”.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Request</Table.HeaderCell>
                <Table.HeaderCell>Parsed</Table.HeaderCell>
                <Table.HeaderCell>Email</Table.HeaderCell>
                <Table.HeaderCell>From</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Move</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((r) => (
                <Table.Row key={r.id}>
                  <Table.Cell className="max-w-xs">{r.raw_request}</Table.Cell>
                  <Table.Cell>
                    <Text size="small">
                      {[r.player, r.team, r.size_code].filter(Boolean).join(' · ') || '—'}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>{r.email}</Table.Cell>
                  <Table.Cell><Text size="small">{r.source}</Text></Table.Cell>
                  <Table.Cell>
                    <Badge size="small" color={TONE[r.status] ?? 'grey'}>{r.status}</Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex gap-1">
                      {r.status === 'new' && (
                        <Button size="small" variant="secondary"
                                onClick={() => move(r.id, 'sourcing')}>Source</Button>
                      )}
                      {r.status === 'sourcing' && (
                        <Button size="small" variant="secondary"
                                onClick={() => move(r.id, 'fulfilled')}>Fulfilled</Button>
                      )}
                      {r.status !== 'declined' && r.status !== 'fulfilled' && (
                        <Button size="small" variant="transparent"
                                onClick={() => move(r.id, 'declined')}>Decline</Button>
                      )}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: 'Jersey requests',
  icon: InboxSolid,
})
