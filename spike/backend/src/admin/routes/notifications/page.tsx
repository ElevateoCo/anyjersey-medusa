import { defineRouteConfig } from '@medusajs/admin-sdk'
import { BellAlert } from '@medusajs/icons'
import {
  Badge, Button, Checkbox, Container, Heading, Input, Prompt, Switch, Table, Text, toast,
} from '@medusajs/ui'
import { useCallback, useEffect, useState } from 'react'

/**
 * Who at the shop gets told when something happens.
 *
 * Until this screen existed, nothing did. Every one of the nine emails the store sends
 * addresses the customer: somebody wrote in through the contact form, the shop replied "we got
 * your message" automatically, and no human was told a message had arrived. Same for a paid
 * order, a sourcing request and a return.
 *
 * The screen leads with **coverage** rather than with the list, because the question an
 * operator actually has is "is anyone watching returns?" and not "who is on the list". An
 * event nobody receives is the state this page exists to make impossible to be in unknowingly,
 * so it is the first thing rendered and it is rendered in red.
 */
export const config = defineRouteConfig({ label: 'Notifications', icon: BellAlert })

type Recipient = {
  id: string
  email: string
  name: string | null
  events: string[]
  active: boolean
  note: string | null
}
type EventDef = { value: string; label: string }
type Payload = {
  recipients: Recipient[]
  events: EventDef[]
  coverage: { event: string; label: string; recipients: string[] }[]
  unwatched: string[]
}

export default function NotificationsPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Recipient | null>(null)

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [events, setEvents] = useState<string[]>([])

  const load = useCallback(() => {
    setLoading(true)
    fetch('/admin/notification-recipients', { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => toast.error('Could not load the notification list'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const call = async (url: string, init: RequestInit) => {
    const res = await fetch(url, { credentials: 'include', ...init })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.message ?? `Failed (${res.status})`)
    return json
  }

  const add = async () => {
    if (!email.trim()) return toast.error('An email address is required')
    setBusy(true)
    try {
      const json = await call('/admin/notification-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, events }),
      })
      toast.success(`${json.recipient.email} added`, {
        // Surfaced rather than swallowed: an address on the list receiving nothing looks
        // configured and is not.
        description: json.warning,
      })
      setEmail(''); setName(''); setEvents([])
      load()
    } catch (e) {
      toast.error('Not added', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const patch = async (row: Recipient, body: Record<string, unknown>) => {
    try {
      await call(`/admin/notification-recipients/${row.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      load()
    } catch (e) {
      toast.error('Not saved', { description: (e as Error).message })
    }
  }

  const remove = async (row: Recipient) => {
    setConfirmDelete(null)
    try {
      const json = await call(`/admin/notification-recipients/${row.id}`, { method: 'DELETE' })
      toast.success(`${row.email} removed`, {
        description: json.unwatched?.length
          ? `Nobody now receives: ${json.unwatched.join(', ')}`
          : undefined,
      })
      load()
    } catch (e) {
      toast.error('Not removed', { description: (e as Error).message })
    }
  }

  const toggleEvent = (row: Recipient, event: string) => {
    const next = row.events.includes(event)
      ? row.events.filter((e) => e !== event)
      : [...row.events, event]
    patch(row, { events: next })
  }

  const labelFor = (value: string) =>
    data?.events.find((e) => e.value === value)?.label ?? value

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Notifications</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Addresses here are told when work arrives. Everything else this store sends goes to
          the customer.
        </Text>
      </div>

      {/* Coverage first: the question is "is anyone watching returns?", not "who is on the
          list". An unwatched event is the failure state and it leads. */}
      {data && (
        <div className="px-6 py-4">
          <div className="flex flex-col gap-2">
            {data.coverage.map((c) => (
              <div key={c.event} className="flex items-start justify-between gap-4">
                <Text size="small">{c.label}</Text>
                {c.recipients.length ? (
                  <Text size="small" className="text-ui-fg-subtle text-right">
                    {c.recipients.join(', ')}
                  </Text>
                ) : (
                  <Badge size="2xsmall" color="red">nobody is told</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-6 py-4">
        <Heading level="h2" className="mb-2">Add an address</Heading>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <Text size="xsmall" className="text-ui-fg-subtle">Email</Text>
            <Input value={email} disabled={busy} placeholder="you@example.com"
                   onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex-1">
            <Text size="xsmall" className="text-ui-fg-subtle">Name (optional)</Text>
            <Input value={name} disabled={busy}
                   onChange={(e) => setName(e.target.value)} />
          </div>
          <Button onClick={add} isLoading={busy}>Add</Button>
        </div>

        <fieldset className="mt-3 border-0 p-0">
          <legend>
            <Text size="xsmall" className="text-ui-fg-subtle">Send them</Text>
          </legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {(data?.events ?? []).map((e) => (
              <label key={e.value} className="flex items-center gap-2">
                <Checkbox
                  checked={events.includes(e.value)}
                  disabled={busy}
                  onCheckedChange={(on) =>
                    setEvents(on ? [...events, e.value] : events.filter((v) => v !== e.value))}
                />
                <Text size="small">{e.label}</Text>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="px-6 py-2">
        {loading && !data ? (
          <Text className="py-8 text-center text-ui-fg-subtle">Loading…</Text>
        ) : !data?.recipients.length ? (
          <Text className="py-8 text-center text-ui-fg-subtle">
            Nobody is on the list. Every order, message, request and return currently arrives
            with no one told.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Address</Table.HeaderCell>
                {(data.events ?? []).map((e) => (
                  <Table.HeaderCell key={e.value}>{shortLabel(e.value)}</Table.HeaderCell>
                ))}
                <Table.HeaderCell>Active</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.recipients.map((row) => (
                <Table.Row key={row.id}>
                  <Table.Cell>
                    <div>{row.email}</div>
                    {(row.name || row.note) && (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {[row.name, row.note].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </Table.Cell>
                  {(data.events ?? []).map((e) => (
                    <Table.Cell key={e.value}>
                      <Checkbox
                        checked={row.events.includes(e.value)}
                        aria-label={`${row.email}: ${labelFor(e.value)}`}
                        onCheckedChange={() => toggleEvent(row, e.value)}
                      />
                    </Table.Cell>
                  ))}
                  <Table.Cell>
                    {/* Paused rather than removed: somebody on holiday should not have to be
                        deleted and re-added, which would lose their subscriptions. */}
                    <Switch
                      checked={row.active}
                      aria-label={`${row.email} active`}
                      onCheckedChange={(v) => patch(row, { active: v })}
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex justify-end">
                      <Button size="small" variant="danger"
                              onClick={() => setConfirmDelete(row)}>Remove</Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>

      <Prompt open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Remove {confirmDelete?.email}?</Prompt.Title>
            <Prompt.Description>
              They stop receiving everything immediately. To pause them instead — for a
              holiday, say — switch them off rather than removing them, which keeps what they
              were subscribed to.
            </Prompt.Description>
          </Prompt.Header>
          <Prompt.Footer>
            <Prompt.Cancel>Cancel</Prompt.Cancel>
            <Prompt.Action onClick={() => confirmDelete && remove(confirmDelete)}>
              Remove
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
    </Container>
  )
}

/** Column headers have to fit; the full sentence is on the coverage list above. */
const shortLabel = (value: string) => ({
  order_placed: 'Orders',
  contact_received: 'Contact',
  jersey_request: 'Requests',
  return_request: 'Returns',
}[value] ?? value)
