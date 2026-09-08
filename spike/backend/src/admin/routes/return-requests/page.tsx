import { defineRouteConfig } from '@medusajs/admin-sdk'
import { ArrowUturnLeft } from '@medusajs/icons'
import { Badge, Button, Container, Heading, Input, Select, Table, Text, toast } from '@medusajs/ui'
import { useEffect, useState } from 'react'

/**
 * Returns queue.
 *
 * Medusa's own returns domain is admin-side and assumes a case is already open; this is
 * where a customer's request becomes one. Three things it is built around:
 *
 *  - **Oldest first, with the wait visible.** Somebody is holding a shirt they want to
 *    send back and cannot until we answer. The wait column is the field that decides what
 *    to work on, so it is shown rather than derivable.
 *  - **Who pays the postage is displayed, not decided here.** It was recorded when the
 *    request was created (§12.4 — free size exchange is the shop's guarantee), so the
 *    person actioning the case cannot accidentally change the promise the customer was
 *    already given by email.
 *  - **Declining requires a note, and the note is what the customer is emailed.** The
 *    endpoint enforces it; this screen makes that obvious by putting the text field in the
 *    path rather than behind a confirm dialog.
 */
type ReturnRequest = {
  id: string
  order_id: string
  order_display_id: string | null
  email: string
  item_title: string | null
  kind: 'exchange' | 'refund' | 'fault'
  requested_size: string | null
  reason: string
  comment: string | null
  status: string
  decision_note: string | null
  return_shipping_paid_by: 'us' | 'customer' | null
  created_at: string
}

const REASON_LABELS: Record<string, string> = {
  too_small: 'Too small', too_large: 'Too large', not_as_described: 'Not as described',
  faulty: 'Faulty', wrong_item: 'Wrong item', arrived_late: 'Arrived late',
  changed_mind: 'Changed mind', other: 'Other',
}

const KIND_LABELS: Record<string, string> = {
  exchange: 'Exchange', refund: 'Refund', fault: 'Fault',
}

const STATUS_COLOUR: Record<string, 'green' | 'orange' | 'red' | 'blue' | 'grey'> = {
  new: 'orange', approved: 'blue', label_sent: 'blue', received: 'blue',
  resolved: 'green', declined: 'red',
}

/** The next move for each state, so nobody has to remember the sequence. */
const NEXT: Record<string, { action: string; label: string } | null> = {
  new: { action: 'approve', label: 'Approve' },
  approved: { action: 'label_sent', label: 'Label sent' },
  label_sent: { action: 'received', label: 'Parcel received' },
  received: { action: 'resolve', label: 'Refunded / reshipped' },
  resolved: null,
  declined: null,
}

function waited(iso: string): { label: string; stale: boolean } {
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5
  if (hours < 1) return { label: `${Math.max(1, Math.round(hours * 60))}m`, stale: false }
  if (hours < 24) return { label: `${Math.round(hours)}h`, stale: hours >= 12 }
  return { label: `${Math.round(hours / 24)}d`, stale: true }
}

export default function ReturnRequestsPage() {
  const [status, setStatus] = useState('new')
  const [data, setData] = useState<{
    return_requests: ReturnRequest[]
    count: number
    counts: Record<string, number>
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [declining, setDeclining] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const load = () =>
    fetch(`/admin/return-requests?status=${status}`, { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => toast.error('Could not load the returns queue'))

  useEffect(() => { load() }, [status])

  async function act(id: string, action: string, declineNote?: string) {
    setBusy(id)
    try {
      const res = await fetch(`/admin/return-requests/${id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: declineNote }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(body.message ?? 'Failed'); return }
      toast.success(
        action === 'decline'
          ? 'Declined — the customer has been emailed your note'
          : action === 'approve'
            ? 'Approved — the customer has been told to send it back'
            : 'Updated'
      )
      setDeclining(null)
      setNote('')
      load()
    } finally { setBusy(null) }
  }

  const rows = data?.return_requests ?? []

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Returns &amp; exchanges</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Somebody is waiting on each of these. Oldest first.
          </Text>
        </div>
        <div className="flex items-center gap-3">
          {data?.counts?.new ? (
            <Badge color={data.counts.new > 10 ? 'red' : 'orange'}>
              {data.counts.new} unanswered
            </Badge>
          ) : null}
          <Select value={status} onValueChange={setStatus}>
            <Select.Trigger className="w-52"><Select.Value /></Select.Trigger>
            <Select.Content>
              {['new', 'approved', 'label_sent', 'received', 'resolved', 'declined'].map((s) => (
                <Select.Item key={s} value={s}>
                  {s.replace('_', ' ')}{data?.counts ? ` (${data.counts[s] ?? 0})` : ''}
                </Select.Item>
              ))}
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
            {status === 'new'
              ? 'Nothing unanswered. Every return request has had a decision.'
              : `No ${status.replace('_', ' ')} returns.`}
          </Text>
        </div>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Item</Table.HeaderCell>
              <Table.HeaderCell>Asking for</Table.HeaderCell>
              <Table.HeaderCell>Why</Table.HeaderCell>
              <Table.HeaderCell>Postage</Table.HeaderCell>
              <Table.HeaderCell>Order</Table.HeaderCell>
              <Table.HeaderCell>Waiting</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((r) => {
              const w = waited(r.created_at)
              const next = NEXT[r.status]
              return (
                <Table.Row key={r.id}>
                  <Table.Cell>
                    <div className="flex flex-col gap-1">
                      <Text size="small">{r.item_title ?? '—'}</Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">{r.email}</Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col gap-1">
                      <Badge size="2xsmall" color={r.kind === 'fault' ? 'red' : 'grey'}>
                        {KIND_LABELS[r.kind] ?? r.kind}
                      </Badge>
                      {r.requested_size && (
                        <Text size="xsmall" className="font-mono">→ {r.requested_size}</Text>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col gap-1">
                      <Text size="small">{REASON_LABELS[r.reason] ?? r.reason}</Text>
                      {r.comment && (
                        <Text size="xsmall" className="text-ui-fg-subtle max-w-64">
                          “{r.comment}”
                        </Text>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    {/* Recorded at creation, displayed not decided — the customer already
                        has this promise in an email. */}
                    <Text size="xsmall" className={
                      r.return_shipping_paid_by === 'us' ? 'text-ui-fg-error' : 'text-ui-fg-subtle'
                    }>
                      {r.return_shipping_paid_by === 'us' ? 'we pay' : 'customer pays'}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className="font-mono">
                      #{r.order_display_id ?? r.order_id.slice(-8)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className={w.stale ? 'text-ui-fg-error' : 'text-ui-fg-subtle'}>
                      {w.label}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    {declining === r.id ? (
                      <div className="flex flex-col items-end gap-2">
                        {/* The note is the email. Required, because a refusal with nothing
                            attached leaves support with nothing to say. */}
                        <Input
                          size="small"
                          placeholder="Why — the customer is sent this"
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          className="w-64"
                        />
                        <div className="flex gap-2">
                          <Button size="small" variant="transparent"
                                  onClick={() => { setDeclining(null); setNote('') }}>
                            Cancel
                          </Button>
                          <Button size="small" variant="danger"
                                  disabled={busy === r.id || !note.trim()}
                                  onClick={() => act(r.id, 'decline', note)}>
                            Decline &amp; email
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        {r.status === 'new' && (
                          <Button size="small" variant="secondary" disabled={busy === r.id}
                                  onClick={() => setDeclining(r.id)}>
                            Decline
                          </Button>
                        )}
                        {next ? (
                          <Button size="small" disabled={busy === r.id}
                                  onClick={() => act(r.id, next.action)}>
                            {next.label}
                          </Button>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <Badge color={STATUS_COLOUR[r.status] ?? 'grey'} size="2xsmall">
                              {r.status.replace('_', ' ')}
                            </Badge>
                            {r.decision_note && (
                              <Text size="xsmall" className="text-ui-fg-subtle max-w-64">
                                {r.decision_note}
                              </Text>
                            )}
                          </div>
                        )}
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
          Refunds and return labels are not issued from here. Both are irreversible external
          calls, and Shippo&rsquo;s transaction endpoint is not idempotent — a retry whose
          response was lost buys two labels. This queue records the decision; the money moves
          in Orders.
        </Text>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: 'Returns',
  icon: ArrowUturnLeft,
})
