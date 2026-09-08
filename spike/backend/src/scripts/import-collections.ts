import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'
import { readFileSync } from 'fs'
import { join } from 'path'
import { CATALOG_MODULE } from '../modules/catalog'

/**
 * Import the live store's curated collections.
 *
 *   npx medusa exec ./src/scripts/import-collections.ts            # report only
 *   APPLY=1 npx medusa exec ./src/scripts/import-collections.ts    # write
 *
 * The catalog's navigation is entirely facet-derived — league, team, colour, garment — which
 * answers "show me Chicago Bears shirts" perfectly and cannot answer "show me what is
 * selling" or "show me the World Cup range". Those are editorial: a human decided what
 * belongs, and no property of the product implies membership.
 *
 * Written into `curated_collection` / `collection_membership` rather than Medusa's own
 * `product_collection`, because a product belongs to at most one of those. See the model
 * for what that cost when it was tried.
 *
 * **Six of the live store's collections are deliberately not imported**, each because a
 * facet already answers it from data rather than from a list somebody has to maintain.
 * The reasons travel in the payload so they are visible in the report rather than only here.
 *
 * Idempotent: membership for a collection is replaced wholesale on each run, so re-importing
 * after the source changes converges rather than accumulating.
 */
type Payload = {
  source: string
  fetched_at: string
  excluded: Record<string, string>
  collections: {
    handle: string
    title: string
    description: string
    product_handles: string[]
  }[]
}

export default async function importCollections({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const catalog: any = container.resolve(CATALOG_MODULE)
  const apply = process.env.APPLY === '1'

  const payload: Payload = JSON.parse(
    readFileSync(join(__dirname, 'data', 'collections.json'), 'utf8')
  )

  // Matched on the source handle as well as the local one: the duplicate merge in Step 10
  // changed a thousand local handles, and `jersey_detail.source_handle` is the only thing
  // that still ties a row to the store it came from.
  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle', 'jersey_detail.source_handle'],
    pagination: { take: 100000, skip: 0 },
  })

  const byHandle = new Map<string, string>()
  for (const p of products as any[]) {
    byHandle.set(p.handle, p.id)
    const src = p.jersey_detail?.source_handle
    if (src && !byHandle.has(src)) byHandle.set(src, p.id)
  }

  logger.info('')
  logger.info(`  source            ${payload.source} (${payload.fetched_at})`)
  logger.info(`  collections       ${payload.collections.length}`)
  logger.info('')
  for (const [handle, why] of Object.entries(payload.excluded)) {
    logger.info(`  not imported: ${handle} — ${why}`)
  }
  logger.info('')

  const plan = payload.collections.map((c, i) => {
    const ids: string[] = []
    let unknown = 0
    for (const h of c.product_handles) {
      const id = byHandle.get(h)
      // A product may sit in several collections. That overlap is the point, and it is why
      // this is not a Medusa collection.
      if (id) ids.push(id)
      else unknown++
    }
    return { ...c, position: i, ids: [...new Set(ids)], unknown }
  })

  for (const c of plan) {
    logger.info(
      `  ${c.handle.padEnd(26)} ${String(c.ids.length).padStart(4)} products` +
      (c.unknown ? `  (${c.unknown} not in our catalog)` : '')
    )
  }
  const overlap = plan.reduce((n, c) => n + c.ids.length, 0) -
    new Set(plan.flatMap((c) => c.ids)).size
  logger.info('')
  logger.info(`  ${overlap} memberships are products that appear in more than one collection.`)
  logger.info('  All of them are kept — that is what a Medusa collection could not do.')
  logger.info('')

  if (!apply) {
    logger.info('  Report only. Re-run with APPLY=1 to create these.')
    return
  }

  let created = 0
  let updated = 0
  let memberships = 0

  for (const c of plan) {
    const [existing] = await catalog.listCuratedCollections({ handle: c.handle }, { take: 1 })
    if (existing) {
      await catalog.updateCuratedCollections({
        id: existing.id, title: c.title, description: c.description || null,
        position: c.position, active: true, source: 'cruxchristi.com',
      })
      updated++
    } else {
      await catalog.createCuratedCollections([{
        handle: c.handle, title: c.title, description: c.description || null,
        position: c.position, active: true, source: 'cruxchristi.com',
      }])
      created++
    }

    // Replace wholesale rather than merge: a product removed from the collection upstream
    // has to disappear here too, and a merge would leave it behind forever.
    const old = await catalog.listCollectionMemberships(
      { collection_handle: c.handle }, { select: ['id'], take: 100000 }
    )
    if (old.length) {
      await catalog.deleteCollectionMemberships(old.map((m: any) => m.id))
    }

    const BATCH = 500
    for (let i = 0; i < c.ids.length; i += BATCH) {
      await catalog.createCollectionMemberships(
        c.ids.slice(i, i + BATCH).map((product_id, n) => ({
          collection_handle: c.handle, product_id, position: i + n,
        }))
      )
    }
    memberships += c.ids.length
  }

  logger.info('')
  logger.info('  ┌─ COLLECTIONS IMPORTED ──────────────────────────────────')
  logger.info(`  │ created     ${created}`)
  logger.info(`  │ updated     ${updated}`)
  logger.info(`  │ memberships ${memberships}`)
  logger.info('  └─────────────────────────────────────────────────────────')
}
