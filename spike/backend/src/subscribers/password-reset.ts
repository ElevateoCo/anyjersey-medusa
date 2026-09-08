import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { Modules } from '@medusajs/framework/utils'
import { shouldSend } from '../message-settings'

/**
 * Send the password-reset link.
 *
 * `POST /auth/customer/emailpass/reset-password` answers 201 and emits `auth.password_reset`.
 * It does not send anything itself — without this subscriber the endpoint returns success,
 * the storefront honestly says "a reset link is on its way", and nothing ever arrives. That
 * is the worst shape a failure can take on an auth flow: the customer waits, then contacts
 * support about an account they cannot get into.
 *
 * Two decisions worth recording:
 *
 * **Admin users are ignored here.** `actor_type` distinguishes a customer from an admin, and
 * this handler answers only for customers. Sending an admin a link into the storefront's
 * reset page would produce a token that cannot be redeemed there.
 *
 * **The link is built from `STOREFRONT_URL`, not from the request.** A reset URL derived from
 * a `Host` header is a redirect an attacker can choose, and this link is a credential. An
 * absent variable falls back to localhost and logs loudly rather than emitting a link to
 * nowhere.
 */
export default async function passwordResetHandler({
  event: { data },
  container,
}: SubscriberArgs<{ entity_id: string; token: string; actor_type: string }>) {
  const logger = container.resolve('logger')

  // Customers only. An admin reset goes to the admin app, which is a different flow.
  if (data.actor_type !== 'customer') return

  const email = data.entity_id
  const base = (process.env.STOREFRONT_URL || 'http://localhost:3000').replace(/\/$/, '')
  if (!process.env.STOREFRONT_URL) {
    logger.warn(
      '[auth.password_reset] STOREFRONT_URL is not set — the reset link points at ' +
      'localhost:3000. Fine in development, useless in production.'
    )
  }

  const url =
    `${base}/account/reset?token=${encodeURIComponent(data.token)}` +
    `&email=${encodeURIComponent(email)}`

  // Switchable, and the confirmation dialog says what that costs: there is no admin "send
  // reset" button and no other route back into an account, so this being off locks out
  // anybody who forgets their password, permanently.
  if (!(await shouldSend(container, 'password_reset', `a reset for ${email}`))) return

  try {
    const notification = container.resolve(Modules.NOTIFICATION)
    await notification.createNotifications({
      to: email,
      channel: 'email',
      template: 'password-reset',
      data: { url, email, expires_in: '15 minutes' },
    })
  } catch (e) {
    // Logged with the address but never with the token: the log is the one place a
    // credential must not end up, because it is the copy that gets shipped to a log
    // aggregator and kept.
    logger.error(
      `[auth.password_reset] could not send the reset email to ${email}: ` +
      (e instanceof Error ? e.message : String(e))
    )
  }
}

export const config: SubscriberConfig = {
  event: 'auth.password_reset',
}
