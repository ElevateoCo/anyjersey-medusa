import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

/**
 * GET /admin/abandoned-carts?hours=1&max_days=30
 *
 * Shopify has this natively; Medusa does not (§15.3). A cart counts as abandoned when it
 * has items, an email to reach the customer, no completed order, and has been idle longer
 * than `hours`.
 *
 * The one-hour floor matters: mailing somebody who is still mid-checkout is worse than
 * not mailing them at all.
 */
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0))
  return Number.isFinite(n) ? n : 0
}

/**
 * `Number(x) || fallback` is wrong whenever 0 is a legitimate value — 0 is falsy, so it
 * silently becomes the fallback. `hours=0` became `hours=1` and excluded every cart
 * younger than an hour: 3 results instead of 66.
 */
const intParam = (v: unknown, fallback: number) => {
  if (v === undefined || v === null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const hours = Math.max(intParam(req.query.hours, 1), 0)
  const maxDays = Math.min(Math.max(intParam(req.query.max_days, 30), 1), 365)
  const idleBefore = Date.now() - hours * 3_600_000
  const after = Date.now() - maxDays * 86_400_000

  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: [
      // Cart-level totals must be requested or the per-item subtotals do not compute —
      // every cart came back with a value of $0 without them.
      'id', 'email', 'created_at', 'updated_at', 'completed_at', 'currency_code',
      'total', 'subtotal', 'item_total',
      'items.*', 'region.name',
    ],
    pagination: { take: 100000, skip: 0 },
  })

  const rows = (carts as any[])
    .filter((c) => !c.completed_at)
    .filter((c) => (c.items ?? []).length > 0)
    .filter((c) => !!c.email)
    .filter((c) => {
      const t = new Date(c.updated_at ?? c.created_at).getTime()
      return t <= idleBefore && t >= after
    })
    .map((c) => {
      const value = num(c.item_total) ||
        (c.items ?? []).reduce((n: number, i: any) => n + num(i.subtotal), 0)
      return {
        id: c.id,
        email: c.email,
        created_at: c.created_at,
        updated_at: c.updated_at,
        region: c.region?.name ?? null,
        currency: (c.currency_code ?? 'usd').toUpperCase(),
        items: (c.items ?? []).map((i: any) => ({
          title: i.product_title ?? i.title,
          variant: i.variant_title ?? null,
          quantity: num(i.quantity),
          subtotal: Math.round(num(i.subtotal) * 100) / 100,
        })),
        units: (c.items ?? []).reduce((n: number, i: any) => n + num(i.quantity), 0),
        value: Math.round(value * 100) / 100,
        idle_hours: Math.round((Date.now() - new Date(c.updated_at ?? c.created_at).getTime()) / 3_600_000),
        recovery_sent_at: c.metadata?.recovery_sent_at ?? null,
      }
    })
    .sort((a, b) => b.value - a.value)

  res.json({
    abandoned_carts: rows,
    summary: {
      count: rows.length,
      value: Math.round(rows.reduce((n, r) => n + r.value, 0) * 100) / 100,
      units: rows.reduce((n, r) => n + r.units, 0),
      never_contacted: rows.filter((r) => !r.recovery_sent_at).length,
    },
    _note:
      'Recovery mail goes out via /admin/abandoned-carts/:id/recover. A cart idle for ' +
      'less than an hour is excluded — mailing somebody mid-checkout is worse than silence.',
  })
}
