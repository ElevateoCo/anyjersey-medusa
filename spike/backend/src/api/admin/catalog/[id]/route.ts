import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../../modules/catalog'

/**
 * POST /admin/catalog/:detail_id — edit one product's catalog fields.
 *
 * Covers the regulatory block (which gates EU sales and had no editor anywhere), the
 * derived taxonomy (so a reviewer can correct a parse), and the needs_review flag.
 */
const ALLOWED = new Set([
  'manufacturer_name', 'manufacturer_address', 'eu_responsible_person',
  'country_of_origin', 'fibre_composition', 'care_instructions',
  'safety_information', 'hs_code',
  'team', 'league', 'player', 'colourway', 'season', 'edition', 'garment',
  'seo_title', 'seo_description', 'needs_review',
])

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>

  const update: Record<string, unknown> = { id: req.params.id }
  const rejected: string[] = []
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED.has(k)) { rejected.push(k); continue }
    update[k] = v === '' ? null : v
  }

  if (Object.keys(update).length === 1) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      `Nothing to update.${rejected.length ? ` Not editable: ${rejected.join(', ')}` : ''}`)
  }
  if (update.country_of_origin && String(update.country_of_origin).length !== 2) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      'country_of_origin must be a two-letter ISO code.')
  }

  const [updated] = await catalog.updateJerseyDetails([update])
  res.json({ detail: updated, ignored_fields: rejected })
}
