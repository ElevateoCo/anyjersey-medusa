/**
 * Phase 0 spike seed — research.md §10.
 *
 * One real product from the extracted catalog, priced and configured the way the live
 * store will be: US/USD, $64.99, $4.99 flat shipping, Stripe as the payment provider,
 * and inventory NOT managed.
 *
 * That last point is deliberate. The live store shows "Variant sold out or unavailable"
 * on every size because inventory is untracked yet quantity is 0 with a deny policy
 * (research.md §12.1). On a sourcing model the correct setting is manage_inventory:
 * false — the product is always buyable and the honest signal is a lead time, not a
 * stock count.
 *
 *   npx medusa exec ./src/scripts/seed-spike.ts
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules, ProductStatus } from '@medusajs/framework/utils'
import {
  createApiKeysWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from '@medusajs/medusa/core-flows'
import product from './spike-product.json'

const SHIPPING_USD = 4.99

export default async function seedSpike({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  const storeModule = container.resolve(Modules.STORE)

  const [store] = await storeModule.listStores()

  // ---------------------------------------------------------------- sales channel
  let [salesChannel] = await salesChannelModule.listSalesChannels({ name: 'Web' })
  if (!salesChannel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: 'Web' }] },
    })
    salesChannel = result[0]
  }

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        supported_currencies: [{ currency_code: 'usd', is_default: true }],
        default_sales_channel_id: salesChannel.id,
      },
    },
  })
  logger.info('store: USD default, sales channel "Web"')

  // ---------------------------------------------------------------- region + tax
  const countries = ['us']
  const { result: regions } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: 'United States',
          currency_code: 'usd',
          countries,
          // pp_stripe_stripe is the provider id registered by medusa-config.ts.
          // The Stripe webhook lands at /hooks/payment/stripe_stripe.
          payment_providers: ['pp_stripe_stripe', 'pp_system_default'],
        },
      ],
    },
  })
  const region = regions[0]
  await createTaxRegionsWorkflow(container).run({
    input: countries.map((country_code) => ({ country_code, provider_id: 'tp_system' })),
  })
  logger.info(`region: ${region.name} / ${region.currency_code} with Stripe enabled`)

  // ---------------------------------------------------------------- location + fulfilment
  const { result: locations } = await createStockLocationsWorkflow(container).run({
    input: {
      locations: [
        {
          name: 'US Warehouse',
          address: { city: 'Dallas', country_code: 'US', address_1: '1 Example St' },
        },
      ],
    },
  })
  const stockLocation = locations[0]

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: 'manual_manual' },
  })

  const { result: profiles } = await createShippingProfilesWorkflow(container).run({
    input: { data: [{ name: 'Default', type: 'default' }] },
  })
  const shippingProfile = profiles[0]

  const fulfillmentSet = await fulfillmentModule.createFulfillmentSets({
    name: 'US delivery',
    type: 'shipping',
    service_zones: [
      { name: 'United States', geo_zones: countries.map((c) => ({ country_code: c, type: 'country' as const })) },
    ],
  })

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
  })

  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: 'Standard Shipping',
        price_type: 'flat',
        provider_id: 'manual_manual',
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: { label: 'Standard', description: 'Tracked, 3-5 business days.', code: 'standard' },
        prices: [
          { currency_code: 'usd', amount: SHIPPING_USD },
          { region_id: region.id, amount: SHIPPING_USD },
        ],
        rules: [
          { attribute: 'enabled_in_store', value: 'true', operator: 'eq' },
          { attribute: 'is_return', value: 'false', operator: 'eq' },
        ],
      },
    ],
  })
  logger.info(`shipping: flat $${SHIPPING_USD.toFixed(2)}`)

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocation.id, add: [salesChannel.id] },
  })

  // ---------------------------------------------------------------- product
  const sizes = product.variants.map((v) => v.size)
  await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: product.name,
          handle: product.slug,
          description: product.description,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          weight: 200,
          // One image, by decision — research.md §13.6.
          images: [{ url: 'http://localhost:9000/static/jersey.jpg' }],
          thumbnail: 'http://localhost:9000/static/jersey.jpg',
          options: [{ title: 'Size', values: sizes }],
          variants: product.variants.map((v) => ({
            title: v.size,
            sku: v.sku,
            options: { Size: v.size },
            // Untracked: always buyable, never "sold out". See the header comment.
            manage_inventory: false,
            prices: [{ amount: product.price_cents / 100, currency_code: 'usd' }],
          })),
          sales_channels: [{ id: salesChannel.id }],
          metadata: {
            team: product.team,
            player: product.player,
            colourway: product.colourway,
            league: product.league,
            sport: product.sport,
          },
        },
      ],
    },
  })
  logger.info(`product: ${product.name} — ${sizes.length} sizes at $${(product.price_cents / 100).toFixed(2)}`)

  // ---------------------------------------------------------------- publishable key
  const { data: existing } = await query.graph({
    entity: 'api_key',
    fields: ['id', 'token', 'type'],
    filters: { type: 'publishable' },
  })
  let key: { id: string; token: string } | undefined = existing?.[0] as any
  if (!key) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: { api_keys: [{ title: 'Storefront', type: 'publishable', created_by: '' }] },
    })
    key = result[0] as any
  }
  if (!key) throw new Error('could not create or find a publishable API key')
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: key.id, add: [salesChannel.id] },
  })

  logger.info('')
  logger.info('  ┌─ SPIKE SEEDED ──────────────────────────────────────────')
  logger.info(`  │ product      ${product.slug}`)
  logger.info(`  │ price        $${(product.price_cents / 100).toFixed(2)} + $${SHIPPING_USD.toFixed(2)} shipping`)
  logger.info(`  │ sizes        ${sizes.join(', ')}`)
  logger.info(`  │ region       ${region.name} (${region.currency_code}) · Stripe enabled`)
  logger.info(`  │ webhook      POST /hooks/payment/stripe_stripe`)
  logger.info(`  │ publishable  ${key.token}`)
  logger.info('  └─────────────────────────────────────────────────────────')
  logger.info('')
}
