import { defineRouteConfig } from '@medusajs/admin-sdk'
import { StarSolid } from '@medusajs/icons'
import { Badge, Button, Container, Heading, Select, Table, Text, toast } from '@medusajs/ui'
import { useEffect, useState } from 'react'

/**
 * Review moderation.
 *
 * The constraint that shapes this screen: **rejection requires a policy reason, and a low
 * rating is not one.** Suppressing negative reviews is named explicitly in the FTC
 * Consumer Reviews and Testimonials Rule (research.md §7.10), and a moderation tool with
 * a bare "reject" button is the mechanism for doing it. So the reject control forces a
 * reason, and the API refuses without one.
 */
type Review = {
  id: string; product_id: string; rating: number; title: string | null; body: string
  author: string; email: string; verified_purchase: boolean
  fit_feedback: string | null; status: string; rejection_reason: string | null
  created_at: string
}

const REASON_LABELS: Record<string, string> = {
  spam: 'Spam',
  abusive: 'Abusive',
  off_topic: 'Off topic',
  personal_info: 'Contains personal info',
  not_a_customer: 'Not a customer',
}

export default function ReviewsPage() {
  const [status, setStatus] = useState('pending')
  const [data, setData] = useState<{
    reviews: Review[]; counts: Record<string, number>
    rejection_reasons: string[]; policy: string
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)

  const load = () =>
    fetch(`/admin/reviews?status=${status}`, { credentials: 'include' })
      .then((r) => r.json()).then(setData)
  useEffect(() => { load() }, [status])

  async function move(id: string, next: string, reason?: string) {
    setBusy(id)
    try {
      const res = await fetch(`/admin/reviews/${id}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, rejection_reason: reason }),
      })
      const body = await res.json()
      if (res.ok) { toast.success(next === 'approved' ? 'Published' : 'Rejected') }
      else toast.error(body.message ?? 'Failed')
      setRejecting(null)
      load()
    } finally { setBusy(null) }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Reviews</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Checked for spam and abuse — never filtered by rating
          </Text>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <Select.Trigger className="w-48"><Select.Value /></Select.Trigger>
          <Select.Content>
            {['pending', 'approved', 'rejected', 'all'].map((s) => (
              <Select.Item key={s} value={s}>
                {s} {data?.counts?.[s] != null ? `(${data.counts[s]})` : ''}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>

      <div className="px-6 py-4">
        {!data ? (
          <Text size="small" className="text-ui-fg-muted">Loading…</Text>
        ) : !data.reviews.length ? (
          <Text size="small" className="text-ui-fg-muted">Nothing with status “{status}”.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Rating</Table.HeaderCell>
                <Table.HeaderCell>Review</Table.HeaderCell>
                <Table.HeaderCell>Author</Table.HeaderCell>
                <Table.HeaderCell>Verified</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.reviews.map((r) => (
                <Table.Row key={r.id}>
                  <Table.Cell className="whitespace-nowrap">{'★'.repeat(r.rating)}</Table.Cell>
                  <Table.Cell className="max-w-sm">
                    <Text size="small" className="truncate">{r.body}</Text>
                    {r.fit_feedback && (
                      <Text size="xsmall" className="text-ui-fg-muted">fit: {r.fit_feedback}</Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">{r.author}</Text>
                    <Text size="xsmall" className="text-ui-fg-muted">{r.email}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    {r.verified_purchase
                      ? <Badge size="small" color="green">purchase</Badge>
                      : <Text size="xsmall" className="text-ui-fg-muted">no order</Text>}
                  </Table.Cell>
                  <Table.Cell>
                    <Badge size="small" color={
                      r.status === 'approved' ? 'green'
                        : r.status === 'rejected' ? 'red' : 'orange'
                    }>{r.status}</Badge>
                    {r.rejection_reason && (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {REASON_LABELS[r.rejection_reason] ?? r.rejection_reason}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {rejecting === r.id ? (
                      <div className="flex flex-col gap-1">
                        {data.rejection_reasons.map((reason) => (
                          <Button key={reason} size="small" variant="transparent"
                                  disabled={busy === r.id}
                                  onClick={() => move(r.id, 'rejected', reason)}>
                            {REASON_LABELS[reason] ?? reason}
                          </Button>
                        ))}
                        <Button size="small" variant="transparent"
                                onClick={() => setRejecting(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        {r.status !== 'approved' && (
                          <Button size="small" variant="secondary" disabled={busy === r.id}
                                  onClick={() => move(r.id, 'approved')}>Publish</Button>
                        )}
                        {r.status !== 'rejected' && (
                          <Button size="small" variant="transparent"
                                  onClick={() => setRejecting(r.id)}>Reject…</Button>
                        )}
                      </div>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>

      <div className="px-6 py-4">
        <Text size="xsmall" className="text-ui-fg-muted">
          {data?.policy ?? ''} Rejecting requires choosing a reason — there is deliberately
          no bare reject button.
        </Text>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({ label: 'Reviews', icon: StarSolid })
