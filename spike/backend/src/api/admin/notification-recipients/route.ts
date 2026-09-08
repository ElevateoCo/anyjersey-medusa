import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../modules/catalog'
import {
  NOTIFICATION_EVENTS, type NotificationEvent,
} from '../../../modules/catalog/models/notification-recipient'

/**
 * The list of people at the shop who get told when something happens.
 *
 * Every email this application sent went to the customer; nothing notified an operator. This
 * is the list that changed that, and it is a table rather than an environment variable so
 * that adding a colleague is not a redeploy and so returns and orders can go to different
 * people.
 *
 * **Owner-only**, and that is a security decision rather than tidiness: what arrives at these
 * addresses is customer data. An order notification carries a name and a total; a contact
 * notification carries what somebody wrote. Letting Staff add an address to this list would
 * be letting them forward customer records to any inbox they choose.
 */
export const EVENT_LABELS: Record<NotificationEvent, string> = {
  order_placed: 'A customer places an order',
  contact_received: 'Somebody writes in through the contact form',
  jersey_request: 'Somebody asks us to source a jersey',
  return_request: 'A return is requested',
}

const validEvents = (input: unknown): NotificationEvent[] => {
  const list = Array.isArray(input) ? input.map(String) : []
  const unknown = list.filter((e) => !NOTIFICATION_EVENTS.includes(e as NotificationEvent))
  if (unknown.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      `Not a notification: ${unknown.join(', ')}. Valid: ${NOTIFICATION_EVENTS.join(', ')}`)
  }
  return [...new Set(list)] as NotificationEvent[]
}

const normaliseEmail = (input: unknown): string => {
  const email = String(input ?? '').trim().toLowerCase()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'A valid email address is required.')
  }
  return email
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const recipients = await catalog.listNotificationRecipients(
    {}, { take: 500, order: { created_at: 'ASC' } }
  )

  // Who actually receives each event, computed rather than left for the reader to work out
  // from four rows of checkboxes. An event with nobody on it is the thing worth seeing.
  const coverage = NOTIFICATION_EVENTS.map((event) => ({
    event,
    label: EVENT_LABELS[event],
    recipients: (recipients as any[])
      .filter((r) => r.active && Array.isArray(r.events) && r.events.includes(event))
      .map((r) => r.email),
  }))

  res.json({
    recipients,
    events: NOTIFICATION_EVENTS.map((e) => ({ value: e, label: EVENT_LABELS[e] })),
    coverage,
    // Named plainly, because "nobody is told when an order comes in" is the state this whole
    // screen exists to make impossible to be in without knowing.
    unwatched: coverage.filter((c) => !c.recipients.length).map((c) => c.event),
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>

  const email = normaliseEmail(body.email)
  const events = validEvents(body.events)

  const [clash] = await catalog.listNotificationRecipients({ email }, { take: 1 })
  if (clash) {
    throw new MedusaError(MedusaError.Types.DUPLICATE_ERROR,
      `${email} is already on the list. Edit that entry instead.`)
  }

  const [created] = await catalog.createNotificationRecipients([{
    email,
    name: String(body.name ?? '').trim() || null,
    events,
    active: body.active === undefined ? true : body.active === true || body.active === 'true',
    note: String(body.note ?? '').trim() || null,
  }])

  res.status(201).json({
    recipient: created,
    // An address subscribed to nothing is a real state — somebody added ahead of deciding —
    // but it is worth saying so rather than letting it look configured.
    ...(events.length ? {} : { warning: 'This address is on the list and receives nothing yet.' }),
  })
}
