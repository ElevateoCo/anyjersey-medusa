import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { CATALOG_MODULE } from '../../../modules/catalog'

/**
 * GET /admin/inbound-messages — the inbox that did not exist.
 *
 * `/store/contact` has been writing rows since the contact page shipped, and nothing in the
 * admin read them: the newsletter route queried the table only to de-duplicate an address.
 * Every contact submission was therefore write-only, and the single copy anyone actually saw
 * was the Resend notification — which made an email provider the sole point of failure for
 * customer contact, on a store whose refund policy tells people to write in.
 *
 * Contact and newsletter share this table because they are the same shape — an address and a
 * consent state — but they are read differently, so `kind` is a first-class filter and the
 * counts are reported per kind rather than as one total.
 */
const KINDS = ['contact', 'newsletter'] as const
const STATUSES = ['new', 'answered', 'closed'] as const

const intParam = (v: unknown, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && String(v ?? '') !== '' ? n : fallback
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)

  const limit = Math.min(Math.max(intParam(req.query.limit, 25), 1), 100)
  const offset = Math.max(intParam(req.query.offset, 0), 0)

  const where: Record<string, unknown> = {}
  if (KINDS.includes(req.query.kind as never)) where.kind = req.query.kind
  if (STATUSES.includes(req.query.status as never)) where.status = req.query.status
  if (req.query.email) where.email = String(req.query.email).trim().toLowerCase()
  // Subscribers who have opted out are excluded by default: a marketing list read with them
  // in it is how somebody gets emailed after unsubscribing.
  if (where.kind === 'newsletter' && req.query.include_unsubscribed !== 'true') {
    where.unsubscribed_at = null
  }

  const [messages, count] = await catalog.listAndCountInboundMessages(where, {
    skip: offset,
    take: limit,
    order: { created_at: 'DESC' },
  })

  // Counted over the whole table rather than the page, because the number an operator wants
  // is "how much unanswered contact is there", not "how much on this screen".
  const all = await catalog.listInboundMessages(
    {}, { select: ['kind', 'status', 'unsubscribed_at'], take: 100000 }
  )
  const tally = (kind: string, status?: string) =>
    (all as any[]).filter((m) =>
      m.kind === kind && (status ? m.status === status : true)).length

  res.json({
    messages,
    count,
    limit,
    offset,
    health: {
      contact_total: tally('contact'),
      contact_new: tally('contact', 'new'),
      newsletter_total: tally('newsletter'),
      newsletter_subscribed: (all as any[])
        .filter((m) => m.kind === 'newsletter' && !m.unsubscribed_at).length,
    },
    statuses: STATUSES,
    kinds: KINDS,
  })
}
