/**
 * Re-sync jersey_detail from catalog.json after a parser or vocabulary change.
 *
 * Only writes rows whose taxonomy actually differs, and reports what moved — so a
 * vocabulary fix is auditable rather than a silent mass update. The regulatory columns
 * are never touched: they are filled by hand and must survive a re-sync.
 *
 *   npx medusa exec ./src/scripts/sync-catalog-details.ts
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { readFileSync } from 'fs'
import { join } from 'path'
import { CATALOG_MODULE } from '../modules/catalog'

const TAXONOMY = ['sport', 'league', 'team', 'player', 'colourway', 'season', 'edition', 'garment'] as const

export default async function sync({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const catalog: any = container.resolve(CATALOG_MODULE)

  const rows: any[] = JSON.parse(readFileSync(join(__dirname, 'catalog.json'), 'utf8'))
  /**
   * Joined on TITLE, not handle.
   *
   * Slugs are derived from parsed fields, so a parser improvement rewrites them — 1,411
   * of 3,591 no longer equal the original Shopify handle. And the first populate run
   * wrote the *slug* into source_handle rather than the Shopify handle, so that column
   * was not a stable key either (it is repaired below). The product title comes straight
   * from the source and does not move, which makes it the only reliable join here.
   */
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')
  const byTitle = new Map(rows.map((r) => [norm(r.title), r]))

  const { data: linked } = await query.graph({
    entity: 'product',
    fields: ['handle', 'title', 'jersey_detail.*'],
    pagination: { take: 100000, skip: 0 },
  })

  const updates: any[] = []
  const changes: Record<string, number> = {}
  let gainedTeam = 0
  let clearedReview = 0
  const slugDrift: { was: string; now: string }[] = []
  let unmatched = 0
  let repairedSource = 0

  for (const p of linked as any[]) {
    const detail = p.jersey_detail
    const row = byTitle.get(norm(p.title ?? ''))
    if (!detail || !row) { if (detail) unmatched += 1; continue }

    const next: any = { id: detail.id }
    let dirty = false
    for (const f of TAXONOMY) {
      const want = row.taxonomy[f] ?? null
      if ((detail[f] ?? null) !== want) {
        next[f] = want
        dirty = true
        changes[f] = (changes[f] ?? 0) + 1
        if (f === 'team' && !detail.team && want) gainedTeam += 1
      }
    }
    if (detail.source_handle && row.handle && p.handle !== row.handle) {
      slugDrift.push({ was: p.handle, now: row.handle })
    }
    // repair: the first populate run stored the slug here instead of the Shopify handle
    if (row.source_handle && detail.source_handle !== row.source_handle) {
      next.source_handle = row.source_handle
      dirty = true
      repairedSource += 1
    }
    for (const [f, want] of [['search_text', row.search_text ?? null],
                             ['seo_title', row.seo?.title ?? null],
                             ['seo_description', row.seo?.description ?? null],
                             ['needs_review', !!row.needs_review]] as const) {
      if ((detail as any)[f] !== want) {
        next[f] = want
        dirty = true
        if (f === 'needs_review' && detail.needs_review && !want) clearedReview += 1
      }
    }
    if (dirty) updates.push(next)
  }

  logger.info('')
  logger.info(`  products checked      ${(linked as any[]).length}`)
  logger.info(`  rows needing update   ${updates.length}`)
  if (!updates.length) return logger.info('  already in sync.')

  const BATCH = 200
  for (let i = 0; i < updates.length; i += BATCH) {
    await catalog.updateJerseyDetails(updates.slice(i, i + BATCH))
  }

  logger.info('')
  logger.info('  ┌─ SYNC COMPLETE ─────────────────────────────────────────')
  logger.info(`  │ updated              ${updates.length}`)
  logger.info(`  │ gained a team        ${gainedTeam}`)
  logger.info(`  │ needs_review cleared ${clearedReview}`)
  logger.info(`  │ source_handle fixed  ${repairedSource}`)
  if (unmatched) logger.info(`  │ unmatched by title   ${unmatched}`)
  for (const [f, n] of Object.entries(changes).sort((a, b) => b[1] - a[1])) {
    logger.info(`  │   ${f.padEnd(18)} ${n}`)
  }
  logger.info('  │ regulatory columns untouched, as designed')
  logger.info('  └─────────────────────────────────────────────────────────')
  if (slugDrift.length) {
    logger.info('')
    logger.warn(`  ${slugDrift.length} product slugs are now stale relative to the parser.`)
    logger.warn('  Free to change on a greenfield store — there is nothing to redirect —')
    logger.warn('  but Medusa product handles were NOT rewritten here. Examples:')
    for (const d of slugDrift.slice(0, 5)) logger.warn(`    ${d.was}  ->  ${d.now}`)
  }
  logger.info('')
}
