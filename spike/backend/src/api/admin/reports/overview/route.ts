import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../../modules/catalog'

/**
 * GET /admin/reports/overview?days=30
 *
 * The gap §15.3 calls the big one: Medusa ships no merchant-facing reporting. This is the
 * minimum set worth looking at daily, plus one thing Shopify cannot give this store at
 * all — revenue grouped by league, team and colourway, which only exists because the
 * taxonomy was derived in §13.3. On the live Shopify store those fields are populated on
 * ~60 of 3,636 products, so the same report there would be blank.
 *
 * Aggregation happens in JS over the period's orders. Fine into the low thousands;
 * past that it wants SQL GROUP BY or a rollup table, and the honest note lives in the
 * response as `_performance`.
 */
type Bucket = { key: string; orders: number; revenue: number; units: number }

/**
 * Postgres numerics arrive as strings ("69.980000000000000000"). `revenue += total` on
 * those is string concatenation, which produced a money report that silently reported
 * shipping as revenue. Coerce everything before arithmetic — the JS-side echo of
 * research.md §6.2.
 */
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0))
  return Number.isFinite(n) ? n : 0
}

const bump = (m: Map<string, Bucket>, key: string, revenue: number, units: number) => {
  const b = m.get(key) ?? { key, orders: 0, revenue: 0, units: 0 }
  b.orders += 1
  b.revenue += revenue
  b.units += units
  m.set(key, b)
}

const top = (m: Map<string, Bucket>, n = 10) =>
  [...m.values()]
    .map((b) => ({ ...b, revenue: Math.round(b.revenue * 100) / 100 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, n)

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const catalog: any = req.scope.resolve(CATALOG_MODULE)

  const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 1), 365)
  const since = new Date(Date.now() - days * 86400_000)

  const { data: orders } = await query.graph({
    entity: 'order',
    fields: [
      // `version` is required or Medusa cannot resolve shipping-method adjustments and
      // the whole query fails with "Shipping method version is required to load
      // adjustments" — an error that says nothing about the missing field.
      'id', 'display_id', 'created_at', 'email', 'currency_code', 'version',
      'total', 'subtotal', 'shipping_total', 'tax_total',
      // `items.*`, not individual fields: quantity, subtotal and total are computed and
      // silently do not resolve when requested one by one.
      'items.*',
      'region.name',
    ],
    pagination: { take: 100000, skip: 0 },
  })

  const inPeriod = (orders as any[]).filter((o) => new Date(o.created_at) >= since)

  // taxonomy lookup, one query rather than per-line
  const productIds = [...new Set(
    inPeriod.flatMap((o) => (o.items ?? []).map((i: any) => i.product_id)).filter(Boolean)
  )]
  const detailByProduct = new Map<string, any>()
  if (productIds.length) {
    const { data: linked } = await query.graph({
      entity: 'product',
      fields: ['id', 'jersey_detail.team', 'jersey_detail.league', 'jersey_detail.colourway',
               'jersey_detail.player', 'jersey_detail.garment'],
      filters: { id: productIds } as any,
      pagination: { take: 100000, skip: 0 },
    })
    for (const p of linked as any[]) detailByProduct.set(p.id, p.jersey_detail ?? {})
  }

  const byDay = new Map<string, Bucket>()
  const byProduct = new Map<string, Bucket>()
  const byLeague = new Map<string, Bucket>()
  const byTeam = new Map<string, Bucket>()
  const byColour = new Map<string, Bucket>()
  const byRegion = new Map<string, Bucket>()

  let revenue = 0
  let units = 0
  let shipping = 0
  let tax = 0

  for (const o of inPeriod) {
    const total = num(o.total)
    const qty = (o.items ?? []).reduce((n: number, i: any) => n + num(i.quantity), 0)
    revenue += total
    units += qty
    shipping += num(o.shipping_total)
    tax += num(o.tax_total)

    bump(byDay, new Date(o.created_at).toISOString().slice(0, 10), total, qty)
    bump(byRegion, o.region?.name ?? 'unknown', total, qty)

    for (const i of o.items ?? []) {
      const d = detailByProduct.get(i.product_id) ?? {}
      const line = num(i.subtotal)
      const q = num(i.quantity)
      bump(byProduct, i.product_title ?? i.title ?? 'unknown', line, q)
      if (d.league) bump(byLeague, d.league, line, q)
      if (d.team) bump(byTeam, d.team, line, q)
      if (d.colourway) bump(byColour, d.colourway, line, q)
    }
  }

  // Demand signal from the request queue — what to source, which no report on a
  // conventional store can show because the mechanic does not exist there.
  const requests = await catalog.listJerseyRequests(
    { status: ['new', 'sourcing'] }, { take: 5000 }
  )
  const demand = new Map<string, number>()
  for (const r of requests) {
    const key = [r.player, r.team].filter(Boolean).join(' · ') || 'unspecified'
    demand.set(key, (demand.get(key) ?? 0) + 1)
  }

  // Fill empty days so a chart does not lie by omission.
  const series: Bucket[] = []
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10)
    series.push(byDay.get(key) ?? { key, orders: 0, revenue: 0, units: 0 })
  }

  res.json({
    period: { days, since: since.toISOString() },
    totals: {
      orders: inPeriod.length,
      revenue: Math.round(revenue * 100) / 100,
      units,
      aov: inPeriod.length ? Math.round((revenue / inPeriod.length) * 100) / 100 : 0,
      shipping: Math.round(shipping * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      currency: inPeriod[0]?.currency_code?.toUpperCase() ?? 'USD',
    },
    series: series.map((b) => ({ ...b, revenue: Math.round(b.revenue * 100) / 100 })),
    top_products: top(byProduct),
    by_league: top(byLeague),
    by_team: top(byTeam),
    by_colourway: top(byColour),
    by_region: top(byRegion),
    demand: [...demand.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    _notes: {
      conversion: 'Not available here — needs session data. That is PostHog or GA4 (§4).',
      performance:
        `Aggregated in JS over ${inPeriod.length} order(s). Fine into the low thousands; ` +
        'past that this wants SQL GROUP BY or a rollup table.',
    },
  })
}
