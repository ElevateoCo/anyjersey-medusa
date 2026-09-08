/**
 * Delete jersey_detail rows whose product no longer exists.
 *
 * apply-dedupe.ts removed 436 products but left their linked details behind, which meant
 * /store/facets still counted 3,591 and every league count was inflated. Deleting a
 * product does not cascade to a linked custom module — that has to be explicit.
 *
 *   npx medusa exec ./src/scripts/prune-orphan-details.ts          # dry run
 *   APPLY=1 npx medusa exec ./src/scripts/prune-orphan-details.ts
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../modules/catalog'

export default async function prune({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const catalog: any = container.resolve(CATALOG_MODULE)
  const apply = process.env.APPLY === '1'

  const all = await catalog.listJerseyDetails({}, { select: ['id'], take: 100000 })

  // details still reachable from a live product
  const { data: live } = await query.graph({
    entity: 'product',
    fields: ['id', 'jersey_detail.id'],
    pagination: { take: 100000, skip: 0 },
  })
  const reachable = new Set(
    (live as any[]).map((p) => p.jersey_detail?.id).filter(Boolean)
  )

  const orphans = all.filter((d: any) => !reachable.has(d.id)).map((d: any) => d.id)

  logger.info('')
  logger.info(`  jersey_detail rows   ${all.length}`)
  logger.info(`  reachable            ${reachable.size}`)
  logger.info(`  orphaned             ${orphans.length}`)

  if (!orphans.length) return logger.info('  nothing to prune.')
  if (!apply) {
    logger.info('')
    logger.info('  DRY RUN — re-run with APPLY=1 to delete them.')
    logger.info('')
    return
  }

  const BATCH = 200
  for (let i = 0; i < orphans.length; i += BATCH) {
    await catalog.deleteJerseyDetails(orphans.slice(i, i + BATCH))
  }
  const after = await catalog.listJerseyDetails({}, { select: ['id'], take: 100000 })
  logger.info('')
  logger.info(`  deleted ${orphans.length}; jersey_detail now ${after.length}`)
  logger.info('')
}
