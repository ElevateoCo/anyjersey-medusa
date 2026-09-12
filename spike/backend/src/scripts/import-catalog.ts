/**
 * Step 1 — import the extracted catalog into Medusa at full scale.
 *
 * Reads catalog.json (built by tools/build_import_json.py) and creates products in
 * batches. Idempotent by handle: anything already present is skipped, so a failed run
 * can simply be re-run.
 *
 *   npx medusa exec ./src/scripts/import-catalog.ts              # everything
 *   npx medusa exec ./src/scripts/import-catalog.ts -- 25        # first 25 (smoke test)
 *   npx medusa exec ./src/scripts/import-catalog.ts -- 0 100     # all, batches of 100
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules, ProductStatus } from '@medusajs/framework/utils'
import { createProductsWorkflow } from '@medusajs/medusa/core-flows'
import { readFileSync } from 'fs'
import { join } from 'path'

type Row = {
  handle: string
  title: string
  description: string | null
  status: 'published' | 'draft'
  price: number
  options: { title: string; values: string[] }[]
  variants: { title: string; sku: string; options: Record<string, string>; price: number }[]
  images: string[]
  taxonomy: Record<string, string | null>
  seo: { title: string | null; description: string | null }
  needs_review: boolean
}

/**
 * Where the importer can reach the archive's images over HTTP.
 *
 * Was `http://localhost:9000/static/media`, served through a symlink from `static/media`
 * into `~/Downloads`. That symlink is gone — macOS gates that folder behind a privacy
 * prompt, and `medusa build` scanning `static/` blocked inside `open()` rather than
 * failing (`hist.md`, 2026-09-10).
 *
 * Only a fresh import needs this. Every live image already lives in Postgres and is served
 * from `/media/<sha>`, so nothing in normal operation reads it. Set `MEDIA_HTTP_BASE` and
 * serve the archive from somewhere — anywhere but a symlink into a privacy-gated folder
 * inside the project tree.
 */
const STATIC = process.env.MEDIA_HTTP_BASE ?? 'http://localhost:9000/static/media'

/** A local blob name becomes a static URL; an absolute URL is passed through untouched. */
const mediaUrl = (f: string) =>
  /^https?:\/\//i.test(f) ? f : `${STATIC}/${encodeURIComponent(f)}`

export default async function importCatalog({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)

  const limit = Number(args?.[0] ?? 0) || 0
  const batchSize = Number(args?.[1] ?? 0) || 50

  /**
   * Which payload to import. Defaults to the archive import; `catalog-sync.json` is the
   * live-store delta produced by `tools/sync_live_catalog.py`.
   *
   * A named file rather than a merged one, so a sync can be reviewed in a diff and re-run
   * without touching the 3,155 rows that came out of the archive.
   */
  const file = String(args?.[2] ?? 'catalog.json').replace(/[^a-zA-Z0-9._-]/g, '')
  const rows: Row[] = JSON.parse(readFileSync(join(__dirname, file), 'utf8'))

  // ------------------------------------------------------------ prerequisites
  const channels = await salesChannelModule.listSalesChannels()
  const channel = channels.find((c) => c.name === 'Web') ?? channels[0]
  if (!channel) throw new Error('no sales channel — run seed-spike.ts first')

  const { data: profiles } = await query.graph({
    entity: 'shipping_profile',
    fields: ['id', 'name'],
  })
  const shippingProfileId = profiles[0]?.id
  if (!shippingProfileId) throw new Error('no shipping profile — run seed-spike.ts first')

  const { data: existing } = await query.graph({
    entity: 'product',
    fields: ['handle'],
    pagination: { take: 100000, skip: 0 },
  })
  const have = new Set(existing.map((p: any) => p.handle))

  const todo = rows.filter((r) => !have.has(r.handle)).slice(0, limit || undefined)

  logger.info('')
  logger.info(`  payload           ${file}`)
  logger.info(`  catalog rows      ${rows.length}`)
  logger.info(`  already imported  ${have.size}`)
  logger.info(`  to import         ${todo.length}   (batches of ${batchSize})`)
  logger.info('')

  if (!todo.length) {
    logger.info('  nothing to do.')
    return
  }

  // ------------------------------------------------------------ import
  const started = Date.now()
  let done = 0
  let variants = 0
  const failures: { handle: string; error: string }[] = []

  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize)
    const products = batch.map((r) => ({
      title: r.title,
      handle: r.handle,
      description: r.description ?? undefined,
      status: r.status === 'published' ? ProductStatus.PUBLISHED : ProductStatus.DRAFT,
      shipping_profile_id: shippingProfileId,
      weight: 200,
      // Archive imports carry a local blob filename; a live-store sync carries an absolute
      // CDN URL. Prefixing an absolute URL with the static mount produces a 404 for every
      // image, so the two cases are distinguished rather than assumed.
      images: r.images.map((f) => ({ url: mediaUrl(f) })),
      thumbnail: r.images[0] ? mediaUrl(r.images[0]) : undefined,
      options: r.options.map((o) => ({ title: o.title, values: o.values })),
      variants: r.variants.map((v) => ({
        title: v.title,
        sku: v.sku,
        options: v.options,
        // Sourcing model: always buyable, never "sold out". research.md §12.1
        manage_inventory: false,
        prices: [{ amount: v.price, currency_code: 'usd' }],
      })),
      sales_channels: [{ id: channel.id }],
    }))

    try {
      await createProductsWorkflow(container).run({ input: { products } })
      done += batch.length
      variants += batch.reduce((n, r) => n + r.variants.length, 0)
    } catch (e: any) {
      // One bad row should not lose the batch — retry the batch one product at a time.
      for (const [idx, single] of products.entries()) {
        try {
          await createProductsWorkflow(container).run({ input: { products: [single] } })
          done += 1
          variants += batch[idx].variants.length
        } catch (inner: any) {
          failures.push({ handle: batch[idx].handle, error: String(inner?.message ?? inner).slice(0, 160) })
        }
      }
    }

    const pct = Math.round(((i + batch.length) / todo.length) * 100)
    const elapsed = (Date.now() - started) / 1000
    const rate = done / Math.max(elapsed, 0.001)
    const eta = rate > 0 ? Math.round((todo.length - done) / rate) : 0
    logger.info(
      `  ${String(pct).padStart(3)}%  ${done}/${todo.length} products, ` +
      `${variants} variants  ·  ${rate.toFixed(1)}/s  ·  eta ${eta}s` +
      (failures.length ? `  ·  ${failures.length} failed` : '')
    )
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1)
  logger.info('')
  logger.info('  ┌─ IMPORT COMPLETE ───────────────────────────────────────')
  logger.info(`  │ products   ${done}`)
  logger.info(`  │ variants   ${variants}`)
  logger.info(`  │ failed     ${failures.length}`)
  logger.info(`  │ elapsed    ${secs}s`)
  logger.info('  └─────────────────────────────────────────────────────────')
  if (failures.length) {
    logger.warn('')
    logger.warn('  failures (first 15):')
    for (const f of failures.slice(0, 15)) logger.warn(`    ${f.handle}: ${f.error}`)
  }
  logger.info('')
}
