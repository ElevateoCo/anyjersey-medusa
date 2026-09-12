/**
 * Re-import products whose variant structure changed in the pipeline.
 *
 * jersey_detail can be updated in place, but variant options cannot be reshaped
 * sensibly — a product that gains a Fit option needs rebuilding. This deletes and
 * recreates only the affected products, matched by title.
 *
 *   npx medusa exec ./src/scripts/reimport-changed.ts            # dry run
 *   APPLY=1 npx medusa exec ./src/scripts/reimport-changed.ts
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules, ProductStatus } from '@medusajs/framework/utils'
import { createProductsWorkflow, deleteProductsWorkflow } from '@medusajs/medusa/core-flows'
import { readFileSync } from 'fs'
import { join } from 'path'

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

export default async function reimport({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  const apply = process.env.APPLY === '1'

  const rows: any[] = JSON.parse(readFileSync(join(__dirname, 'catalog.json'), 'utf8'))
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')
  const byTitle = new Map(rows.map((r) => [norm(r.title), r]))

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'title', 'handle', 'options.title', 'options.values.value',
             'variants.id', 'variants.title', 'variants.sku'],
    pagination: { take: 100000, skip: 0 },
  })

  // A product needs rebuilding when its option titles or variant titles no longer match
  // what the pipeline now produces.
  const changed: { p: any; row: any; why: string }[] = []
  for (const p of products as any[]) {
    const row = byTitle.get(norm(p.title ?? ''))
    if (!row) continue
    const dbOpts = (p.options ?? []).map((o: any) => o.title).sort().join(',')
    const wantOpts = row.options.map((o: any) => o.title).sort().join(',')
    if (dbOpts !== wantOpts) { changed.push({ p, row, why: `options ${dbOpts} -> ${wantOpts}` }); continue }
    const dbV = (p.variants ?? []).map((v: any) => v.title).sort().join('|')
    const wantV = row.variants.map((v: any) => v.title).sort().join('|')
    if (dbV !== wantV) changed.push({ p, row, why: 'variant titles differ' })
  }

  logger.info('')
  logger.info(`  products checked   ${(products as any[]).length}`)
  logger.info(`  need rebuilding    ${changed.length}`)
  for (const c of changed.slice(0, 6)) logger.info(`    ${c.p.handle.slice(0, 46)}  (${c.why})`)
  if (!changed.length) return
  if (!apply) return logger.info('\n  DRY RUN — re-run with APPLY=1.\n')

  const channels = await salesChannelModule.listSalesChannels()
  const channel = channels.find((c) => c.name === 'Web') ?? channels[0]
  const { data: profiles } = await query.graph({ entity: 'shipping_profile', fields: ['id'] })
  const shippingProfileId = profiles[0]?.id

  await deleteProductsWorkflow(container).run({ input: { ids: changed.map((c) => c.p.id) } })
  logger.info(`  deleted ${changed.length}`)

  const BATCH = 50
  for (let i = 0; i < changed.length; i += BATCH) {
    const slice = changed.slice(i, i + BATCH)
    await createProductsWorkflow(container).run({
      input: {
        products: slice.map(({ row }) => ({
          title: row.title,
          handle: row.handle,
          description: row.description ?? undefined,
          status: row.status === 'published' ? ProductStatus.PUBLISHED : ProductStatus.DRAFT,
          shipping_profile_id: shippingProfileId,
          weight: 200,
          images: row.images.map((f: string) => ({ url: `${STATIC}/${encodeURIComponent(f)}` })),
          thumbnail: row.images[0] ? `${STATIC}/${encodeURIComponent(row.images[0])}` : undefined,
          options: row.options,
          variants: row.variants.map((v: any) => ({
            title: v.title, sku: v.sku, options: v.options,
            manage_inventory: false,
            prices: [{ amount: v.price, currency_code: 'usd' }],
          })),
          sales_channels: [{ id: channel.id }],
        })),
      },
    })
  }
  logger.info(`  recreated ${changed.length}`)
  logger.info('  NOTE: recreated products need their jersey_detail relinked —')
  logger.info('        run populate-catalog-details.ts, then prune-orphan-details.ts.')
  logger.info('')
}
