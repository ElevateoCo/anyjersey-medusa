import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../../modules/catalog'
import {
  NOTIFICATION_EVENTS, type NotificationEvent,
} from '../../../../modules/catalog/models/notification-recipient'

async function load(req: MedusaRequest) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const [recipient] = await catalog.listNotificationRecipients(
    { id: req.params.id }, { take: 1 }
  )
  if (!recipient) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, 'That address is not on the list.')
  }
  return { catalog, recipient }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { recipient } = await load(req)
  res.json({ recipient })
}

/**
 * POST /admin/notification-recipients/:id
 *
 * Everything is editable except the address. Changing which address receives customer
 * notifications is not an edit — it is removing one person and adding another, and doing it
 * in place loses the record that the first one was ever on the list. Delete and re-add.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { catalog, recipient } = await load(req)
  const body = (req.body ?? {}) as Record<string, unknown>

  const update: Record<string, unknown> = { id: recipient.id }

  if (body.events !== undefined) {
    const list = Array.isArray(body.events) ? body.events.map(String) : []
    const unknown = list.filter((e) => !NOTIFICATION_EVENTS.includes(e as NotificationEvent))
    if (unknown.length) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA,
        `Not a notification: ${unknown.join(', ')}. Valid: ${NOTIFICATION_EVENTS.join(', ')}`)
    }
    update.events = [...new Set(list)]
  }
  if (body.name !== undefined) update.name = String(body.name).trim() || null
  if (body.note !== undefined) update.note = String(body.note).trim() || null
  if (body.active !== undefined) {
    update.active = body.active === true || body.active === 'true'
  }
  if (body.email !== undefined) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      'The address cannot be changed. Remove this entry and add the new one, so the list ' +
      'still records who was on it.')
  }
  if (Object.keys(update).length === 1) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'Nothing to update.')
  }

  const [updated] = await catalog.updateNotificationRecipients([update])
  res.json({ recipient: updated })
}

/**
 * DELETE — take somebody off the list.
 *
 * A hard delete. The row is an address and a set of checkboxes; there is no record here worth
 * preserving once the person is gone, and a soft-deleted row would keep a colleague's address
 * in the database after they left. Pausing is what `active: false` is for, and it is the
 * reason this is not the only way to stop somebody receiving mail.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { catalog, recipient } = await load(req)
  await catalog.deleteNotificationRecipients([recipient.id])

  // Recomputed after the delete: removing the only person watching orders is exactly the
  // moment to be told that nobody is watching orders.
  const left = await catalog.listNotificationRecipients({ active: true }, { take: 500 })
  const unwatched = NOTIFICATION_EVENTS.filter((event) =>
    !(left as any[]).some((r) => Array.isArray(r.events) && r.events.includes(event)))

  res.json({
    id: recipient.id,
    deleted: true,
    ...(unwatched.length ? { unwatched } : {}),
  })
}
