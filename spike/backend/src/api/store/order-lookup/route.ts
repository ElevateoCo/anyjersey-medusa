import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { limited } from '../../../rate-limit'

/**
 * POST /store/order-lookup  { email, order_number }
 *
 * There are no customer accounts, so without this every "where is my order?" becomes a
 * support email. anyjersey.com has "Track Your Order" in its nav for the same reason.
 *
 * Security shape, because this is an unauthenticated endpoint over customer data:
 *
 *   - **Both** the order number and the matching email are required. Either alone tells
 *     you nothing.
 *   - The response is identical whether the order does not exist or the email does not
 *     match, so it cannot be used to enumerate order numbers or confirm an address.
 *   - Only fields the customer already knows are returned — their own items, totals,
 *     status and shipping address. No internal ids, no payment detail, no notes.
 *   - A small deliberate delay on failure, so response timing does not leak either.
 *   - **Rate limited.** The four properties above make one guess useless; they do not make
 *     a million guesses useless. Display ids are sequential, so an attacker who knows one
 *     address only has to walk the numbers, and the failure delay that defeats timing
 *     analysis is not a cost worth paying to a script running in parallel. Ten attempts a
 *     minute is generous for a customer who has the email in front of them and ruinous for
 *     a walk of the id space.
 */
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0))
  return Number.isFinite(n) ? n : 0
}

const DENY = { message: 'No order matches that number and email.' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (await limited(req, res, 'order-lookup', 10, 60_000)) return

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const body = (req.body ?? {}) as { email?: string; order_number?: string | number }

  const email = String(body.email ?? '').trim().toLowerCase()
  const raw = String(body.order_number ?? '').trim().replace(/^#/, '')
  const orderNumber = Number(raw)

  if (!email || !raw || !Number.isFinite(orderNumber)) {
    return res.status(400).json({
      message: 'Both an order number and the email used to order are required.',
    })
  }

  const { data: orders } = await query.graph({
    entity: 'order',
    fields: [
      'id', 'display_id', 'email', 'created_at', 'status', 'currency_code', 'version',
      'total', 'subtotal', 'shipping_total', 'tax_total',
      'items.*',
      'shipping_address.first_name', 'shipping_address.last_name',
      'shipping_address.address_1', 'shipping_address.city',
      'shipping_address.province', 'shipping_address.postal_code',
      'shipping_address.country_code',
      'fulfillments.id', 'fulfillments.shipped_at', 'fulfillments.delivered_at',
      'fulfillments.labels.tracking_number', 'fulfillments.labels.tracking_url',
    ],
    filters: { display_id: orderNumber } as any,
    pagination: { take: 1, skip: 0 },
  }).catch(() => ({ data: [] as any[] }))

  const order = (orders as any[])[0]

  // One response for "no such order" and "wrong email" — otherwise this enumerates.
  if (!order || String(order.email ?? '').toLowerCase() !== email) {
    await sleep(400)
    return res.status(404).json(DENY)
  }

  const fulfil = (order.fulfillments ?? [])[0]
  const tracking = (fulfil?.labels ?? [])[0]

  res.json({
    order: {
      number: order.display_id,
      placed_at: order.created_at,
      status: fulfil?.delivered_at ? 'delivered'
        : fulfil?.shipped_at ? 'shipped'
        : 'processing',
      shipped_at: fulfil?.shipped_at ?? null,
      delivered_at: fulfil?.delivered_at ?? null,
      tracking_number: tracking?.tracking_number ?? null,
      tracking_url: tracking?.tracking_url ?? null,
      currency: (order.currency_code ?? 'usd').toUpperCase(),
      items: (order.items ?? []).map((i: any) => ({
        title: i.product_title ?? i.title,
        variant: i.variant_title ?? null,
        quantity: num(i.quantity),
        subtotal: Math.round(num(i.subtotal) * 100) / 100,
      })),
      subtotal: Math.round(num(order.subtotal) * 100) / 100,
      shipping: Math.round(num(order.shipping_total) * 100) / 100,
      tax: Math.round(num(order.tax_total) * 100) / 100,
      total: Math.round(num(order.total) * 100) / 100,
      ship_to: order.shipping_address
        ? {
            name: [order.shipping_address.first_name, order.shipping_address.last_name]
              .filter(Boolean).join(' '),
            city: order.shipping_address.city,
            province: order.shipping_address.province,
            postal_code: order.shipping_address.postal_code,
            country: order.shipping_address.country_code?.toUpperCase(),
          }
        : null,
    },
  })
}
