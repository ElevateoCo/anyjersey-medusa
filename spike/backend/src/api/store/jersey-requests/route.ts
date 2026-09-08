import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { Modules } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../modules/catalog'
import { limited } from '../../../rate-limit'
import { shouldSend } from '../../../message-settings'
import { notifyOps } from '../../../ops-notify'

/**
 * POST /store/jersey-requests
 *
 * "Can't find your jersey? Request it — we'll source it for you fast."
 * The store's differentiator (research.md §12.1). Every row is a customer naming what to
 * source next, with an email attached.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // A public POST that writes a row. Ten a minute is far above any real customer and far
  // below what a script would want. See src/rate-limit.ts for what this does and does not
  // guarantee across instances.
  if (await limited(req, res, 'jersey-requests', 10, 60_000)) return

  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const body = (req.body ?? {}) as Record<string, string>

  const email = (body.email ?? '').trim()
  const raw = (body.raw_request ?? '').trim()

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ message: 'A valid email is required.' })
  }
  if (raw.length < 3) {
    return res.status(400).json({ message: 'Tell us which jersey you are looking for.' })
  }

  const [created] = await catalog.createJerseyRequests([
    {
      email,
      raw_request: raw.slice(0, 500),
      team: body.team || null,
      player: body.player || null,
      colourway: body.colourway || null,
      season: body.season || null,
      size_code: body.size_code || null,
      garment: body.garment || 'jersey',
      source: ['homepage', 'product', 'search_empty', 'collection'].includes(body.source)
        ? body.source
        : 'homepage',
      source_product_id: body.source_product_id || null,
    },
  ])

  // Acknowledge the request by email. Same rule as the order confirmation: a failed
  // send must not fail the request — the row is what matters, the email is courtesy.
  try {
    // Wraps the send, never returns from the handler: an early `return` here would
    // abandon the request before res.json() and leave the caller hanging.
    if (await shouldSend(req.scope as never, 'request_received', created.email)) {
      const notification = req.scope.resolve(Modules.NOTIFICATION)
      await notification.createNotifications({
        to: email,
        channel: 'email',
        template: 'request-received',
        data: { raw_request: created.raw_request, team: created.team, player: created.player },
      })
    }
  } catch (e) {
    req.scope.resolve('logger').error(
      `request-received email failed for ${email}: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  // Demand is the whole proposition — "ask us and we'll source it" — and nobody was told
  // when somebody asked.
  await notifyOps(req.scope as never, 'jersey_request', {
    headline: `Jersey request: ${[created.player, created.team].filter(Boolean).join(' · ') || 'unspecified'}`,
    rows: [
      ['From', created.email],
      ...(created.team ? [['Team', created.team] as [string, string]] : []),
      ...(created.player ? [['Player', created.player] as [string, string]] : []),
      ...(created.size_code ? [['Size', created.size_code] as [string, string]] : []),
      ['Source', created.source ?? '—'],
    ],
    quote: created.raw_request,
    path: '/app/jersey-requests',
    cta: 'Open the queue',
  })

  res.status(201).json({ id: created.id, status: created.status })
}
