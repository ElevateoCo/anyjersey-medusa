import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import type { MedusaContainer } from '@medusajs/framework/types'
import { CATALOG_MODULE } from './modules/catalog'
import type { NotificationEvent } from './modules/catalog/models/notification-recipient'
import { maskEmail } from './privacy'
import type { OpsData } from './modules/resend/templates'

/**
 * Tell the shop that something happened.
 *
 * Reads `notification_recipient`, filters to the addresses subscribed to this event, and sends
 * one message each. Called from the four places where inbound work arrives — a paid order, a
 * contact message, a sourcing request, a return request — every one of which previously
 * emailed the customer and told nobody here.
 *
 * **It never throws, and it is never awaited in a way that can fail the caller.** An order is
 * paid and recorded before this runs; a contact row is written before this runs. A
 * notification that cannot be sent is a support inconvenience, and letting it roll back the
 * thing it was announcing would be an absurd trade. Every call site already wraps its customer
 * email in a try/catch for exactly this reason and this follows the same rule.
 *
 * Sends are individual. The recipients are colleagues rather than strangers, so the disclosure
 * argument is weaker than it is for a customer bulk send — but one address bouncing should not
 * take the other three with it, which it would in a single multi-recipient message.
 */
const adminUrl = (path: string): string | undefined => {
  // One name, not two. A fallback alias here would mean the same setting could be spelled
  // two ways, and half the deployments would use the one that is not in the template.
  const base = process.env.MEDUSA_ADMIN_URL
  return base ? `${base.replace(/\/$/, '')}${path}` : undefined
}

export async function notifyOps(
  container: MedusaContainer,
  event: NotificationEvent,
  build: OpsData & { path?: string }
): Promise<{ sent: number; failed: number }> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const catalog: any = container.resolve(CATALOG_MODULE)
    const rows = await catalog.listNotificationRecipients({ active: true }, { take: 200 })

    // Filtered here rather than in SQL. The list is a handful of colleagues, so reading it
    // whole and filtering in memory is both faster than a JSON containment query and legible
    // to whoever reads this next.
    const recipients = (rows as any[]).filter((r) =>
      Array.isArray(r.events) && r.events.includes(event))

    if (!recipients.length) return { sent: 0, failed: 0 }

    const notification = container.resolve(Modules.NOTIFICATION)
    const { path, ...data } = build
    const url = path ? adminUrl(path) : undefined

    let sent = 0
    let failed = 0
    for (const recipient of recipients) {
      try {
        await notification.createNotifications({
          to: recipient.email,
          channel: 'email',
          template: 'ops-notification',
          data: { ...data, ...(url ? { url } : {}) },
        })
        sent++
      } catch (e) {
        failed++
        logger.error(
          `[ops-notify] ${event} to ${maskEmail(recipient.email)} failed: ` +
          (e instanceof Error ? e.message : String(e))
        )
      }
    }
    return { sent, failed }
  } catch (e) {
    // The list itself could not be read — the table is missing, the database is unreachable.
    // Reported, never raised: whatever this was announcing has already happened.
    logger.error(
      `[ops-notify] could not dispatch ${event}: ` +
      (e instanceof Error ? e.message : String(e))
    )
    return { sent: 0, failed: 0 }
  }
}

/** Money, for a subject line. Minor units in, human out. */
export const opsMoney = (amount: number, currency = 'USD') =>
  `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`
