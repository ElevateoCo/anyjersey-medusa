import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../../modules/catalog'

const REASONS = ['spam', 'abusive', 'off_topic', 'personal_info', 'not_a_customer']

/**
 * POST /admin/reviews/:id  { status, rejection_reason? }
 *
 * Rejection without a policy reason is refused. That is not a UI nicety — suppressing
 * negative reviews is named in the FTC Consumer Reviews and Testimonials Rule, and a
 * moderation tool that lets you reject on sentiment is the mechanism for doing it.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const body = (req.body ?? {}) as { status?: string; rejection_reason?: string }

  if (!['approved', 'rejected', 'pending'].includes(String(body.status))) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      'status must be approved, rejected or pending')
  }
  if (body.status === 'rejected' && !REASONS.includes(String(body.rejection_reason))) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      `Rejecting a review requires a policy reason (${REASONS.join(', ')}). ` +
      'A low rating is not a reason — see research.md §7.10.')
  }

  const [updated] = await catalog.updateProductReviews([{
    id: req.params.id,
    status: body.status,
    rejection_reason: body.status === 'rejected' ? body.rejection_reason : null,
    moderated_at: new Date(),
  }])

  res.json({ review: updated })
}

/**
 * DELETE /admin/reviews/:id — removal, as distinct from rejection.
 *
 * Rejecting keeps the row and the audit trail, which is what the FTC rule wants: a moderation
 * decision has to be reviewable, and "we rejected this for spam" is only checkable if the
 * review still exists. That is the normal path and it stays the default.
 *
 * Deletion is for the cases rejection cannot answer. A review containing someone else's
 * personal information, or one whose author has asked to be erased, must actually go — a
 * hidden row still holds the name and the email. So this is a hard delete, and the two verbs
 * mean different things rather than one being a nicer version of the other.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)

  const [existing] = await catalog.listProductReviews({ id: req.params.id }, { take: 1 })
  if (!existing) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'No such review.')

  await catalog.deleteProductReviews([req.params.id])

  res.json({
    id: req.params.id,
    deleted: true,
    // The unique index is partial on deleted_at, and this is a hard delete, so the address
    // is free either way — worth stating because the soft-delete case is not obvious.
    note: 'That address can review this product again.',
  })
}
