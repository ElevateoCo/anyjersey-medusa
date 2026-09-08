import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../modules/catalog'
import { limited } from '../../../rate-limit'
import { shouldSend } from '../../../message-settings'
import { notifyOps } from '../../../ops-notify'
import {
  RETURN_WINDOW_DAYS, WITHDRAWAL_WINDOW_DAYS, REASONS, KINDS, KIND_LABELS, STANCE,
  eligibility, postagePaidBy, reasonAccepted, type Kind,
} from '../../../returns'

/**
 * POST /store/return-requests  { email, order_number, line_item_id, kind, reason, ... }
 * GET  /store/return-requests?email=&order_number=   what can be returned, and why not
 *
 * Self-service returns, which Medusa's store API does not provide: its returns domain is
 * admin-side and assumes somebody is already handling the case.
 *
 * The security shape is copied deliberately from `/store/order-lookup`, because this is the
 * same problem — an unauthenticated endpoint over somebody's order:
 *
 *   - both the order number and the matching email are required
 *   - one identical response for "no such order" and "wrong email", with a delay, so it
 *     cannot be used to enumerate order numbers or confirm an address
 *   - only fields the customer already knows come back
 *
 * What it adds on top is that **eligibility is decided server-side and re-decided on
 * submit**. The GET tells the storefront what to offer; the POST does not trust it. A
 * client that asks to return a personalised line, or a line outside the window, is refused
 * with the reason rather than creating a row somebody has to decline by hand.
 */
const DENY = { message: 'No order matches that number and email.' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0))
  return Number.isFinite(n) ? n : 0
}

/** The order, its lines, and which of those lines carry personalisation. */
async function resolveOrder(scope: any, email: string, orderNumber: number) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query
    .graph({
      entity: 'order',
      fields: [
        'id', 'display_id', 'email', 'created_at', 'currency_code', 'version',
        'items.*',
        // The destination decides whether the statutory withdrawal right applies, which is
        // the one basis on which a change of mind is accepted under a final-sale policy.
        'shipping_address.country_code',
        'fulfillments.shipped_at', 'fulfillments.delivered_at',
      ],
      filters: { display_id: orderNumber } as any,
      pagination: { take: 1, skip: 0 },
    })
    .catch(() => ({ data: [] as any[] }))

  const order = (orders as any[])[0]
  if (!order || String(order.email ?? '').toLowerCase() !== email) return null

  const catalog: any = scope.resolve(CATALOG_MODULE)

  // Personalised lines are made to specification and cannot be returned. Read from the
  // personalisation table rather than inferred from the line title, because the add-on is
  // its own product — the *shirt* line is the personalised one, and its title says nothing.
  const pers = await catalog
    .listLinePersonalisations({ order_id: order.id }, { select: ['order_line_id'] })
    .catch(() => [])
  const personalised = new Set(
    (pers as any[]).map((p) => p.order_line_id).filter(Boolean)
  )

  // Requests already open against this order, so the same line cannot be submitted twice.
  const existing = await catalog
    .listReturnRequests(
      { order_id: order.id },
      { select: ['line_item_id', 'status'] }
    )
    .catch(() => [])
  const open = new Set(
    (existing as any[])
      .filter((r) => !['resolved', 'declined'].includes(r.status))
      .map((r) => r.line_item_id)
      .filter(Boolean)
  )

  const fulfil = (order.fulfillments ?? [])[0]

  return {
    order,
    personalised,
    open,
    deliveredAt: fulfil?.delivered_at ?? null,
    countryCode: order.shipping_address?.country_code ?? null,
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (await limited(req, res, 'return-requests-read', 30, 60_000)) return

  const email = String(req.query.email ?? '').trim().toLowerCase()
  const raw = String(req.query.order_number ?? '').trim().replace(/^#/, '')
  const orderNumber = Number(raw)
  if (!email || !raw || !Number.isFinite(orderNumber)) {
    return res.status(400).json({
      message: 'Both an order number and the email used to order are required.',
    })
  }

  const found = await resolveOrder(req.scope, email, orderNumber)
  if (!found) {
    await sleep(400)
    return res.status(404).json(DENY)
  }
  const { order, personalised, open, deliveredAt, countryCode } = found

  const items = (order.items ?? []).map((i: any) => {
    const verdict = eligibility({
      placedAt: order.created_at,
      deliveredAt,
      personalised: personalised.has(i.id),
      alreadyOpen: open.has(i.id),
      countryCode,
    })
    return {
      line_item_id: i.id,
      title: i.product_title ?? i.title,
      variant: i.variant_title ?? null,
      quantity: num(i.quantity),
      subtotal: Math.round(num(i.subtotal) * 100) / 100,
      eligible: verdict.eligible,
      reason: verdict.reason,
      // True only inside the statutory window and only for a destination that has the
      // right. The form uses it to decide whether to offer a change-of-mind option at all.
      withdrawal: verdict.eligible ? verdict.withdrawal : false,
    }
  })

  res.json({
    order: { number: order.display_id, placed_at: order.created_at, delivered_at: deliveredAt },
    // The published stance, so the storefront cannot describe a policy the API does not
    // enforce. /policies/refunds is the same text.
    stance: STANCE,
    window_days: RETURN_WINDOW_DAYS,
    withdrawal_window_days: WITHDRAWAL_WINDOW_DAYS,
    items,
    kinds: KINDS.map((k) => ({ key: k, label: KIND_LABELS[k] })),
    reasons: REASONS,
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // Lower than the read budget: this writes a row and emails a human.
  if (await limited(req, res, 'return-requests', 6, 60_000)) return

  const body = (req.body ?? {}) as Record<string, string>
  const email = String(body.email ?? '').trim().toLowerCase()
  const raw = String(body.order_number ?? '').trim().replace(/^#/, '')
  const orderNumber = Number(raw)

  if (!email || !raw || !Number.isFinite(orderNumber)) {
    return res.status(400).json({
      message: 'Both an order number and the email used to order are required.',
    })
  }

  const kind = KINDS.includes(body.kind as any) ? (body.kind as Kind) : 'fault'
  const reason = REASONS.some((r) => r.key === body.reason) ? body.reason : 'other'

  const found = await resolveOrder(req.scope, email, orderNumber)
  if (!found) {
    await sleep(400)
    return res.status(404).json(DENY)
  }
  const { order, personalised, open, deliveredAt, countryCode } = found

  const line = (order.items ?? []).find((i: any) => i.id === body.line_item_id)
  if (!line) {
    return res.status(400).json({ message: 'That item is not on this order.' })
  }

  // Re-decided here, not trusted from the GET. This is the whole reason the rule lives in
  // one pure function: the page that offers the option and the endpoint that accepts it
  // must not be able to disagree.
  const verdict = eligibility({
    placedAt: order.created_at,
    deliveredAt,
    personalised: personalised.has(line.id),
    alreadyOpen: open.has(line.id),
    countryCode,
  })
  if (!verdict.eligible) {
    return res.status(409).json({ message: verdict.reason })
  }

  /**
   * The reason is checked against the published policy, and the destination decides.
   *
   * Under final sale a change of mind is refused — unless the statutory withdrawal right
   * applies, which no policy can remove. Re-decided here rather than trusted from the GET,
   * so a client that ignores what the form offered is refused rather than creating a row
   * somebody has to decline by hand.
   */
  const allowed = reasonAccepted(reason as string, { withdrawal: verdict.withdrawal })
  if (!allowed.accepted) {
    return res.status(409).json({ message: allowed.message })
  }

  // A withdrawal is only a withdrawal where the right exists.
  if (kind === 'withdrawal' && !verdict.withdrawal) {
    return res.status(409).json({
      message:
        'All sales are final. We only accept returns where the item arrived faulty or ' +
        'damaged, or where we sent the wrong item.',
    })
  }

  const requestedSize = String(body.requested_size ?? '').trim().slice(0, 32)

  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const [created] = await catalog.createReturnRequests([
    {
      order_id: order.id,
      order_display_id: String(order.display_id ?? ''),
      email,
      line_item_id: line.id,
      item_title: line.product_title ?? line.title ?? null,
      kind,
      requested_size: requestedSize || null,
      reason,
      comment: String(body.comment ?? '').trim().slice(0, 1000) || null,
      // §12.4: we pay on a size exchange and on a fault. Recorded at creation so the
      // promise made to the customer is the promise in the row, not a later judgement.
      return_shipping_paid_by: postagePaidBy(kind),
    },
  ])

  try {
    // Wraps the send, never returns from the handler: an early `return` here would
    // abandon the request before res.json() and leave the caller hanging.
    if (await shouldSend(req.scope as never, 'return_received', email)) {
      const notification = req.scope.resolve(Modules.NOTIFICATION)
      await notification.createNotifications({
        to: email,
        channel: 'email',
        template: 'return-received',
        data: {
          order_number: order.display_id,
          item_title: created.item_title,
          kind: created.kind,
          requested_size: created.requested_size,
          we_pay_postage: created.return_shipping_paid_by === 'us',
        },
      })
    }
  } catch (e) {
    req.scope.resolve('logger').error(
      `return-received email failed for ${email}: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  // A return needs a decision from a person, and under a final-sale policy it needs one
  // promptly — the 30-day fault window runs whether or not anyone opened the queue.
  await notifyOps(req.scope as never, 'return_request', {
    headline: `Return requested on ${created.order_display_id ? `#${created.order_display_id}` : 'an order'}`,
    rows: [
      ['Order', created.order_display_id ? `#${created.order_display_id}` : created.order_id],
      ['Item', created.item_title ?? '—'],
      ['Reason', `${created.kind} · ${created.reason}`],
      ['Postage', created.return_shipping_paid_by === 'us' ? 'we pay' : 'customer pays'],
    ],
    quote: created.comment,
    path: '/app/return-requests',
    cta: 'Open the queue',
  })

  res.status(201).json({
    id: created.id,
    status: created.status,
    we_pay_postage: created.return_shipping_paid_by === 'us',
  })
}
