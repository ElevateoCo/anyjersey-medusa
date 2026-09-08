import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../../modules/catalog'
import { buildFilter } from '../route'

/**
 * POST /admin/catalog/bulk
 *
 * Apply the same values to every product matching a filter — which is how 3,155 rows of
 * regulatory data get filled, since it is the same answer for the whole catalog.
 *
 * Dry-run by default: it reports the match count and a sample, and changes nothing until
 * `apply: true`. A bulk write with no preview is how you discover your filter was wrong
 * after the fact.
 *
 * Price is deliberately not bulk-editable. Changing the price across the catalog has
 * reference-pricing consequences under the Omnibus Directive and FTC guidance
 * (research.md §7.10) — that should be a considered decision with a recorded prior price,
 * not a button on an admin screen.
 */
const ALLOWED = new Set([
  'manufacturer_name', 'manufacturer_address', 'eu_responsible_person',
  'country_of_origin', 'fibre_composition', 'care_instructions',
  'safety_information', 'hs_code', 'needs_review',
])

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const body = (req.body ?? {}) as {
    filter?: Record<string, unknown>
    set?: Record<string, unknown>
    apply?: boolean
    limit?: number
  }

  const set: Record<string, unknown> = {}
  const rejected: string[] = []
  for (const [k, v] of Object.entries(body.set ?? {})) {
    if (!ALLOWED.has(k)) { rejected.push(k); continue }
    if (v === '' || v === null || v === undefined) continue
    set[k] = v
  }
  if (!Object.keys(set).length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      `Nothing to set.${rejected.length ? ` Not bulk-editable: ${rejected.join(', ')}` : ''}`)
  }
  if (set.country_of_origin && String(set.country_of_origin).length !== 2) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      'country_of_origin must be a two-letter ISO code.')
  }

  const where = buildFilter(body.filter ?? {})
  const cap = Math.min(Math.max(Number(body.limit ?? 5000), 1), 20000)
  const matched = await catalog.listJerseyDetails(where, {
    select: ['id', 'team', 'player', 'source_handle'], take: cap,
  })

  if (!body.apply) {
    return res.json({
      dry_run: true,
      would_update: matched.length,
      set,
      ignored_fields: rejected,
      sample: matched.slice(0, 5).map((d: any) => ({
        team: d.team, player: d.player, handle: d.source_handle,
      })),
      note: 'Nothing changed. Send the same body with apply: true to write.',
    })
  }

  const BATCH = 200
  let updated = 0
  for (let i = 0; i < matched.length; i += BATCH) {
    const slice = matched.slice(i, i + BATCH)
    await catalog.updateJerseyDetails(slice.map((d: any) => ({ id: d.id, ...set })))
    updated += slice.length
  }

  res.json({ dry_run: false, updated, set, ignored_fields: rejected })
}
