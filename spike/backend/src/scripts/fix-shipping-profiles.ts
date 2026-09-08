/**
 * Consolidate to a single shipping profile.
 *
 * Two existed: "Default Shipping Profile" (created by Medusa's own migration, holding
 * 3,154 products and the five zone options) and "Default" (created by seed-spike.ts,
 * holding one product and one stray option). A cart whose items sit on one profile cannot
 * be fulfilled by a shipping option on the other, which is what
 * "The cart items require shipping profiles that are not satisfied by the current
 * shipping methods" means — 39 of 40 seeded orders failed on it.
 *
 * Keeps the profile with the most products, moves everything else onto it, deletes the
 * loser.
 *
 *   npx medusa exec ./src/scripts/fix-shipping-profiles.ts          # dry run
 *   APPLY=1 npx medusa exec ./src/scripts/fix-shipping-profiles.ts
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
  if (profiles.length <= 1) return logger.info('  already a single shipping profile')

  // Count products per profile so we keep the one that costs least to move.
  const counts = new Map<string, number>()
  for (const p of profiles) {
    const { data } = await query.graph({
      entity: 'product',
      fields: ['id'],
      filters: { shipping_profile_id: p.id } as any,
      pagination: { take: 100000, skip: 0 },
    }).catch(() => ({ data: [] as any[] }))
    counts.set(p.id, (data as any[]).length)
  }

  const keep = profiles.reduce((a, b) => (counts.get(b.id)! > counts.get(a.id)! ? b : a))
  const drop = profiles.filter((p) => p.id !== keep.id)

  logger.info('')
  logger.info(`  keeping  "${keep.name}"  (${counts.get(keep.id)} products)`)
  for (const d of drop) logger.info(`  dropping "${d.name}"  (${counts.get(d.id)} products)`)

  const moves: { id: string }[] = []
  for (const d of drop) {
    const { data } = await query.graph({
      entity: 'product',
      fields: ['id'],
      filters: { shipping_profile_id: d.id } as any,
      pagination: { take: 100000, skip: 0 },
    }).catch(() => ({ data: [] as any[] }))
    moves.push(...(data as any[]).map((p) => ({ id: p.id })))
  }

  const strayOptions: { id: string; name: string; profile: string }[] = []
  for (const d of drop) {
    const opts = await fulfillment.listShippingOptions({ shipping_profile_id: d.id })
    strayOptions.push(...opts.map((o) => ({ id: o.id, name: o.name, profile: d.name })))
  }

  logger.info(`  products to move      ${moves.length}`)
  logger.info(`  stray options to move ${strayOptions.length}`)
  for (const o of strayOptions) logger.info(`    "${o.name}" on "${o.profile}"`)

  if (!apply) {
    logger.info('')
    logger.info('  DRY RUN — re-run with APPLY=1.')
    logger.info('')
    return
  }

  if (moves.length) {
    await updateProductsWorkflow(container).run({
      input: {
        selector: { id: moves.map((m) => m.id) },
        update: { shipping_profile_id: keep.id },
      } as any,
    })
    logger.info(`  moved ${moves.length} product(s)`)
  }

  // The stray options are duplicates of the zone options on the kept profile, so they go
  // rather than get migrated — keeping them would offer the customer two identical rates.
  for (const o of strayOptions) {
    await fulfillment.deleteShippingOptions(o.id)
    logger.info(`  deleted duplicate option "${o.name}"`)
  }

  for (const d of drop) {
    await fulfillment.deleteShippingProfiles(d.id)
    logger.info(`  deleted profile "${d.name}"`)
  }

  const after = await fulfillment.listShippingProfiles({})
  logger.info('')
  logger.info(`  shipping profiles now: ${after.map((p) => p.name).join(', ')}`)
  logger.info('')
}
