import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import type { MedusaRequest } from '@medusajs/framework/http'
import { maskEmail } from './privacy'

/**
 * Telling people who asked for a jersey that they can now buy it.
 *
 * The sourcing queue has always grouped requests by demand — twelve people asking for the
 * same Kobe shirt are one row on the admin screen, ranked above a shirt one person asked
 * about. Acting on that was the part that did not exist: marking a request `fulfilled` emailed
 * exactly one person, so sourcing a shirt twelve people wanted meant opening twelve rows.
 *
 * Worse, the email it sent had nowhere to go. The `request-sourced` template takes a `url` and
 * renders a "View it" button; the route never passed one, so the one message whose entire job
 * is to turn demand into a purchase arrived with no way to purchase.
 *
 * Both are fixed here, and this module is shared so the single-request path and the bulk one
 * cannot drift into sending different things.
 */

/** A product link, or null when the storefront origin is unknown. */
export function productUrl(handle: string): string | null {
  const base = process.env.STOREFRONT_URL
  if (!base) return null
  return `${base.replace(/\/$/, '')}/jerseys/${handle}`
}

export type Notifiable = {
  id: string
  email: string
  raw_request: string
  team?: string | null
  player?: string | null
  size_code?: string | null
}

export type NotifyOutcome = {
  notified: string[]
  failed: { id: string; email: string; error: string }[]
}

/**
 * Send one message per recipient.
 *
 * **Individually, never a single message with many recipients.** A bulk notification is the
 * classic way to disclose one customer's address to another, and the people on this list have
 * no relationship with each other — they happen to want the same shirt. There is no batching
 * API used here for that reason, and it is worth the extra calls.
 *
 * A failure is collected rather than thrown. Eleven people should still hear about the shirt
 * when the twelfth address bounces, and the caller needs to know which one to retry — so the
 * request whose send failed is deliberately left alone rather than marked fulfilled.
 */
export async function notifyRequesters(
  req: MedusaRequest,
  requests: Notifiable[],
  opts: { url: string | null; productTitle: string }
): Promise<NotifyOutcome> {
  const notification = req.scope.resolve(Modules.NOTIFICATION)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const notified: string[] = []
  const failed: { id: string; email: string; error: string }[] = []

  for (const request of requests) {
    try {
      await notification.createNotifications({
        to: request.email,
        channel: 'email',
        template: 'request-sourced',
        data: {
          // Their own words back to them. Twelve people asked for the same shirt in twelve
          // different ways, and "the jersey you asked for" is only reassuring if it quotes
          // the thing they actually typed.
          raw_request: request.raw_request,
          team: request.team,
          player: request.player,
          size_code: request.size_code,
          product_title: opts.productTitle,
          ...(opts.url ? { url: opts.url } : {}),
        },
      })
      notified.push(request.id)
    } catch (e) {
      failed.push({
        id: request.id,
        email: request.email,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  if (failed.length) {
    // Masked: this line outlives the send and goes wherever the platform ships logs.
    logger.error(
      `[jersey-requests] ${failed.length} of ${requests.length} notifications failed: ` +
      failed.map((f) => `${maskEmail(f.email)} (${f.error})`).join(', ')
    )
  }

  return { notified, failed }
}
