import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../modules/catalog'

/**
 * GET /admin/catalog
 *
 * Medusa's built-in product list can *display* jersey_detail but silently ignores it as a
 * filter — asking for one team returns all 3,155 products. So an operator cannot find
 * "all Dallas Cowboys jerseys" in the admin at all. This is that screen.
 *
 * It also answers the two questions nothing else in the admin can:
 *   - which products are flagged for review (116)
 *   - which are missing the regulatory data that gates EU sales (all 3,155)
 *
 * Filters: team, league, colourway, garment, sport, q, needs_review, missing_regulatory
 */
const REGULATORY = [
  'manufacturer_name', 'manufacturer_address', 'eu_responsible_person',
  'country_of_origin', 'fibre_composition', 'care_instructions',
  'safety_information', 'hs_code',
] as const

const fold = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const intParam = (v: unknown, fallback: number) => {
  if (v === undefined || v === null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function buildFilter(q: Record<string, unknown>) {
  const where: Record<string, unknown> = {}
  for (const key of ['team', 'league', 'colourway', 'garment', 'sport', 'season'] as const) {
    if (q[key]) where[key] = q[key]
  }
  if (q.needs_review === 'true') where.needs_review = true
  if (q.q) where.search_text = { $ilike: `%${fold(String(q.q))}%` }
  // "missing regulatory" means the two fields that actually gate an EU sale.
  if (q.missing_regulatory === 'true') {
    where.$or = [{ fibre_composition: null }, { eu_responsible_person: null }]
  }
  return where
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const limit = Math.min(Math.max(intParam(req.query.limit, 25), 1), 100)
  const offset = Math.max(intParam(req.query.offset, 0), 0)
  const where = buildFilter(req.query as Record<string, unknown>)

  const [details, count] = await catalog.listAndCountJerseyDetails(where, {
    skip: offset,
    take: limit,
    order: { team: 'ASC', player: 'ASC' },
  })

  // Attach the Medusa product so the operator sees status and image count too.
  const { data: linked } = await query.graph({
    entity: 'jersey_detail',
    fields: ['id', 'product.id', 'product.handle', 'product.title', 'product.status',
             'product.thumbnail'],
    filters: { id: details.map((d: any) => d.id) } as any,
    pagination: { take: details.length || 1, skip: 0 },
  }).catch(() => ({ data: [] as any[] }))
  const productByDetail = new Map(
    (linked as any[]).map((r) => [r.id, Array.isArray(r.product) ? r.product[0] : r.product])
  )

  // Counts for the filter chips, and the two that matter operationally.
  const all = await catalog.listJerseyDetails(
    {}, { select: ['team', 'league', 'colourway', 'garment', 'needs_review',
                   'fibre_composition', 'eu_responsible_person'], take: 100000 }
  )
  const tally = (field: string) => {
    const m = new Map<string, number>()
    for (const d of all) if (d[field]) m.set(d[field], (m.get(d[field]) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, count }))
  }

  res.json({
    count,
    limit,
    offset,
    filters: req.query,
    products: details.map((d: any) => {
      const p = productByDetail.get(d.id)
      const missing = REGULATORY.filter((f) => !d[f])
      return {
        detail_id: d.id,
        product_id: p?.id ?? null,
        handle: p?.handle ?? d.source_handle,
        title: p?.title ?? null,
        status: p?.status ?? null,
        thumbnail: p?.thumbnail ?? null,
        team: d.team, league: d.league, player: d.player,
        colourway: d.colourway, season: d.season, garment: d.garment,
        needs_review: d.needs_review,
        review_notes: d.review_notes ?? null,
        regulatory: Object.fromEntries(REGULATORY.map((f) => [f, d[f] ?? null])),
        missing_regulatory: missing,
        eu_ready: !missing.includes('fibre_composition') &&
                  !missing.includes('eu_responsible_person'),
      }
    }),
    facets: {
      leagues: tally('league'),
      teams: tally('team').slice(0, 80),
      colourways: tally('colourway'),
      garments: tally('garment'),
    },
    health: {
      total: all.length,
      needs_review: all.filter((d: any) => d.needs_review).length,
      eu_ready: all.filter((d: any) => d.fibre_composition && d.eu_responsible_person).length,
      missing_regulatory: all.filter(
        (d: any) => !d.fibre_composition || !d.eu_responsible_person
      ).length,
    },
    editable_regulatory_fields: REGULATORY,
  })
}
