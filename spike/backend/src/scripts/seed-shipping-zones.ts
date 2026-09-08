/**
 * Zone-based shipping — research.md §14.3.
 *
 * $4.99 flat is roughly break-even domestically at low weight and loses money at 1 lb.
 * Internationally a 1 lb parcel costs $25–37, so a flat rate is not an option: these
 * rates are set at or near real carrier cost, per zone.
 *
 * Duties and import VAT are NOT in these rates. They are separate checkout lines
 * (DDP via IOSS, §7.2) so the customer is never ambushed on delivery — a refused parcel
 * still costs the outbound leg.
 *
 *   npx medusa exec ./src/scripts/seed-shipping-zones.ts
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { ZONES } from '../shipping-zones'
import {
  createRegionsWorkflow,
  createShippingOptionsWorkflow,
  createTaxRegionsWorkflow,
} from '@medusajs/medusa/core-flows'


export default async function seedZones({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const fulfillment = container.resolve(Modules.FULFILLMENT)

  const { data: locations } = await query.graph({ entity: 'stock_location', fields: ['id', 'name'] })
  const stockLocation = locations[0]
  const { data: profiles } = await query.graph({ entity: 'shipping_profile', fields: ['id'] })
  const shippingProfile = profiles[0]
  if (!stockLocation || !shippingProfile) {
    throw new Error('run seed-spike.ts first')
  }

  const { data: existingRegions } = await query.graph({
    entity: 'region', fields: ['id', 'name', 'currency_code'],
  })
  const haveRegion = new Map(existingRegions.map((r: any) => [r.name, r]))

  for (const z of ZONES) {
    // ---- region ----
    let region = haveRegion.get(z.name)
    if (!region) {
      const { result } = await createRegionsWorkflow(container).run({
        input: {
          regions: [{
            name: z.name,
            // Presented in USD everywhere for now. Presenting in local currency triggers
            // Stripe's +1% conversion fee (§5.5), which has to be priced in first.
            currency_code: 'usd',
            countries: z.countries,
            payment_providers: ['pp_stripe_stripe', 'pp_system_default'],
          }],
        },
      })
      region = result[0]
      await createTaxRegionsWorkflow(container).run({
        input: z.countries.map((c) => ({ country_code: c, provider_id: 'tp_system' })),
      }).catch(() => { /* tax region may already exist */ })
      logger.info(`  region created: ${z.name} (${z.countries.length} countries)`)
    } else {
      logger.info(`  region exists:  ${z.name}`)
    }

    // ---- fulfilment set + service zone ----
    const setName = `Zone ${z.zone} — ${z.name}`
    // Service-zone names are globally unique in Medusa, and the original seed already
    // created one called "United States". Prefixing avoids the collision and makes the
    // script safe to re-run.
    const zoneName = `Z${z.zone} ${z.name}`
    const existingZones = await fulfillment.listServiceZones({ name: zoneName })
    if (existingZones.length) {
      logger.info(`  zone exists:    ${zoneName}`)
      const opts = await fulfillment.listShippingOptions({ service_zone: { id: existingZones[0].id } })
      if (opts.length) { logger.info(`  option exists:  ${z.name} $${z.rate}`); continue }
    }
    const sets = await fulfillment.listFulfillmentSets({ name: setName })
    let fset = sets[0]
    if (!fset && !existingZones.length) {
      fset = await fulfillment.createFulfillmentSets({
        name: setName,
        type: 'shipping',
        service_zones: [{
          name: zoneName,
          geo_zones: z.countries.map((c) => ({ country_code: c, type: 'country' as const })),
        }],
      })
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
        [Modules.FULFILLMENT]: { fulfillment_set_id: fset.id },
      })
    }

    // ---- shipping option ----
    const zoneId = existingZones[0]?.id ?? fset?.service_zones?.[0]?.id
    if (!zoneId) continue
    await createShippingOptionsWorkflow(container).run({
      input: [{
        name: `Standard Shipping — ${z.name}`,
        price_type: 'flat',
        provider_id: 'manual_manual',
        service_zone_id: zoneId,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: 'Standard',
          description: z.leadTime,
          code: `standard-z${z.zone}`,
        },
        prices: [
          { currency_code: 'usd', amount: z.rate },
          { region_id: region.id, amount: z.rate },
        ],
        rules: [
          { attribute: 'enabled_in_store', value: 'true', operator: 'eq' },
          { attribute: 'is_return', value: 'false', operator: 'eq' },
        ],
      }],
    })
    logger.info(`  option created: ${z.name} $${z.rate} (free over $${z.freeOver})`)
  }

  logger.info('')
  logger.info('  ┌─ SHIPPING ZONES ────────────────────────────────────────')
  for (const z of ZONES) {
    logger.info(`  │ zone ${z.zone}  ${z.name.padEnd(16)} $${String(z.rate).padStart(6)}  free over $${z.freeOver}`)
  }
  logger.info('  │')
  logger.info('  │ Freight only. Import VAT and the €3 EU customs duty are')
  logger.info('  │ separate checkout lines via IOSS — research.md §7.2, §14.2.')
  logger.info('  └─────────────────────────────────────────────────────────')
  logger.info('')
}
