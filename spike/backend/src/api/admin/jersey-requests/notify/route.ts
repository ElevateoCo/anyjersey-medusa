import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../../modules/catalog'
import { maskEmail } from '../../../../privacy'
import { notifyRequesters, productUrl } from '../../../../request-notify'

/**
 * POST /admin/jersey-requests/notify — tell everyone who asked that they can buy it.
 *
 * The queue already ranks demand: twelve people asking for the same shirt are one row. This is
 * the action on that row. Select by demand group (`team` + `player`) or by explicit `ids`,
 * both of which the admin screen has to hand.
 *
 * **A product is required.** The whole point of the message is that the jersey is now
 * purchasable, so an announcement with nothing to buy is worse than no announcement — it
 * spends the one moment these people are paying attention. The product is checked to exist and
 * to be published before a single email goes out, because "we found it" linking to a draft is
 * the same failure one step later.
 *
 * Only `new` and `sourcing` requests are notified. `fulfilled` means they have already been
 * told, and clicking twice must not email twelve people twice.
 */
const NOTIFIABLE = ['new', 'sourcing']
const MAX_BATCH = 500

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const body = (req.body ?? {}) as {
    product_id?: string
    ids?: unknown
    team?: string
    player?: string
    dry_run?: unknown
  }

  // ---------------------------------------------------------------- the product
  const productId = String(body.product_id ?? '').trim()
  if (!productId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      'product_id is required. This message exists to send people to something they can buy.')
  }

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'title', 'handle', 'status'],
    filters: { id: productId } as any,
  })
  const product = (products as any[])[0]
  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `No such product: ${productId}`)
  }
  if (product.status !== 'published') {
    // Checked before sending rather than after. "We found it" pointing at a draft is a dead
    // link sent to everybody who was waiting, and it cannot be unsent.
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      `"${product.title}" is ${product.status}, not published. Publish it first — this email ` +
      'sends people straight to the product page.')
  }

  const url = productUrl(product.handle)
  if (!url) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      'STOREFRONT_URL is not set, so the email would have no link in it. Set it and retry.')
  }

  // ---------------------------------------------------------------- the audience
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : []
  const team = String(body.team ?? '').trim()
  const player = String(body.player ?? '').trim()

  if (!ids.length && !team && !player) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      'Send either ids, or a team and player to notify the whole demand group.')
  }

  const where: Record<string, unknown> = { status: NOTIFIABLE }
  if (ids.length) where.id = ids
  else {
    // Matched the same way the demand list groups them, so what the operator saw ranked on the
    // queue is exactly who receives this.
    if (team) where.team = team
    if (player) where.player = player
  }

  const candidates = await catalog.listJerseyRequests(where, {
    take: MAX_BATCH + 1,
    order: { created_at: 'ASC' },
  })

  if (candidates.length > MAX_BATCH) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      `That selection matches more than ${MAX_BATCH} requests. Narrow it — a send this large ` +
      'is worth doing deliberately rather than by a mistyped filter.')
  }

  /**
   * One message per person, not per request.
   *
   * Somebody who asked three times — from the product page, then the request form, then
   * again a month later — is one person and gets one email. All of their requests are still
   * marked fulfilled, because all of them are.
   */
  const byEmail = new Map<string, any>()
  for (const r of candidates as any[]) {
    if (!byEmail.has(r.email)) byEmail.set(r.email, r)
  }
  const recipients = [...byEmail.values()]

  if (!recipients.length) {
    return res.json({
      product: { id: product.id, title: product.title, url },
      matched: 0, notified: 0, failed: [],
      message: 'Nothing to send — no open requests match that selection.',
    })
  }

  // ---------------------------------------------------------------- dry run
  if (body.dry_run === true || body.dry_run === 'true') {
    return res.json({
      product: { id: product.id, title: product.title, url },
      dry_run: true,
      matched: candidates.length,
      would_notify: recipients.length,
      // Masked. Confirming the size of a send does not require reading the list, and this
      // response is the kind of thing that ends up pasted into a chat window.
      recipients: recipients.map((r) => maskEmail(r.email)),
    })
  }

  // ---------------------------------------------------------------- send
  const { notified, failed } = await notifyRequesters(req, recipients, {
    url, productTitle: product.title,
  })

  /**
   * Mark fulfilled only what actually went.
   *
   * A request whose send failed stays open, so a retry picks it up and the eleven that
   * succeeded are not emailed a second time. Every request from a notified address is closed,
   * not just the one that was used to build the message.
   */
  const notifiedEmails = new Set(
    recipients.filter((r) => notified.includes(r.id)).map((r) => r.email)
  )
  const toClose = (candidates as any[]).filter((r) => notifiedEmails.has(r.email))
  if (toClose.length) {
    await catalog.updateJerseyRequests(
      toClose.map((r) => ({ id: r.id, status: 'fulfilled' }))
    )
  }

  logger.info(
    `[jersey-requests] notified ${notified.length} of ${recipients.length} about ` +
    `"${product.title}"; closed ${toClose.length} request(s)`
  )

  res.json({
    product: { id: product.id, title: product.title, url },
    matched: candidates.length,
    notified: notified.length,
    requests_closed: toClose.length,
    // Named so a retry is possible, masked so the response is not a mailing list.
    failed: failed.map((f) => ({ email: maskEmail(f.email), error: f.error })),
  })
}
