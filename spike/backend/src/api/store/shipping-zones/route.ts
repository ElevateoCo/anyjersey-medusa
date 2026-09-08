import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { ZONES, zoneForRegionName } from '../../../shipping-zones'

/**
 * GET /store/shipping-zones            all zones
 * GET /store/shipping-zones?region_id= the one that applies to this region
 *
 * So the storefront never invents a rate or a free-shipping threshold.
 *
 * `countries` stays a count and `country_codes` carries the list. The count is what the
 * cart needs and what the existing tests assert; the list is what the public shipping page
 * needs, because "Europe — 27 countries" is not an answer to "do you ship to Portugal".
 * Adding a field rather than widening the existing one keeps the cart's payload the size
 * it was.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  if (req.query.region_id) {
    const { data: regions } = await query.graph({
      entity: 'region',
      fields: ['id', 'name', 'currency_code'],
      filters: { id: req.query.region_id as string },
    })
    const region = regions[0]
    const zone = zoneForRegionName(region?.name)
    if (!zone) {
      return res.status(404).json({ message: `No shipping zone for region ${region?.name}` })
    }
    return res.json({
      zone: { ...zone, countries: zone.countries.length, country_codes: zone.countries },
    })
  }

  res.json({
    zones: ZONES.map((z) => ({
      ...z, countries: z.countries.length, country_codes: z.countries,
    })),
  })
}
