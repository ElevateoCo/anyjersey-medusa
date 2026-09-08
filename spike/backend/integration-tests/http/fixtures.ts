import type { MedusaContainer } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules, ProductStatus } from '@medusajs/framework/utils'
import {
  createProductsWorkflow, createRegionsWorkflow, createSalesChannelsWorkflow,
  createShippingOptionsWorkflow, createShippingProfilesWorkflow,
  createStockLocationsWorkflow, createTaxRegionsWorkflow,
  createApiKeysWorkflow, linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from '@medusajs/medusa/core-flows'
import { CATALOG_MODULE } from '../../src/modules/catalog'

export type World = {
  regionId: string
  /** The personalisation add-on product, keyed by tier. */
  addonVariantIds: Record<string, string>
  salesChannelId: string
  publishableKey: string
  productId: string
  detailId: string
  variantIds: string[]
  shippingOptionId: string
}

/**
 * Seeds the minimum a purchase needs, plus one product with a linked jersey_detail so the
 * catalog endpoints have something to filter. Deliberately small: an integration suite
 * that seeds 3,000 products tests the seeder, not the endpoints.
 */
export async function seedWorld(container: MedusaContainer): Promise<World> {
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillment = container.resolve(Modules.FULFILLMENT)
  const catalog: any = container.resolve(CATALOG_MODULE)

  const { result: channels } = await createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: 'Web' }] },
  })
  const salesChannelId = channels[0].id

  const { result: regions } = await createRegionsWorkflow(container).run({
    input: {
      regions: [{
        name: 'United States', currency_code: 'usd', countries: ['us'],
        payment_providers: ['pp_system_default'],
      }],
    },
  })
  const regionId = regions[0].id
  await createTaxRegionsWorkflow(container).run({
    input: [{ country_code: 'us', provider_id: 'tp_system' }],
  }).catch(() => undefined)

  const { result: locations } = await createStockLocationsWorkflow(container).run({
    input: { locations: [{ name: 'Test WH', address: { city: 'Dallas', country_code: 'US', address_1: '1 St' } }] },
  })
  const stockLocation = locations[0]
  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: 'manual_manual' },
  })
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocation.id, add: [salesChannelId] },
  })

  const { result: profiles } = await createShippingProfilesWorkflow(container).run({
    input: { data: [{ name: 'Test profile', type: 'default' }] },
  })
  const shippingProfileId = profiles[0].id

  const fset = await fulfillment.createFulfillmentSets({
    name: 'US delivery', type: 'shipping',
    service_zones: [{ name: 'US zone', geo_zones: [{ country_code: 'us', type: 'country' as const }] }],
  })
  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fset.id },
  })

  const { result: options } = await createShippingOptionsWorkflow(container).run({
    input: [{
      name: 'Standard Shipping', price_type: 'flat', provider_id: 'manual_manual',
      service_zone_id: fset.service_zones[0].id, shipping_profile_id: shippingProfileId,
      type: { label: 'Standard', description: '3-5 days', code: 'standard' },
      prices: [{ currency_code: 'usd', amount: 4.99 }, { region_id: regionId, amount: 4.99 }],
      rules: [
        { attribute: 'enabled_in_store', value: 'true', operator: 'eq' },
        { attribute: 'is_return', value: 'false', operator: 'eq' },
      ],
    }],
  })

  const { result: products } = await createProductsWorkflow(container).run({
    input: {
      products: [{
        title: 'Buffalo Bills Josh Allen Grey Jersey',
        handle: 'buffalo-bills-josh-allen-grey-jersey',
        description: 'A grey jersey for testing.',
        status: ProductStatus.PUBLISHED,
        shipping_profile_id: shippingProfileId,
        options: [{ title: 'Size', values: ['S', 'M', 'L'] }],
        variants: ['S', 'M', 'L'].map((size) => ({
          title: size, sku: `TEST-${size}`, options: { Size: size },
          manage_inventory: false,
          prices: [{ amount: 64.99, currency_code: 'usd' }],
        })),
        sales_channels: [{ id: salesChannelId }],
      }],
    },
  })
  const product = products[0]

  const [detail] = await catalog.createJerseyDetails([{
    sport: 'football', league: 'NFL', team: 'Buffalo Bills', player: 'Josh Allen',
    colourway: 'grey', garment: 'jersey',
    search_text: 'buffalo bills josh allen grey nfl jersey',
    source_handle: product.handle, needs_review: false,
  }])
  await link.create({
    [Modules.PRODUCT]: { product_id: product.id },
    [CATALOG_MODULE]: { jersey_detail_id: detail.id },
  })

  // The personalisation add-on: an ordinary product with one variant per tier, so its
  // price comes from the pricing engine like every other price. Draft, and in the sales
  // channel — a draft product is still purchasable by id, which is what the attach path
  // relies on, and is what keeps it out of the catalogue.
  const { result: addons } = await createProductsWorkflow(container).run({
    input: {
      products: [{
        title: 'Personalisation',
        handle: 'personalisation',
        status: ProductStatus.PUBLISHED,
        shipping_profile_id: shippingProfileId,
        options: [{ title: 'Type', values: ['Name', 'Number', 'Name & number', 'Patch'] }],
        variants: [
          { title: 'Name', sku: 'PERS-NAME', options: { Type: 'Name' }, manage_inventory: false,
            prices: [{ amount: 14.99, currency_code: 'usd' }] },
          { title: 'Number', sku: 'PERS-NUMBER', options: { Type: 'Number' }, manage_inventory: false,
            prices: [{ amount: 9.99, currency_code: 'usd' }] },
          { title: 'Name & number', sku: 'PERS-BUNDLE', options: { Type: 'Name & number' },
            manage_inventory: false, prices: [{ amount: 19.99, currency_code: 'usd' }] },
          { title: 'Patch', sku: 'PERS-PATCH', options: { Type: 'Patch' }, manage_inventory: false,
            prices: [{ amount: 7.99, currency_code: 'usd' }] },
        ],
        sales_channels: [{ id: salesChannelId }],
      }],
    },
  })
  const { data: addonFresh } = await query.graph({
    entity: 'product',
    fields: ['id', 'variants.id', 'variants.sku'],
    filters: { id: addons[0].id },
  })
  const addonVariantIds = Object.fromEntries(
    ((addonFresh[0] as any).variants ?? []).map((v: any) => [
      String(v.sku).replace('PERS-', ''), v.id,
    ])
  )

  const { result: keys } = await createApiKeysWorkflow(container).run({
    input: { api_keys: [{ title: 'Test', type: 'publishable', created_by: 'test' }] },
  })
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: keys[0].id, add: [salesChannelId] },
  })

  const { data: fresh } = await query.graph({
    entity: 'product', fields: ['id', 'variants.id'], filters: { id: product.id },
  })

  return {
    regionId,
    addonVariantIds,
    salesChannelId,
    publishableKey: keys[0].token,
    productId: product.id,
    detailId: detail.id,
    variantIds: ((fresh[0] as any).variants ?? []).map((v: any) => v.id),
    shippingOptionId: options[0].id,
  }
}

/**
 * An admin user plus a bearer token that actually authorises /admin/*.
 *
 * Medusa keeps the auth identity and the user separate, and `/admin/users` cannot be
 * called with a bare registration token (401). The link has to be made directly:
 *
 *   1. register → a token whose JWT payload carries `auth_identity_id`
 *   2. create the user through the user module
 *   3. write `app_metadata.user_id` onto that auth identity
 *   4. log in → a token with a real `actor_id`
 *
 * Step 3 is the one with no HTTP route. Without it login still returns a token, but with
 * an empty actor and every admin call answers 401 — which is exactly how the first
 * version of this failed sixteen tests from beforeAll.
 */
function authIdentityIdFrom(token: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
    )
    return payload.auth_identity_id ?? null
  } catch {
    return null
  }
}

export async function adminHeaders(container: MedusaContainer, api: any) {
  const email = 'admin@test.local'
  const password = 'supersecret'
  const userModule: any = container.resolve(Modules.USER)
  const authModule: any = container.resolve(Modules.AUTH)

  const registered = await api
    .post('/auth/user/emailpass/register', { email, password })
    .catch((e: any) => e.response)

  const identityId = registered?.data?.token
    ? authIdentityIdFrom(registered.data.token)
    : null

  const existing = await userModule.listUsers({ email })
  const user = existing[0] ?? (await userModule.createUsers([{ email }]))[0]

  if (identityId) {
    await authModule.updateAuthIdentities([
      { id: identityId, app_metadata: { user_id: user.id } },
    ])
  }

  const login = await api.post('/auth/user/emailpass', { email, password })
  if (!login?.data?.token) throw new Error('could not obtain an admin token')
  return { headers: { Authorization: `Bearer ${login.data.token}` } }
}

export const storeHeaders = (w: World) => ({
  headers: { 'x-publishable-api-key': w.publishableKey },
})
