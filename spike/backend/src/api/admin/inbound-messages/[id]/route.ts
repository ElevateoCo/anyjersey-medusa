import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../../modules/catalog'

const STATUSES = ['new', 'answered', 'closed']

/** GET one message, with the whole body rather than the listing's summary. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const [message] = await catalog.listInboundMessages({ id: req.params.id }, { take: 1 })
  if (!message) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'No such message.')
  res.json({ message })
}

/**
 * POST /admin/inbound-messages/:id — work the queue.
 *
 * `status` and `notes` only. The address, the body and the consent timestamps are what the
 * customer sent and what the consent record rests on; an admin screen that can rewrite them
 * turns the record into something nobody can rely on.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const body = (req.body ?? {}) as { status?: string; notes?: string }

  if (body.status && !STATUSES.includes(body.status)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      `status must be one of ${STATUSES.join(', ')}`)
  }
  if (body.status === undefined && body.notes === undefined) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'Nothing to update.')
  }

  const [existing] = await catalog.listInboundMessages({ id: req.params.id }, { take: 1 })
  if (!existing) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'No such message.')

  const [updated] = await catalog.updateInboundMessages([{
    id: req.params.id,
    ...(body.status ? { status: body.status } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
  }])

  res.json({ message: updated })
}

/**
 * DELETE /admin/inbound-messages/:id — erasure.
 *
 * A hard delete, and that is the point. This is the only table in the application holding an
 * email address that a person gave for contact or marketing, so it is the one an erasure
 * request under GDPR Art. 17 or the US state laws lands on, and a soft delete leaves the
 * address in the database. "Deleted" has to mean deleted.
 *
 * A newsletter row is the one case where erasure and suppression conflict: deleting the row
 * also deletes the record that this address unsubscribed, so a later import could re-add
 * them. The response says so rather than resolving it silently — a real suppression list is
 * its own store and this application does not have one yet.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)

  const [existing] = await catalog.listInboundMessages({ id: req.params.id }, { take: 1 })
  if (!existing) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'No such message.')

  await catalog.deleteInboundMessages([req.params.id])

  res.json({
    id: req.params.id,
    deleted: true,
    ...(existing.kind === 'newsletter' && existing.unsubscribed_at
      ? {
          warning:
            'This row also recorded an unsubscribe. Erasing it removes that record, so a ' +
            'future import could re-subscribe the address. Add it to a suppression list ' +
            'held outside this database if that matters.',
        }
      : {}),
  })
}
