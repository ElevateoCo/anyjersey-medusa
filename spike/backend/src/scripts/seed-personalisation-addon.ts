import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { createProductsWorkflow } from '@medusajs/medusa/core-flows'
import { PRICES } from '../personalisation'

/**
 * The personalisation add-on, as a real product.
 *
 * This is the design decision worth explaining, because the obvious alternative is worse.
 *
 * To charge $19.99 for a name and number, something has to add $19.99 to the cart. The
 * tempting route is to set a custom price on the jersey's own line item — and Medusa
 * refuses it outright ("Unrecognized fields: unit_price"), for the same reason
 * research.md §5.2 rule 1 gives: a client that can name a price can name $0.01. Working
 * around that with a server-side price override would mean the add-on sidesteps the pricing
 * engine, and with it tax codes, currency conversion and promotions.
 *
 * So the add-on is an ordinary product with one variant per tier, priced in the price list
 * like everything else. A personalised order is two lines: the shirt, and the add-on. That
 * means:
 *
 *   - the price is the server's, from the same engine as every other price;
 *   - Stripe Tax sees it as a line with its own tax code (services and goods differ);
 *   - a promotion can include or exclude it without special-casing;
 *   - refunding a rejected personalisation is refunding a line, not adjusting one.
 *
 * The cost is that a cart shows two lines for one physical item, so the cart UI groups them
 * by the `personalisation_for` metadata key rather than listing the add-on loose.
 *
 * Idempotent: re-running updates the prices rather than creating a second product.
 */
const HANDLE = 'personalisation'

const TIERS: Array<{ key: keyof typeof PRICES; title: string }> = [
  { key: 'name', title: 'Name' },
  { key: 'number', title: 'Number' },
  { key: 'bundle', title: 'Name & number' },
  { key: 'patch', title: 'Patch' },
]

export default async function seedAddon({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModule: any = container.resolve(Modules.PRODUCT)
  const pricing: any = container.resolve(Modules.PRICING)

  const { data: existing } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle', 'variants.id', 'variants.sku'],
    filters: { handle: HANDLE },
  })

  if ((existing as any[]).length) {
    logger.info(`  add-on product already exists (${(existing as any[])[0].id}); refreshing prices`)
    await refreshPrices(container, (existing as any[])[0], pricing, query, logger)
    return
  }

  const { data: shippingProfiles } = await query.graph({
    entity: 'shipping_profile',
    fields: ['id'],
  })
  const { data: salesChannels } = await query.graph({
    entity: 'sales_channel',
    fields: ['id'],
  })

  const { result } = await createProductsWorkflow(container).run({
    input: {
      products: [{
        title: 'Personalisation',
        handle: HANDLE,
        // Not published: it must never appear in the catalogue, in search, or in a
        // collection. It is reachable only by the add-to-cart path that knows its id.
        status: 'draft' as any,
        description:
          'Name and number printing added to a shirt. Not sold on its own — it is added ' +
          'to the shirt it belongs to.',
        shipping_profile_id: (shippingProfiles as any[])[0]?.id,
        sales_channels: (salesChannels as any[]).map((s) => ({ id: s.id })),
        options: [{ title: 'Type', values: TIERS.map((t) => t.title) }],
        variants: TIERS.map((t) => ({
          title: t.title,
          sku: `PERS-${t.key.toUpperCase()}`,
          // No stock tracking: printing is a service, and an add-on that can go out of
          // stock blocks the sale of a shirt that is perfectly available.
          manage_inventory: false,
          options: { Type: t.title },
          prices: [{ amount: PRICES[t.key] / 100, currency_code: 'usd' }],
        })),
      }],
    },
  })

  const product = (result as any[])[0]
  logger.info('')
  logger.info(`  created ${product.id} (${HANDLE}) — draft, not in any collection`)
  for (const v of product.variants) {
    logger.info(`    ${v.sku.padEnd(14)} ${v.title}`)
  }
  logger.info('')
  logger.info('  Add PERSONALISATION_PRODUCT_ID to .env:')
  logger.info(`    PERSONALISATION_PRODUCT_ID=${product.id}`)
  logger.info('')
}

async function refreshPrices(
  container: any, product: any, pricing: any, query: any, logger: any
) {
  const { data: variants } = await query.graph({
    entity: 'product_variant',
    fields: ['id', 'sku', 'price_set.id', 'price_set.prices.id', 'price_set.prices.amount',
             'price_set.prices.currency_code'],
    filters: { product_id: product.id },
  })
  for (const v of variants as any[]) {
    const key = String(v.sku ?? '').replace('PERS-', '').toLowerCase() as keyof typeof PRICES
    const want = PRICES[key]
    if (want == null) continue
    const usd = (v.price_set?.prices ?? []).find((p: any) => p.currency_code === 'usd')
    if (!usd) continue
    // Amounts come back as decimals; PRICES is cents.
    if (Math.round(Number(usd.amount) * 100) === want) {
      logger.info(`    ${v.sku} already ${(want / 100).toFixed(2)}`)
      continue
    }
    await pricing.updatePrices([{ id: usd.id, amount: want / 100 }])
    logger.info(`    ${v.sku} -> ${(want / 100).toFixed(2)}`)
  }
}
