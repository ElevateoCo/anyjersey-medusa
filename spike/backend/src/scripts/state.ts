/**
 * Writes spike-state.json so the verifier does not have to guess ids.
 * Idempotent and read-only — safe to re-run any time.
 *
 *   npx medusa exec ./src/scripts/state.ts
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { writeFileSync } from 'fs'
import { join } from 'path'

export default async function dumpState({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)

  const { data: regions } = await query.graph({
    entity: 'region', fields: ['id', 'name', 'currency_code'],
  })
  const { data: keys } = await query.graph({
    entity: 'api_key', fields: ['id', 'token', 'type', 'title'],
  })
  const channels = await salesChannelModule.listSalesChannels()
  const { data: products } = await query.graph({
    entity: 'product', fields: ['id', 'handle', 'title'],
  })

  const web = channels.find((c) => c.name === 'Web') ?? channels[0]
  const state = {
    api: 'http://localhost:9000',
    publishable_key: keys.find((k: any) => k.type === 'publishable')?.token,
    region_id: regions[0]?.id,
    currency: regions[0]?.currency_code,
    sales_channel_id: web?.id,
    sales_channels: channels.map((c) => ({ id: c.id, name: c.name })),
    product_handle: products[0]?.handle,
    webhook_path: '/hooks/payment/stripe_stripe',
  }

  const out = join(process.cwd(), '..', 'spike-state.json')
  writeFileSync(out, JSON.stringify(state, null, 2))
  logger.info(`wrote ${out}`)
  logger.info(JSON.stringify(state, null, 2))
}
