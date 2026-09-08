import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { CATALOG_MODULE } from '../../../../modules/catalog'

const REASONS = ['blocklist', 'trademark', 'illegible', 'unavailable_patch', 'other'] as const

/**
 * POST /admin/personalisations/:id — approve or reject one request.
 *
 * Rejection requires a reason for the same reason review rejection does (research.md §7.10
 * and the ProductReview model): the refund path and the customer email differ per reason,
 * and "rejected" with nothing attached leaves support with nothing to say to someone whose
 * order just changed.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const id = String(req.params.id)
  const body = (req.body ?? {}) as { action?: string; reason?: string; reviewer?: string }

  const [existing] = await catalog.listLinePersonalisations({ id })
  if (!existing) return res.status(404).json({ message: 'No such personalisation.' })

  if (body.action === 'approve') {
    // The print file is generated *after* approval, never before — spec §6. Generating it
    // eagerly means a rejected request has already produced an artefact.
    const updated = await catalog.updateLinePersonalisations({
      id,
      review_status: 'approved',
      rejection_reason: null,
      reviewed_by: body.reviewer || 'admin',
      reviewed_at: new Date(),
    })
    return res.json({ personalisation: updated })
  }

  if (body.action === 'reject') {
    if (!body.reason || !REASONS.includes(body.reason as any)) {
      return res.status(400).json({
        message: `A rejection needs a reason: ${REASONS.join(', ')}.`,
      })
    }
    const updated = await catalog.updateLinePersonalisations({
      id,
      review_status: 'rejected',
      rejection_reason: body.reason,
      reviewed_by: body.reviewer || 'admin',
      reviewed_at: new Date(),
    })
    // The refund of the add-on and the "we're shipping the plain shirt" email are separate
    // steps, deliberately not fired from here: a rejection that half-succeeds must not
    // leave the customer refunded but still queued, or emailed but not refunded. The
    // rejected row is the trigger a subscriber acts on.
    return res.json({ personalisation: updated, next: ['refund_add_on', 'notify_customer'] })
  }

  res.status(400).json({ message: 'action must be "approve" or "reject".' })
}
