import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'
import { CATALOG_MODULE } from '../modules/catalog'

/**
 * Link jersey_detail rows that have no product link, matching on `source_handle`.
 *
 *   npx medusa exec ./src/scripts/link-orphan-details.ts            # report only
 *   APPLY=1 npx medusa exec ./src/scripts/link-orphan-details.ts    # write
 *
 * Written because an import created 66 products and 66 detail rows and then failed on the
 * link step — `remoteLink.create` was passed the literal string `productService` instead of
 * `Modules.PRODUCT`, which resolves to no registered module. The products and details both
 * survived; only the join between them was missing, and a detail with no link is invisible
 * to every query in the app because the link *is* the join (Step 14's finding).
 *
 * That failure mode is not specific to that bug: any import that creates in two steps can
 * be interrupted between them. Repairing by `source_handle` is safe to run at any time and
 * does nothing when there is nothing to fix, so it belongs next to the other `fix-*`
 * scripts rather than in a one-off.
 */
export default async function linkOrphanDetails({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const catalog: any = container.resolve(CATALOG_MODULE)
  const apply = process.env.APPLY === '1'

  // Every detail, and every detail that is already linked to something.
  const details = await catalog.listJerseyDetails(
    {}, { select: ['id', 'source_handle', 'team', 'is_custom'], take: 100000 }
  )

  const { data: linked } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle', 'jersey_detail.id'],
    pagination: { take: 100000, skip: 0 },
  })

  const linkedDetailIds = new Set(
    (linked as any[]).map((p) => p.jersey_detail?.id).filter(Boolean)
  )
  const productByHandle = new Map(
    (linked as any[]).map((p) => [p.handle, p.id] as const)
  )

  const orphans = (details as any[]).filter((d) => !linkedDetailIds.has(d.id))

  const pairs: { detailId: string; productId: string; handle: string }[] = []
  const unmatched: string[] = []
  for (const d of orphans) {
    const productId = d.source_handle ? productByHandle.get(d.source_handle) : undefined
    if (productId) pairs.push({ detailId: d.id, productId, handle: d.source_handle })
    else unmatched.push(d.source_handle ?? d.id)
  }

  logger.info('')
  logger.info(`  detail rows        ${details.length}`)
  logger.info(`  already linked     ${linkedDetailIds.size}`)
  logger.info(`  orphaned           ${orphans.length}`)
  logger.info(`  repairable         ${pairs.length}`)
  logger.info(`  no matching product ${unmatched.length}`)
  if (unmatched.length) {
    // These are the ones `prune-orphan-details.ts` exists for — a detail whose product was
    // deleted, rather than one whose link was never written.
    logger.warn(`    ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? ' …' : ''}`)
  }

  if (!pairs.length) {
    logger.info('  nothing to link.')
    return
  }
  if (!apply) {
    logger.info('')
    logger.info('  Report only. Re-run with APPLY=1 to create these links.')
    return
  }

  await link.create(
    pairs.map((p) => ({
      [Modules.PRODUCT]: { product_id: p.productId },
      [CATALOG_MODULE]: { jersey_detail_id: p.detailId },
    }))
  )

  logger.info(`  linked ${pairs.length} detail row(s) to their products.`)
}
