import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, Modules, MedusaError } from '@medusajs/framework/utils'
import { isSuppressed, unsubscribeUrl } from '../../../../../suppression'
import { maskEmail } from '../../../../../privacy'

/**
 * POST /admin/abandoned-carts/:id/recover
 *
 * Sends one recovery email and stamps the cart so it is never sent twice. Idempotent by
 * design: a duplicate "you left something behind" email is a good way to lose the customer you
 * were trying to recover.
 *
 * **This is the only commercial email the shop sends**, and the three checks below are what
 * that costs. Everything else here is transactional — a receipt, an acknowledgement, a reset —
 * and needs none of them. This one goes to somebody who did not buy, to persuade them to,
 * which changes the rules:
 *
 *   1. **Suppression.** Anyone who has unsubscribed from anything must never receive it.
 *      Marketing-wide, not per-list: somebody who left the newsletter has refused marketing,
 *      and sending them a basket reminder because it came from a different code path would be
 *      a distinction only the sender can see.
 *   2. **An unsubscribe link.** PECR's soft opt-in — the basis for mailing an address given
 *      during a checkout — is conditional on offering a simple means of refusing in *every*
 *      message. No link, no basis, so no send.
 *   3. **A postal address.** CAN-SPAM requires one on commercial email. Refusing without it is
 *      the same call this codebase makes everywhere else about pending trader fields: a
 *      missing regulatory value is not a formatting problem, and inventing one is a false
 *      statement.
 *
 * All three refuse *before* sending rather than degrading, because an email cannot be unsent.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const notification = req.scope.resolve(Modules.NOTIFICATION)
  const cartModule = req.scope.resolve(Modules.CART)
  const logger = req.scope.resolve('logger')

  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: ['id', 'email', 'completed_at', 'currency_code', 'metadata', 'items.*'],
    filters: { id: req.params.id },
  })
  const cart = carts[0] as any

  if (!cart) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Cart not found')
  if (cart.completed_at) {
    return res.status(409).json({ message: 'That cart was completed — nothing to recover.' })
  }
  if (!cart.email) {
    return res.status(409).json({ message: 'No email on that cart.' })
  }
  if (cart.metadata?.recovery_sent_at && req.query.force !== 'true') {
    return res.status(409).json({
      message: `Already contacted at ${cart.metadata.recovery_sent_at}. Pass ?force=true to send again.`,
    })
  }

  // ---------------------------------------------------------------- consent
  // Not overridable by `force`. That flag exists to resend to somebody who did not reply; it
  // is not a way past somebody who said no.
  if (await isSuppressed(req.scope as never, cart.email)) {
    return res.status(409).json({
      message:
        `${maskEmail(cart.email)} has unsubscribed from marketing. This is the one email ` +
        'here that needs consent, and there is no override — the basket stays recoverable ' +
        'if they come back on their own.',
      suppressed: true,
    })
  }

  const unsubscribe = unsubscribeUrl(cart.email)
  if (!unsubscribe) {
    return res.status(409).json({
      message:
        'STOREFRONT_URL is not set, so the email would carry no unsubscribe link. That link ' +
        'is the condition the legal basis for this message rests on, not a nicety — set it ' +
        'and retry.',
    })
  }

  const postalAddress = (process.env.SHOP_POSTAL_ADDRESS ?? '').trim()
  if (!postalAddress) {
    return res.status(409).json({
      message:
        'SHOP_POSTAL_ADDRESS is not set. A commercial email needs a physical postal address ' +
        '(CAN-SPAM), and this shop has no registered address recorded anywhere yet — the ' +
        'policy pages show it as outstanding too. Set it, and keep it identical to ' +
        'NEXT_PUBLIC_LEGAL_ADDRESS on the storefront.',
      outstanding: 'SHOP_POSTAL_ADDRESS',
    })
  }

  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0))
    return Number.isFinite(n) ? n : 0
  }

  try {
    await notification.createNotifications({
      to: cart.email,
      channel: 'email',
      template: 'cart-recovery',
      data: {
        cart_id: cart.id,
        currency_code: cart.currency_code,
        items: (cart.items ?? []).map((i: any) => ({
          title: i.product_title ?? i.title,
          variant_title: i.variant_title ?? null,
          quantity: num(i.quantity),
          subtotal: num(i.subtotal),
        })),
        value: (cart.items ?? []).reduce((n: number, i: any) => n + num(i.subtotal), 0),
        // Both are required by the template, which sets List-Unsubscribe from the first.
        unsubscribe_url: unsubscribe,
        postal_address: postalAddress,
      },
    })
  } catch (e) {
    logger.error(`recovery email failed for ${cart.id}: ${e instanceof Error ? e.message : e}`)
    return res.status(502).json({ message: 'Email provider rejected the send.' })
  }

  const stamp = new Date().toISOString()
  await cartModule.updateCarts(cart.id, {
    metadata: { ...(cart.metadata ?? {}), recovery_sent_at: stamp },
  })

  res.json({ id: cart.id, recovery_sent_at: stamp })
}
