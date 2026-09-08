import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { maskEmail } from '../privacy'
import { shouldSend } from '../message-settings'

/**
 * Somebody wants a guest order attached to their account.
 *
 * Medusa's transfer flow issues a token and emits this event; nothing was listening, so the
 * feature existed in the API and could not complete. This sends the token to **the address on
 * the order**, which is what makes the whole thing safe: knowing an order number is not enough,
 * because the confirmation arrives in the inbox of whoever actually placed it.
 *
 * The link goes to the storefront rather than to an API path — a customer clicking a link in
 * an email should land on a page that explains what is about to happen, not on a JSON
 * response that has already happened.
 */
export default async function orderTransferHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string; token: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: [order] } = await query.graph({
    entity: 'order',
    fields: ['id', 'display_id', 'email', 'customer.email'],
    filters: { id: data.id },
  }).catch(() => ({ data: [] as any[] }))

  if (!order?.email) {
    logger.error(`[order.transfer_requested] no email on order ${data.id}`)
    return
  }

  if (!(await shouldSend(container, 'order_claim', `order #${order.display_id}`))) return

  const base = (process.env.STOREFRONT_URL || 'http://localhost:3000').replace(/\/$/, '')
  const url = `${base}/account/claim?order=${encodeURIComponent(data.id)}` +
              `&token=${encodeURIComponent(data.token)}`

  try {
    const notification = container.resolve(Modules.NOTIFICATION)
    await notification.createNotifications({
      to: order.email,
      channel: 'email',
      template: 'order-claim',
      data: {
        order_number: order.display_id,
        // The requesting account, named so somebody who did not ask can see who did.
        requested_by: (order as any).customer?.email ?? 'a customer account',
        url,
      },
    })
  } catch (e) {
    // Logged with the masked address and never with the token: the token is a credential and
    // the log is the copy that gets shipped to an aggregator and kept.
    logger.error(
      `[order.transfer_requested] could not email ${maskEmail(order.email)}: ` +
      (e instanceof Error ? e.message : String(e))
    )
  }
}

export const config: SubscriberConfig = {
  event: 'order.transfer_requested',
}
