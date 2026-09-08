import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { Modules } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../modules/catalog'
import { limited } from '../../../rate-limit'
import { shouldSend } from '../../../message-settings'
import { notifyOps } from '../../../ops-notify'

/**
 * POST /store/contact  { email, name?, phone?, body }
 *
 * The contact form. Unauthenticated and public, so it carries the same shape as
 * `/store/jersey-requests`: a rate limit, a length cap, and a row that is the record while
 * the email is only a courtesy.
 *
 * The live store's version of this page emails a mailbox and stores nothing. Storing the row
 * first is the difference between "we never got your message" being arguable and being
 * checkable.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // Lower than the jersey-request budget: this one reaches a human inbox.
  if (await limited(req, res, 'contact', 5, 60_000)) return

  const body = (req.body ?? {}) as Record<string, string>
  const email = String(body.email ?? '').trim().toLowerCase()
  const message = String(body.body ?? '').trim()

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ message: 'A valid email is required.' })
  }
  if (message.length < 2) {
    return res.status(400).json({ message: 'Tell us what you need.' })
  }

  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const [created] = await catalog.createInboundMessages([
    {
      kind: 'contact',
      email,
      name: String(body.name ?? '').trim().slice(0, 120) || null,
      phone: String(body.phone ?? '').trim().slice(0, 40) || null,
      body: message.slice(0, 4000),
      source: String(body.source ?? 'contact').slice(0, 60),
    },
  ])

  // Acknowledged by email, and a failed send must not fail the message — the row is what
  // matters. Same rule as the order confirmation and the jersey request.
  try {
    // Wraps the send, never returns from the handler: an early `return` here would
    // abandon the request before res.json() and leave the caller hanging.
    if (await shouldSend(req.scope as never, 'contact_received', email)) {
      const notification = req.scope.resolve(Modules.NOTIFICATION)
      await notification.createNotifications({
        to: email,
        channel: 'email',
        template: 'contact-received',
        data: { name: created.name, body: created.body },
      })
    }
  } catch (e) {
    req.scope.resolve('logger').error(
      `contact-received email failed for ${email}: ` +
      (e instanceof Error ? e.message : String(e))
    )
  }

  // The gap this closes was the clearest of the four: somebody wrote in, the shop replied
  // "we got your message" automatically, and no human was told a message had arrived.
  await notifyOps(req.scope as never, 'contact_received', {
    headline: `Contact from ${created.name || email}`,
    rows: [
      ['From', created.name ? `${created.name} <${email}>` : email],
      ['Subject', String((req.body as any)?.subject ?? '—').slice(0, 120)],
      ...(created.phone ? [['Phone', created.phone] as [string, string]] : []),
    ],
    quote: created.body,
    path: '/app/inbound-messages',
    cta: 'Open the inbox',
  })

  res.status(201).json({ id: created.id, status: created.status })
}
