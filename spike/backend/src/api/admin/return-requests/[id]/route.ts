import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { refundPaymentWorkflow } from '@medusajs/medusa/core-flows'
import { CATALOG_MODULE } from '../../../../modules/catalog'

/**
 * POST /admin/return-requests/:id  { action, note?, tracking? }
 *
 * Moves one case along. The transitions are explicit rather than a free `status` field
 * because two of them have consequences outside the row:
 *
 *   - **approve** is when the customer is told to post the shirt back, and when the
 *     free-postage promise becomes a cost we have accepted.
 *   - **decline** requires a note. Same rule as a rejected personalisation and a rejected
 *     review: a refusal with no reason attached leaves support with nothing to say to
 *     someone whose money is involved.
 *
 * Refunding and buying the return label are deliberately *not* done here. Both are
 * irreversible external calls, and Shippo's transaction endpoint is not idempotent — a
 * retry whose response was lost buys two labels. So this records the decision, and the
 * `next` array names what a human or a subscriber does with it. That is the same split the
 * personalisation queue uses.
 */
const ACTIONS = ['approve', 'label_sent', 'received', 'resolve', 'decline'] as const

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const id = String(req.params.id)
  const body = (req.body ?? {}) as {
    action?: string; note?: string; tracking?: string; amount?: unknown
  }

  const [existing] = await catalog.listReturnRequests({ id })
  if (!existing) return res.status(404).json({ message: 'No such return request.' })

  if (body.action === 'refund') return refund(req, res, existing)

  if (!ACTIONS.includes(body.action as any)) {
    return res.status(400).json({
      message: `action must be one of: ${[...ACTIONS, 'refund'].join(', ')}.`,
    })
  }

  if (body.action === 'decline' && !String(body.note ?? '').trim()) {
    return res.status(400).json({
      message: 'A declined return needs a note explaining why — the customer is told it.',
    })
  }

  const status = ({
    approve: 'approved',
    label_sent: 'label_sent',
    received: 'received',
    resolve: 'resolved',
    decline: 'declined',
  } as const)[body.action as (typeof ACTIONS)[number]]

  const updated = await catalog.updateReturnRequests({
    id,
    status,
    decision_note: String(body.note ?? '').trim().slice(0, 1000) || existing.decision_note,
  })

  // The customer is emailed on the two transitions they are waiting on. Wrapped, because a
  // failed send must not fail the state change — the row is the record, the email is the
  // courtesy. Same rule as the order confirmation.
  if (status === 'approved' || status === 'declined') {
    try {
      const notification = req.scope.resolve(Modules.NOTIFICATION)
      await notification.createNotifications({
        to: existing.email,
        channel: 'email',
        template: status === 'approved' ? 'return-approved' : 'return-declined',
        data: {
          order_number: existing.order_display_id,
          item_title: existing.item_title,
          kind: existing.kind,
          requested_size: existing.requested_size,
          we_pay_postage: existing.return_shipping_paid_by === 'us',
          note: String(body.note ?? '').trim() || null,
        },
      })
    } catch (e) {
      req.scope.resolve('logger').error(
        `return-${status} email failed for ${existing.email}: ` +
        (e instanceof Error ? e.message : String(e))
      )
    }
  }

  res.json({
    return_request: updated,
    next: status === 'received' ? ['refund_or_reship'] : [],
  })
}

/**
 * DELETE /admin/return-requests/:id — take it off the queue.
 *
 * **Soft, where the inbox and the request queue are hard**, and the difference is worth
 * stating because it looks inconsistent otherwise.
 *
 * A return request is a commercial record: what a customer asked for, what was decided, and
 * on what policy grounds. Under a final-sale policy that record is the evidence for a refusal,
 * and it is exactly what a chargeback or a consumer-protection complaint turns on. Destroying
 * it because somebody wanted a tidy queue is the wrong trade, so this hides the row and keeps
 * it.
 *
 * Erasure is not served by deleting here either, and pretending otherwise would be the
 * mistake: the same email address is on the order, which is Medusa's record and the system of
 * account. Erasing a customer means erasing the order, not this row.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)

  const [existing] = await catalog.listReturnRequests({ id: req.params.id }, { take: 1 })
  if (!existing) {
    return res.status(404).json({ message: 'No such return request.' })
  }

  await catalog.softDeleteReturnRequests([req.params.id])

  res.json({
    id: req.params.id,
    deleted: true,
    soft: true,
    note:
      'Hidden, not destroyed. A return decision is the evidence for a refusal under a ' +
      'final-sale policy. The customer\'s email is on the order regardless, so erasure is ' +
      'an order-level operation.',
  })
}

/**
 * Give the money back.
 *
 * The one action here that is irreversible outside this database, and the reason the queue
 * recorded decisions and moved no money until now.
 *
 * **The idempotency lives in the row, not in the call.** Medusa's `refundPaymentWorkflow`
 * accepts no idempotency key — its Stripe provider passes one from a payment context the
 * workflow does not expose — so `refunded_at` is the guarantee: checked first, written as part
 * of issuing, and a second attempt returns what the first one did rather than refunding again.
 * Stripe swallowing `CHARGE_ALREADY_REFUNDED` sits under that as a second layer, but it
 * protects the money and not the record, and an operator who clicks twice deserves to be told
 * the first click worked.
 *
 * Only from `received`. Refunding before the shirt is back is a decision somebody can make in
 * Stripe directly; it is not one this queue should make easy, because under a final-sale policy
 * the goods coming back is the thing being verified.
 */
async function refund(req: MedusaRequest, res: MedusaResponse, existing: any) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const actor = (req as any).auth_context?.actor_id ?? 'unknown'

  // Checked before anything else: this is the whole protection.
  if (existing.refunded_at) {
    return res.status(409).json({
      message:
        `Already refunded on ${new Date(existing.refunded_at).toISOString()}` +
        `${existing.refunded_by ? ` by ${existing.refunded_by}` : ''}. ` +
        'Refund again in Stripe directly if that is genuinely what you want.',
      refunded_at: existing.refunded_at,
      refund_amount: existing.refund_amount,
    })
  }

  if (existing.status !== 'received') {
    return res.status(409).json({
      message:
        `A return has to be marked received before it is refunded — this one is ` +
        `"${existing.status}". Under a final-sale policy the goods coming back is the thing ` +
        'being verified.',
    })
  }

  /**
   * The amount, in minor units. Validated before anything is looked up.
   *
   * Cheapest check first, and the more accurate answer: a request with no amount is
   * malformed, and reporting it as "that order has no captured payment" describes the state
   * of something the caller never got as far as.
   *
   * There is deliberately no default. A return is usually one item out of several, and a
   * default that refunds the order total is a mistake nobody notices until it has happened.
   */
  const amount = body_amount(req)
  if (!amount) {
    return res.status(400).json({
      message:
        'An amount in minor units is required — there is no safe default. A return is ' +
        'usually one item out of several, and defaulting to the order total is a mistake ' +
        'nobody notices until it has happened.',
    })
  }

  const { data: orders } = await query.graph({
    entity: 'order',
    fields: ['id', 'display_id', 'currency_code', 'payment_collections.payments.id',
             'payment_collections.payments.amount', 'payment_collections.payments.captured_at'],
    filters: { id: existing.order_id } as any,
  }).catch(() => ({ data: [] as any[] }))

  const order = (orders as any[])[0]
  const payment = (order?.payment_collections ?? [])
    .flatMap((c: any) => c.payments ?? [])
    .find((p: any) => p.captured_at)

  if (!payment) {
    return res.status(409).json({
      message:
        'No captured payment found on that order, so there is nothing to refund. An ' +
        'authorised-but-uncaptured payment is cancelled rather than refunded.',
    })
  }

  const captured = Math.round(Number(payment.amount ?? 0) * 100)
  if (amount > captured) {
    return res.status(400).json({
      message: `That is more than was captured (${captured} minor units).`,
    })
  }

  try {
    await refundPaymentWorkflow(req.scope).run({
      input: {
        payment_id: payment.id,
        created_by: actor,
        amount: amount / 100,
        note: `Return ${existing.id}${existing.reason ? ` — ${existing.reason}` : ''}`,
      } as any,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // Recorded so a retry is possible and so the failure is not invisible. `refunded_at`
    // stays null, which is what keeps the action available.
    await catalog.updateReturnRequests({ id: existing.id, refund_error: message.slice(0, 500) })
    logger.error(`[returns] refund failed for ${existing.id}: ${message}`)
    return res.status(502).json({
      message: `The refund did not go through: ${message}`,
      retryable: true,
    })
  }

  const [updated] = await catalog.updateReturnRequests([{
    id: existing.id,
    refunded_at: new Date(),
    refunded_by: actor,
    refund_amount: amount,
    refund_payment_id: payment.id,
    refund_error: null,
    status: 'resolved',
  }])

  logger.info(
    `[returns] refunded ${amount} minor units on order #${order.display_id} ` +
    `for return ${existing.id} by ${actor}`
  )

  res.json({
    request: updated,
    refunded: { amount, payment_id: payment.id, currency: order.currency_code },
  })
}

/** Minor units only, and never inferred — see the refusal above. */
function body_amount(req: MedusaRequest): number | null {
  const raw = (req.body as { amount?: unknown })?.amount
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}
