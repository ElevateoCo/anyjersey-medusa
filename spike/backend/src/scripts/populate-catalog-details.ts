/**
 * Step 2 — populate jersey_detail from catalog.json and link each row to its product.
 *
 * Idempotent: products that already have a detail are skipped, so a failed run can be
 * re-run safely.
 *
 *   npx medusa exec ./src/scripts/populate-catalog-details.ts
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { readFileSync } from 'fs'
import { join } from 'path'
import { CATALOG_MODULE } from '../modules/catalog'

export default async function populate({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const catalog: any = container.resolve(CATALOG_MODULE)

  // Same payload argument as import-catalog.ts, so the two halves of one import cannot be
  // run against different files.
  const file = String(args?.[0] ?? 'catalog.json').replace(/[^a-zA-Z0-9._-]/g, '')
  const rows: any[] = JSON.parse(readFileSync(join(__dirname, file), 'utf8'))
  const byHandle = new Map(rows.map((r) => [r.handle, r]))

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle'],
    pagination: { take: 100000, skip: 0 },
  })

  // which products already have a detail linked?
  const { data: linked } = await query.graph({
    entity: 'product',
    fields: ['id', 'jersey_detail.id'],
    pagination: { take: 100000, skip: 0 },
  })
  const done = new Set(
    linked.filter((p: any) => p.jersey_detail?.id).map((p: any) => p.id)
  )

  const todo = products.filter((p: any) => byHandle.has(p.handle) && !done.has(p.id))
  logger.info('')
  logger.info(`  payload             ${file}`)
  logger.info(`  products            ${products.length}`)
  logger.info(`  already have detail ${done.size}`)
  logger.info(`  to populate         ${todo.length}`)
  logger.info('')

  if (!todo.length) return logger.info('  nothing to do.')

  const started = Date.now()
  const BATCH = 200
  let created = 0
  const failures: string[] = []

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH)
    const payload = batch.map((p: any) => {
      const r = byHandle.get(p.handle)!
      return {
        ...r.taxonomy,
        garment: r.taxonomy.garment ?? 'jersey',
        search_text: r.search_text ?? null,
        seo_title: r.seo?.title ?? null,
        seo_description: r.seo?.description ?? null,
        needs_review: !!r.needs_review,
        // A blank shirt sold to be printed. Set from the payload rather than re-derived,
        // so the rule that decided it lives in one place.
        is_custom: !!r.is_custom,
        source_platform: 'shopify',
        source_handle: r.source_handle ?? r.handle,
        // regulatory block intentionally left null — research.md §13.5
      }
    })

    try {
      const details = await catalog.createJerseyDetails(payload)
      await link.create(
        details.map((d: any, idx: number) => ({
          [Modules.PRODUCT]: { product_id: batch[idx].id },
          [CATALOG_MODULE]: { jersey_detail_id: d.id },
        }))
      )
      created += details.length
    } catch (e: any) {
      failures.push(`${batch[0].handle}…: ${String(e?.message ?? e).slice(0, 140)}`)
    }

    const pct = Math.round(((i + batch.length) / todo.length) * 100)
    if (pct % 20 === 0 || i + BATCH >= todo.length) {
      logger.info(`  ${String(pct).padStart(3)}%  ${created}/${todo.length}`)
    }
  }

  logger.info('')
  logger.info('  ┌─ CATALOG DETAILS POPULATED ─────────────────────────────')
  logger.info(`  │ created   ${created}`)
  logger.info(`  │ failed    ${failures.length}`)
  logger.info(`  │ elapsed   ${((Date.now() - started) / 1000).toFixed(1)}s`)
  logger.info('  └─────────────────────────────────────────────────────────')
  for (const f of failures.slice(0, 10)) logger.warn(`    ${f}`)
  logger.info('')
}
