import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { CATALOG_MODULE } from '../../../modules/catalog'
import { limited } from '../../../rate-limit'

/**
 * POST   /store/newsletter  { email }        subscribe
 * DELETE /store/newsletter?email=            unsubscribe
 *
 * Marketing consent, so three things are structural rather than incidental:
 *
 *  1. **The same answer whether or not the address is already subscribed.** Reporting "you
 *     are already on the list" turns a public form into a way to test which addresses have
 *     shopped here — the same enumeration problem the password reset has.
 *  2. **Unsubscribe suppresses, it does not delete.** The defensible record under GDPR and
 *     the US state laws is when consent was given and when it was withdrawn; a deleted row
 *     cannot show that an address was suppressed rather than never collected.
 *  3. **`consented_at` is set here, from the request**, not backfilled later. A consent
 *     timestamp that was written by a migration is not evidence of anything.
 *
 * Nothing is sent yet: no marketing provider is configured (`OMNISEND_API_KEY` is a
 * placeholder). The list is collected so it exists when one is — which is the right order,
 * because a subscriber acquired today cannot be acquired retrospectively.
 */
const OK = { ok: true, message: 'Thanks — you are on the list.' }

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (await limited(req, res, 'newsletter', 5, 60_000)) return

  const body = (req.body ?? {}) as Record<string, string>
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ message: 'Enter a valid email address.' })
  }

  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const existing = await catalog.listInboundMessages(
    { kind: 'newsletter', email }, { take: 1 }
  ).catch(() => [])

  if (existing.length) {
    // Already known. If they had unsubscribed, this is a re-subscribe and the consent
    // timestamp moves; otherwise nothing changes. Either way the answer is identical.
    if (existing[0].unsubscribed_at) {
      await catalog.updateInboundMessages({
        id: existing[0].id, unsubscribed_at: null, consented_at: new Date(),
      })
    }
    return res.status(201).json(OK)
  }

  await catalog.createInboundMessages([
    {
      kind: 'newsletter',
      email,
      source: String(body.source ?? 'footer').slice(0, 60),
      consented_at: new Date(),
    },
  ])

  res.status(201).json(OK)
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  if (await limited(req, res, 'newsletter', 10, 60_000)) return

  const email = String(req.query.email ?? '').trim().toLowerCase()
  if (!email) return res.status(400).json({ message: 'An email address is required.' })

  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const rows = await catalog.listInboundMessages({ kind: 'newsletter', email }, { take: 1 })
    .catch(() => [])
  if (rows.length && !rows[0].unsubscribed_at) {
    await catalog.updateInboundMessages({ id: rows[0].id, unsubscribed_at: new Date() })
  }
  // Same answer whether or not they were on the list.
  res.json({ ok: true, message: 'You will not receive marketing email from us.' })
}
