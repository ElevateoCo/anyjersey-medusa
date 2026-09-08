/**
 * Collapse to a single sales channel.
 *
 * The starter creates "Default Sales Channel"; the spike seed added "Web". A publishable
 * key linked to more than one channel forces every cart creation to pass
 * sales_channel_id, which is friction with no benefit for a single-storefront business.
 *
 *   npx medusa exec ./src/scripts/fix-sales-channels.ts
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { deleteSalesChannelsWorkflow } from '@medusajs/medusa/core-flows'

export default async function fix({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)

  const channels = await salesChannelModule.listSalesChannels()
  const keep = channels.find((c) => c.name === 'Web')
  if (!keep) return logger.error('no "Web" channel — nothing to do')

  const drop = channels.filter((c) => c.id !== keep.id)
  if (!drop.length) return logger.info('already a single sales channel')

  for (const c of drop) {
    const { data: products } = await query.graph({
      entity: 'product',
      fields: ['id'],
      filters: { sales_channels: { id: c.id } } as any,
      pagination: { take: 100000, skip: 0 },
    })
    logger.info(`  "${c.name}" has ${products.length} products attached`)
    if (products.length) {
      logger.warn(`  refusing to delete "${c.name}" while products are attached`)
      continue
    }
    await deleteSalesChannelsWorkflow(container).run({ input: { ids: [c.id] } })
    logger.info(`  deleted "${c.name}"`)
  }

  const after = await salesChannelModule.listSalesChannels()
  logger.info('')
  logger.info(`  sales channels now: ${after.map((c) => c.name).join(', ')}`)
  logger.info('  carts no longer need an explicit sales_channel_id.')
}
