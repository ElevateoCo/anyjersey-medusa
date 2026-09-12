/**
 * Give the MMA range a sport.
 *
 * `layout-plan.md` §8 item 2. Ten fighters arrived from the live store with no sport, no
 * league and no team — the three columns every piece of navigation in this storefront is
 * keyed on — so they are unreachable from the nav bar, from a facet, and from the team
 * rail. They are not unreachable from *data*: all twelve are members of the `mma-2026`
 * collection, which is an editorial list a human curated, and that is a better signal than
 * anything derivable from the title.
 *
 * This is deliberately narrower than the plan's item 2. It sets `sport` and it trims a
 * garment word off the end of a fighter's name; it does **not** normalise `garment` across
 * the combos (item 3), because the two values in play — `set` and `shorts` — are both
 * legitimate for a combo listing and picking one by rule would be a guess about what is in
 * the parcel. The "Shorts & Kits" nav slot matches on both, so nothing in the layout waits
 * on that call.
 *
 *   npx medusa exec ./src/scripts/classify-mma.ts          # report only
 *   npx medusa exec ./src/scripts/classify-mma.ts write     # apply
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../modules/catalog'

const COLLECTION = 'mma-2026'
const SPORT = 'mma'

/**
 * "Ilia Topuria Short" and "Khabib Nurmagomedov Short" are the fighter plus the garment,
 * caught by the title parser because a combo listing names the garment where a jersey
 * listing names the team. Stripped only inside this collection: "Shorts" is not a surname
 * anywhere in it, and a global rule could not promise that.
 */
const trimGarmentWord = (name: string) =>
  name.replace(/\s+(shorts?|set|combo)$/i, '').trim()

export default async function classifyMma({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const catalog: any = container.resolve(CATALOG_MODULE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const write = args?.includes('write')

  const memberships = await catalog.listCollectionMemberships(
    { collection_handle: COLLECTION },
    { select: ['product_id'], take: 1000 }
  )
  const productIds = memberships.map((m: any) => m.product_id)
  if (!productIds.length) {
    logger.error(`No products in '${COLLECTION}'. Has import-collections run?`)
    return
  }

  // The detail is linked to the product, not keyed by it, so the ids have to come back
  // through the link rather than being looked up on jersey_detail directly.
  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'title', 'jersey_detail.id', 'jersey_detail.sport',
      'jersey_detail.player', 'jersey_detail.garment', 'jersey_detail.edition'],
    filters: { id: productIds } as any,
    pagination: { take: 1000, skip: 0 } as any,
  })

  const updates: { id: string; sport: string; player?: string }[] = []
  for (const p of products as any[]) {
    const d = p.jersey_detail
    if (!d?.id) {
      logger.warn(`no jersey_detail linked: ${p.title}`)
      continue
    }
    const player = d.player ? trimGarmentWord(d.player) : null
    const sportChanges = d.sport !== SPORT
    const playerChanges = !!player && player !== d.player
    if (!sportChanges && !playerChanges) continue
    updates.push({
      id: d.id,
      sport: SPORT,
      ...(playerChanges ? { player: player! } : {}),
    })
    logger.info(
      `${p.title}\n    sport ${d.sport ?? '(none)'} -> ${SPORT}` +
      (playerChanges ? `\n    player "${d.player}" -> "${player}"` : '')
    )
  }

  if (!updates.length) {
    logger.info(`Nothing to do — all ${products.length} already classified.`)
    return
  }
  if (!write) {
    logger.info(`\n${updates.length} of ${products.length} would change. ` +
      `Re-run with \`-- write\` to apply.`)
    return
  }

  await catalog.updateJerseyDetails(updates)
  logger.info(`Updated ${updates.length} of ${products.length} jersey_detail rows.`)
}
