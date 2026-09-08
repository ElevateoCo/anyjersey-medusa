/**
 * Attach any product whose shipping profile was deleted to the surviving one.
 *
 * fix-shipping-profiles.ts deleted the losing profile, but its product-count query
 * returned 0 because `shipping_profile_id` is not a filterable field on `product` in
 * query.graph — so it reported nothing to move and moved nothing. One product was left
 * pointing at a deleted profile, which makes it unfulfillable and would fail at checkout.
 *
 * Detected here in SQL terms the graph cannot express: products with no live profile.
 *
 *   APPLY=1 npx medusa exec ./src/scripts/fix-orphan-profiles.ts
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { updateProductsWorkflow } from '@medusajs/medusa/core-flows'

export default async function fix({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillment = container.resolve(Modules.FULFILLMENT)
  const apply = process.env.APPLY === '1'

  const profiles = await fulfillment.listShippingProfiles({})
  if (!profiles.length) throw new Error('no shipping profile exists at all')
  const keep = profiles[0]

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle', 'shipping_profile.id'],
    pagination: { take: 100000, skip: 0 },
  })
  const orphans = (products as any[]).filter((p) => !p.shipping_profile?.id)

  logger.info('')
  logger.info(`  products            ${(products as any[]).length}`)
  logger.info(`  keeping profile     "${keep.name}"`)
  logger.info(`  without a profile   ${orphans.length}`)
  for (const o of orphans.slice(0, 5)) logger.info(`    ${o.handle}`)

  if (!orphans.length) return
  if (!apply) return logger.info('\n  DRY RUN — re-run with APPLY=1.\n')

  await updateProductsWorkflow(container).run({
    input: {
      selector: { id: orphans.map((o) => o.id) },
      update: { shipping_profile_id: keep.id },
    } as any,
  })
  logger.info(`  attached ${orphans.length} product(s) to "${keep.name}"`)
  logger.info('')
}
