/**
 * Create completed orders for testing reports and abandoned-cart recovery.
 *
 * Uses the system payment provider, so no Stripe key is needed. These are fixtures, not
 * a simulation: the point is to have enough shape in the data that a report which is
 * broken looks broken.
 *
 *   npx medusa exec ./src/scripts/seed-orders.ts            # 40 orders + 12 abandoned
 *   ORDERS=100 ABANDONED=30 npx medusa exec ./src/scripts/seed-orders.ts
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import {
  addToCartWorkflow, completeCartWorkflow, createCartWorkflow,
  createPaymentCollectionForCartWorkflow, createPaymentSessionsWorkflow,
  addShippingMethodToCartWorkflow,
} from '@medusajs/medusa/core-flows'

const FIRST = ['Alex', 'Jordan', 'Sam', 'Casey', 'Riley', 'Morgan', 'Avery', 'Quinn',
               'Drew', 'Reese', 'Kai', 'Rowan']
const LAST = ['Parker', 'Reed', 'Ellis', 'Shaw', 'Blake', 'Grant', 'Hayes', 'Ford']

export default async function seedOrders({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const cartModule = container.resolve(Modules.CART)
  const paymentModule = container.resolve(Modules.PAYMENT)

  const wanted = Number(process.env.ORDERS ?? 40)
  const abandoned = Number(process.env.ABANDONED ?? 12)

  const { data: regions } = await query.graph({
    entity: 'region', fields: ['id', 'name', 'currency_code'],
  })
  const region = regions.find((r: any) => r.name === 'United States') ?? regions[0]

  const { data: channels } = await query.graph({ entity: 'sales_channel', fields: ['id'] })
  const salesChannelId = channels[0]?.id

  // A spread of products so reports have something to group by.
  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'title', 'variants.id', 'jersey_detail.team', 'jersey_detail.league'],
    filters: { status: 'published' } as any,
    pagination: { take: 60, skip: 0 },
  })
  const pool = (products as any[]).filter((p) => p.variants?.length)
  if (!pool.length) throw new Error('no products — run the import first')

  const { data: shipOpts } = await query.graph({
    entity: 'shipping_option', fields: ['id', 'name'],
  })

  let made = 0
  let left = 0

  for (let i = 0; i < wanted + abandoned; i++) {
    const isAbandoned = i >= wanted
    const first = FIRST[i % FIRST.length]
    const last = LAST[(i * 3) % LAST.length]
    const email = `${first}.${last}${i}@example.com`.toLowerCase()

    const { result: cart } = await createCartWorkflow(container).run({
      input: {
        region_id: region.id,
        sales_channel_id: salesChannelId,
        email,
        currency_code: region.currency_code,
        shipping_address: {
          first_name: first, last_name: last, address_1: `${100 + i} Example St`,
          city: 'Dallas', province: 'TX', postal_code: '75201', country_code: 'us',
        },
      },
    })

    // 1–3 line items, deterministic per index so runs are comparable
    const count = (i % 3) + 1
    for (let n = 0; n < count; n++) {
      const p = pool[(i * 7 + n * 13) % pool.length]
      await addToCartWorkflow(container).run({
        input: {
          cart_id: cart.id,
          items: [{ variant_id: p.variants[(i + n) % p.variants.length].id, quantity: 1 }],
        },
      })
    }

    if (isAbandoned) {
      left += 1
      continue // no shipping, no payment — this is the abandoned-cart fixture
    }

    if (shipOpts[0]) {
      await addShippingMethodToCartWorkflow(container).run({
        input: { cart_id: cart.id, options: [{ id: shipOpts[0].id }] },
      }).catch(() => { /* zone may not match; order still completes */ })
    }

    const { result: collection } = await createPaymentCollectionForCartWorkflow(container).run({
      input: { cart_id: cart.id },
    })
    await createPaymentSessionsWorkflow(container).run({
      input: { payment_collection_id: collection.id, provider_id: 'pp_system_default' },
    })
    const refreshed = await cartModule.retrieveCart(cart.id, {
      relations: ['payment_collection', 'payment_collection.payment_sessions'],
    })
    const session = (refreshed as any).payment_collection?.payment_sessions?.[0]
    if (session) await paymentModule.authorizePaymentSession(session.id, {})

    try {
      await completeCartWorkflow(container).run({ input: { id: cart.id } })
      made += 1
    } catch (e: any) {
      logger.warn(`  cart ${i} did not complete: ${String(e?.message).slice(0, 90)}`)
    }

    if (made && made % 10 === 0) logger.info(`  ${made}/${wanted} orders`)
  }

  logger.info('')
  logger.info('  ┌─ FIXTURES ──────────────────────────────────────────────')
  logger.info(`  │ orders created     ${made}`)
  logger.info(`  │ carts abandoned    ${left}`)
  logger.info('  │ paid via the system provider — no Stripe key required')
  logger.info('  └─────────────────────────────────────────────────────────')
  logger.info('')
}
