import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { Modules } from '@medusajs/framework/utils'
import { zoneForRegionName } from '../shipping-zones'
import { maskEmail } from '../privacy'
import { notifyOps, opsMoney } from '../ops-notify'
import { shouldSend } from '../message-settings'
import { CATALOG_MODULE } from '../modules/catalog'
import { LINE_REF_KEY } from '../api/store/personalisation/attach/route'

/**
 * Proves the rule that matters most in research.md §5.2: the order is created by the
 * webhook, not the browser. This subscriber fires off the back of Medusa's own
 * order.placed event, which is reached via the Stripe webhook at
 * /hooks/payment/stripe_stripe — not via the success redirect.
 *
 * Everything downstream of a paid order hangs here: confirmation email, carrier label,
 * search index update, and (Phase 2) the personalisation print job.
 */
/** Thrown to leave the send block early when the message is switched off. */
class SkipSend extends Error {}

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve('logger')
  const query = container.resolve('query')
  const notification = container.resolve(Modules.NOTIFICATION)

  const { data: [order] } = await query.graph({
    entity: 'order',
    fields: [
      'id', 'display_id', 'email', 'currency_code', 'total', 'subtotal',
      'shipping_total', 'tax_total',
      // `items.*`, not a list of item fields.
      //
      // Medusa does not resolve computed line-item fields when they are requested
      // individually — `items.quantity` and `items.subtotal` come back undefined, which is
      // why the log block and the confirmation email have been printing "undefined×" next to
      // every line. `items.metadata` behaves the same way, and that is what stopped the
      // personalisation link below from finding anything.
      'items.*', 'shipping_address.country_code',
      'payment_collections.status', 'payment_collections.amount',
      'region.name',
    ],
    filters: { id: data.id },
  })

  if (!order) {
    logger.error(`[order.placed] order ${data.id} not found`)
    return
  }

  // Money is minor units everywhere (research.md §6.2 trap 1).
  const fmt = (n: number) => `${(n / 100).toFixed(2)} ${order.currency_code?.toUpperCase()}`

  logger.info(
    [
      '',
      '  ┌─ ORDER CREATED VIA WEBHOOK ─────────────────────────────',
      `  │ order      #${order.display_id} (${order.id})`,
      // Masked. The order id identifies the order; the address adds nothing here and this
      // line is retained for ninety days and shipped wherever the platform sends logs.
      // Data minimisation applies to the observability surface too — it is the one people
      // forget, because a log feels private and is not.
      `  │ email      ${maskEmail(order.email)}`,
      `  │ subtotal   ${fmt(order.subtotal ?? 0)}`,
      `  │ shipping   ${fmt(order.shipping_total ?? 0)}`,
      `  │ tax        ${fmt(order.tax_total ?? 0)}`,
      `  │ total      ${fmt(order.total ?? 0)}`,
      ...(order.items ?? []).map(
        (i: any) => `  │ item       ${i.quantity}× ${i.variant_sku ?? '—'}  ${i.title}`
      ),
      `  │ payment    ${(order.payment_collections ?? [])
        .map((p: any) => p.status)
        .join(', ') || 'none'}`,
      '  └─────────────────────────────────────────────────────────',
      '',
    ].join('\n')
  )

  // ---------------------------------------------------------------- confirmation email
  // Sent from here, off order.placed, which is reached through the Stripe webhook — so
  // the email follows the order rather than the browser (research.md §5.2 rule 2).
  //
  // Wrapped: a failed send must never fail the order. The order is already paid and
  // recorded; a missing email is a support problem, not a data-integrity one.
  try {
    // The switch. Checked here rather than inside the notification module so the log line
    // names the order it suppressed, which is what somebody chasing "I never got a receipt"
    // actually needs.
    if (!(await shouldSend(container, 'order_placed', `order #${order.display_id}`))) {
      throw new SkipSend()
    }
    const zone = zoneForRegionName((order as any).region?.name)
    await notification.createNotifications({
      to: order.email!,
      channel: 'email',
      template: 'order-placed',
      data: {
        display_id: order.display_id,
        email: order.email,
        currency_code: order.currency_code,
        items: (order.items ?? []).map((i: any) => ({
          title: i.title,
          variant_title: i.variant_title ?? null,
          quantity: i.quantity,
          subtotal: i.subtotal ?? 0,
        })),
        subtotal: order.subtotal ?? 0,
        shipping_total: order.shipping_total ?? 0,
        tax_total: order.tax_total ?? 0,
        total: order.total ?? 0,
        lead_time: zone?.leadTime ?? null,
      },
    })
  } catch (e) {
    // A deliberate suppression is not a failure and must not be logged as one — the switch
    // has already said so, once, with the order number attached.
    if (!(e instanceof SkipSend)) {
      logger.error(
        `[order.placed] confirmation email failed for ${order.id}: ` +
        `${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  // Tell the shop. Previously nothing did: a paid order emailed the customer and nobody
  // here. Never awaited in a way that can fail the order — it is already paid and recorded.
  await notifyOps(container, 'order_placed', {
    headline: `New order #${order.display_id} — ${opsMoney(order.total ?? 0, order.currency_code)}`,
    rows: [
      ['Order', `#${order.display_id}`],
      ['Total', opsMoney(order.total ?? 0, order.currency_code)],
      ['Items', String((order.items ?? []).reduce((n: number, i: any) => n + i.quantity, 0))],
      ['Customer', order.email ?? '—'],
      ['Ships to', (order as any).shipping_address?.country_code?.toUpperCase() ?? '—'],
    ],
    path: `/app/orders/${order.id}`,
    cta: 'Open the order',
  })

  await promotePersonalisations(container, order, logger)

  // Still to come, Phase 3:
  //   - carrier label (Shippo/EasyPost)
  //   - search index update
  //   - personalisation print file, once the supplier's format is known
}

/**
 * Attach every personalisation on this order to the order line it belongs to.
 *
 * This is the writer that was missing. `line_personalisation.order_id` and `order_line_id`
 * were indexed, queried in two places and set by nothing, because a cart line's id does not
 * survive checkout — Medusa builds fresh order line items. The consequence reached the
 * customer: `GET /store/return-requests` decides whether a line is made-to-order by looking
 * for personalisations carrying that `order_id`, found none, and offered a refund on a
 * shirt with someone's name printed on it.
 *
 * The join is the ref the attach endpoint wrote into the cart line's metadata, which
 * `prepareLineItemData` copies verbatim onto the order line.
 *
 * **It does not throw.** The order is paid and recorded by the time this runs; a failure
 * here must not roll that back or retry the confirmation email. What it does instead is log
 * loudly, because a personalisation that cannot be tied to an order is a shirt somebody has
 * paid to have printed and nobody can print.
 */
async function promotePersonalisations(
  container: SubscriberArgs<{ id: string }>['container'],
  order: any,
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void }
) {
  const items = (order.items ?? []) as any[]

  // Map every ref carried by this order back to the line that carries it.
  const lineByRef = new Map<string, string>()
  for (const item of items) {
    const ref = (item.metadata ?? {})[LINE_REF_KEY]
    if (typeof ref === 'string' && ref) lineByRef.set(ref, item.id)
  }
  if (!lineByRef.size) return

  try {
    const catalog: any = container.resolve(CATALOG_MODULE)
    const rows = await catalog.listLinePersonalisations({ line_ref: [...lineByRef.keys()] })

    if (!rows.length) {
      // An order line says it is personalised and no row answers to it. Worth an error
      // rather than silence: the customer has been charged for printing.
      logger.error(
        `[order.placed] order ${order.id} carries ${lineByRef.size} personalisation ref(s) ` +
        `and no matching rows were found. Nothing will be printed for it.`
      )
      return
    }

    await catalog.updateLinePersonalisations(
      rows.map((r: any) => ({
        id: r.id,
        order_id: order.id,
        order_line_id: lineByRef.get(r.line_ref),
      }))
    )

    // Reported per order rather than per row: an operator wants to know that this order's
    // prints are queued, not that four rows were touched.
    const linked = new Set(rows.map((r: any) => r.line_ref)).size
    logger.info(
      `[order.placed] linked ${rows.length} personalisation(s) across ${linked} line(s) ` +
      `to order #${order.display_id}`
    )

    if (linked < lineByRef.size) {
      logger.warn(
        `[order.placed] order ${order.id} has ${lineByRef.size - linked} personalised ` +
        `line(s) with no personalisation rows. Check the print queue before fulfilling.`
      )
    }
  } catch (e) {
    logger.error(
      `[order.placed] could not link personalisations to order ${order.id}: ` +
      `${e instanceof Error ? e.message : String(e)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: 'order.placed',
}
