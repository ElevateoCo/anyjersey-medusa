import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, QueryContext } from '@medusajs/framework/utils'
import { limited } from '../../../rate-limit'

/**
 * GET /store/jerseys?league=NFL&team=Dallas+Cowboys&colourway=white&q=allen
 *                   &limit=24&offset=0&region_id=...
 *
 * One query: products filtered through the product <> jersey_detail link, paginated and
 * counted by Medusa.
 *
 * Two earlier versions of this were wrong. The first loaded all jersey_detail rows into
 * memory and filtered there. The second filtered in SQL but then joined
 * jersey_detail.source_handle to product.handle — which broke silently the moment
 * source_handle was repaired to hold the true Shopify handle, because product handles are
 * generated slugs. Only 2,035 of 3,155 matched, so pages returned fewer products than the
 * count claimed and pagination skipped rows. The link is the join; use it.
 */
const FACETS = ['league', 'team', 'colourway', 'garment', 'sport', 'season', 'player'] as const

/**
 * `custom` is a boolean filter, not a facet value, so it is handled separately.
 *
 * Putting it in FACETS would compare the string "true" against a boolean column and match
 * nothing — silently, returning an empty listing that looks like an empty catalog.
 */
const parseCustom = (v: unknown): boolean | undefined => {
  const s = String(v ?? '').toLowerCase()
  if (s === 'true' || s === '1') return true
  if (s === 'false' || s === '0') return false
  return undefined
}
/** Accent-fold the query the same way search_text was folded at write time. */
const fold = (s: string) =>
  s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/**
 * Sort options.
 *
 * Deliberately no price sort: 1,037 of 1,084 products share the $64.99 price point, so
 * ordering by price would be theatre. Added back the day the catalog has real price
 * spread.
 */
const SORTS = {
  relevance: { handle: 'ASC' },
  newest: { created_at: 'DESC' },
  oldest: { created_at: 'ASC' },
  'name-asc': { title: 'ASC' },
  'name-desc': { title: 'DESC' },
} as const
export type SortKey = keyof typeof SORTS

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  // Listing and search, and the most expensive read in the application when `q` is set —
  // an ILIKE across the catalogue, indexed by pg_trgm but never free.
  //
  // **Be honest about what this budget is.** The storefront calls this server-side through a
  // cached fetch, so almost all legitimate traffic arrives as one caller and there is no
  // forwarded identity to split it by (see `clientKey`). The number therefore has to clear
  // the whole shop's revalidation traffic, which means it does not meaningfully constrain a
  // determined scraper hitting the route directly. It constrains a runaway client and an
  // unsophisticated one, and that is the claim.
  if (await limited(req, res, 'jerseys', 600, 60_000)) return

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const q = ((req.query.q as string) || '').trim()
  const sortKey = (req.query.sort as string) in SORTS
    ? (req.query.sort as SortKey)
    : 'relevance'
  const limit = Math.min(Math.max(Number(req.query.limit ?? 24) || 24, 1), 100)
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

  const filters: Record<string, unknown> = {}
  for (const key of FACETS) {
    const v = req.query[key]
    if (v) filters[key] = v
  }

  /**
   * `handle` is a **product** column, not a `jersey_detail` one, so it cannot join the
   * list above — that one becomes `jersey_detail: { ... }`. Kept separate for that reason.
   *
   * Repeated (`?handle=a&handle=b`) it arrives as an array and reads as an IN, which is
   * what the recently-viewed rail needs: it holds a handful of handles in the visitor's own
   * browser and has to turn them into current cards. Looking them up rather than caching
   * the cards is what keeps a stale price off that rail — the price a customer sees is the
   * price the catalogue holds now, not the one it held the day they looked.
   */
  const handle = req.query.handle
  const handles = Array.isArray(handle) ? handle.slice(0, 24) : handle ? [handle] : []

  const detailFilter: Record<string, unknown> = { ...filters }
  const custom = parseCustom(req.query.custom)
  if (custom !== undefined) detailFilter.is_custom = custom
  if (q) {
    // One folded haystack rather than four ILIKEs across accented columns.
    detailFilter.search_text = { $ilike: `%${fold(q)}%` }
  }

  let currency: string | undefined
  if (req.query.region_id) {
    const { data: regions } = await query.graph({
      entity: 'region',
      fields: ['id', 'currency_code'],
      filters: { id: req.query.region_id as string },
    })
    currency = regions[0]?.currency_code
  }

  const { data, metadata } = await query.graph({
    entity: 'product',
    fields: [
      'id', 'title', 'handle', 'thumbnail',
      'variants.id', 'variants.title', 'variants.calculated_price.*',
      'jersey_detail.team', 'jersey_detail.player', 'jersey_detail.colourway',
      'jersey_detail.league', 'jersey_detail.season', 'jersey_detail.is_custom',
    ],
    filters: {
      status: 'published',
      ...(handles.length ? { handle: handles } : {}),
      ...(Object.keys(detailFilter).length ? { jersey_detail: detailFilter } : {}),
    } as any,
    context: currency
      ? {
          variants: {
            calculated_price: QueryContext({
              region_id: req.query.region_id as string,
              currency_code: currency,
            }),
          },
        }
      : undefined,
    pagination: { take: limit, skip: offset, order: SORTS[sortKey] } as any,
  })

  res.json({
    count: (metadata as any)?.count ?? data.length,
    limit,
    offset,
    filters,
    q,
    sort: sortKey,
    sorts: Object.keys(SORTS),
    products: (data as any[]).map((p) => ({
      id: p.id,
      handle: p.handle,
      title: p.title,
      thumbnail: p.thumbnail,
      price: p.variants?.[0]?.calculated_price?.calculated_amount ?? null,
      sizes: (p.variants ?? []).length,
      detail: p.jersey_detail ?? null,
    })),
  })
}
