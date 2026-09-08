import { defineRouteConfig } from '@medusajs/admin-sdk'
import { PencilSquare } from '@medusajs/icons'
import { Badge, Button, Container, Heading, Select, Table, Text, toast } from '@medusajs/ui'
import { useEffect, useState } from 'react'

/**
 * Personalisation review queue.
 *
 * Every request waits here before it prints — personalisation-spec.md §6. The reason it is
 * a human queue rather than a blocklist alone: the automated screen catches the words it
 * knows about, and the residual exposure on a printed garment is a trademark claim over a
 * player's name, which no word list can decide.
 *
 * Two things the screen is built around:
 *
 *  - **The value is shown as it will be printed**, in the typeface slot and placement it
 *     will occupy, because "ALLEN" approved on a preview that differs from the print file is
 *     worth nothing as evidence in a dispute.
 *  - **Rejecting requires a reason**, and each reason implies a different follow-up: the
 *     add-on is refunded and the plain shirt still ships, and what the customer is told
 *     depends on why.
 */
type Personalisation = {
  id: string
  order_id: string | null
  cart_line_id: string | null
  product_id: string
  kind: 'name' | 'number' | 'patch'
  value: string
  price: number
  typeface: string
  placement: string
  review_status: string
  rejection_reason: string | null
  reviewed_by: string | null
  created_at: string
}

const REASON_LABELS: Record<string, string> = {
  blocklist: 'Blocked content',
  trademark: 'Trademark risk',
  illegible: 'Won’t print legibly',
  unavailable_patch: 'Patch unavailable',
  other: 'Other',
}

const KIND_LABELS: Record<string, string> = {
  name: 'Name',
  number: 'Number',
  patch: 'Patch',
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

/** How long this request has been waiting — the number that decides what to work on. */
function waited(iso: string): { label: string; stale: boolean } {
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5
  if (hours < 1) return { label: `${Math.max(1, Math.round(hours * 60))}m`, stale: false }
  if (hours < 24) return { label: `${Math.round(hours)}h`, stale: hours >= 12 }
  return { label: `${Math.round(hours / 24)}d`, stale: true }
}

export default function PersonalisationsPage() {
  const [status, setStatus] = useState('pending')
  const [data, setData] = useState<{
    personalisations: Personalisation[]
    count: number
    counts: Record<string, number>
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)

  const load = () =>
    fetch(`/admin/personalisations?status=${status}`, { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => toast.error('Could not load the queue'))

  useEffect(() => { load() }, [status])

  async function decide(id: string, action: 'approve' | 'reject', reason?: string) {
    setBusy(id)
    try {
      const res = await fetch(`/admin/personalisations/${id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(body.message ?? 'Failed'); return }
      toast.success(
        action === 'approve'
          ? 'Approved — print file will be generated'
          : 'Rejected — refund the add-on and tell the customer'
      )
      setRejecting(null)
      load()
    } finally { setBusy(null) }
  }

  const rows = data?.personalisations ?? []

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Personalisation queue</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Nothing prints until it is approved here. Oldest first.
          </Text>
        </div>
        <div className="flex items-center gap-3">
          {data?.counts?.pending ? (
            <Badge color={data.counts.pending > 20 ? 'red' : 'orange'}>
              {data.counts.pending} waiting
            </Badge>
          ) : null}
          <Select value={status} onValueChange={setStatus}>
            <Select.Trigger className="w-44"><Select.Value /></Select.Trigger>
            <Select.Content>
              <Select.Item value="pending">
                Pending{data?.counts ? ` (${data.counts.pending})` : ''}
              </Select.Item>
              <Select.Item value="approved">
                Approved{data?.counts ? ` (${data.counts.approved})` : ''}
              </Select.Item>
              <Select.Item value="rejected">
                Rejected{data?.counts ? ` (${data.counts.rejected})` : ''}
              </Select.Item>
              <Select.Item value="all">All</Select.Item>
            </Select.Content>
          </Select>
        </div>
      </div>

      {!data ? (
        <div className="px-6 py-10"><Text className="text-ui-fg-subtle">Loading…</Text></div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-10">
          <Text className="text-ui-fg-subtle">
            {status === 'pending'
              ? 'Nothing waiting. Every personalised order is cleared to print.'
              : `No ${status} personalisations.`}
          </Text>
        </div>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>What prints</Table.HeaderCell>
              <Table.HeaderCell>Placement</Table.HeaderCell>
              <Table.HeaderCell>Order</Table.HeaderCell>
              <Table.HeaderCell>Charged</Table.HeaderCell>
              <Table.HeaderCell>Waiting</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((p) => {
              const w = waited(p.created_at)
              return (
                <Table.Row key={p.id}>
                  <Table.Cell>
                    <div className="flex flex-col gap-1">
                      {/* Monospace and uppercase: shown the way it will be printed, not
                          the way it was typed. */}
                      <span className="font-mono text-base tracking-widest">{p.value}</span>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {KIND_LABELS[p.kind] ?? p.kind} · {p.typeface}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge size="2xsmall">{p.placement}</Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className="font-mono">
                      {p.order_id ? p.order_id.slice(-8) : 'in cart'}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    {/* Zero is correct on the number row of a bundle: the bundle price sits
                        on the name row so the rows still sum to what was charged. */}
                    <Text size="small">{p.price === 0 ? 'in bundle' : money(p.price)}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className={w.stale ? 'text-ui-fg-error' : 'text-ui-fg-subtle'}>
                      {w.label}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    {p.review_status !== 'pending' ? (
                      <div className="flex flex-col items-end gap-1">
                        <Badge color={p.review_status === 'approved' ? 'green' : 'red'} size="2xsmall">
                          {p.review_status}
                        </Badge>
                        {p.rejection_reason && (
                          <Text size="xsmall" className="text-ui-fg-subtle">
                            {REASON_LABELS[p.rejection_reason] ?? p.rejection_reason}
                          </Text>
                        )}
                      </div>
                    ) : rejecting === p.id ? (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {/* The reason is the control, not a confirmation dialog: picking
                            one *is* the rejection, so there is no way to reject blankly. */}
                        {Object.entries(REASON_LABELS).map(([key, label]) => (
                          <Button
                            key={key}
                            size="small"
                            variant="secondary"
                            disabled={busy === p.id}
                            onClick={() => decide(p.id, 'reject', key)}
                          >
                            {label}
                          </Button>
                        ))}
                        <Button size="small" variant="transparent" onClick={() => setRejecting(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="small"
                          variant="secondary"
                          disabled={busy === p.id}
                          onClick={() => setRejecting(p.id)}
                        >
                          Reject
                        </Button>
                        <Button
                          size="small"
                          disabled={busy === p.id}
                          onClick={() => decide(p.id, 'approve')}
                        >
                          Approve
                        </Button>
                      </div>
                    )}
                  </Table.Cell>
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table>
      )}

      <div className="px-6 py-4">
        <Text size="xsmall" className="text-ui-fg-subtle">
          Rejecting refunds the add-on and ships the plain shirt. The print file is generated
          only after approval, so a rejected request never produces one.
        </Text>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: 'Personalisation',
  icon: PencilSquare,
})
