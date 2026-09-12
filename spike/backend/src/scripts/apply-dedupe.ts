/**
 * Apply the merge from tools/dedupe.py to the database.
 *
 * Deletes the products that were folded into a survivor, and gives each survivor the
 * merged image set. Joined on title, for the reasons in sync-catalog-details.ts — slugs
 * move when the parser changes.
 *
 *   npx medusa exec ./src/scripts/apply-dedupe.ts             # dry run
 *   npx medusa exec ./src/scripts/apply-dedupe.ts -- apply
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { deleteProductsWorkflow, updateProductsWorkflow } from '@medusajs/medusa/core-flows'
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

export default async function applyDedupe({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  // `medusa exec -- apply` does not reliably forward args, so an env flag is the
  // dependable switch: APPLY=1 npx medusa exec ./src/scripts/apply-dedupe.ts
  const apply = process.env.APPLY === '1' || (args ?? []).includes('apply')

  const rows: any[] = JSON.parse(readFileSync(join(__dirname, 'catalog.json'), 'utf8'))
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')
  const survivors = new Map(rows.map((r) => [norm(r.title), r]))

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle', 'title', 'images.id', 'images.url'],
    pagination: { take: 100000, skip: 0 },
  })

  // Within a duplicate group only one product may survive. Keep the one whose image
  // count is highest — the same rule dedupe.py used — so both sides agree.
  const byTitle = new Map<string, any[]>()
  for (const p of products as any[]) {
    const k = norm(p.title ?? '')
    byTitle.set(k, [...(byTitle.get(k) ?? []), p])
  }

  const toDelete: string[] = []
  const toUpdate: { id: string; images: { url: string }[]; thumbnail?: string }[] = []

  for (const [title, group] of byTitle) {
    const row = survivors.get(title)
    if (!row) {
      // title vanished entirely from the merged catalog — should not happen
      toDelete.push(...group.map((p) => p.id))
      continue
    }
    const keep = group.reduce((a, b) =>
      (b.images?.length ?? 0) > (a.images?.length ?? 0) ? b : a)
    toDelete.push(...group.filter((p) => p.id !== keep.id).map((p) => p.id))

    const wanted = (row.images as string[]).map((f) => `${STATIC}/${encodeURIComponent(f)}`)
    const current = (keep.images ?? []).map((i: any) => i.url)
    if (wanted.length && (wanted.length !== current.length ||
        wanted.some((u, i) => u !== current[i]))) {
      toUpdate.push({ id: keep.id, images: wanted.map((url) => ({ url })), thumbnail: wanted[0] })
    }
  }

  logger.info('')
  logger.info(`  products in db         ${(products as any[]).length}`)
  logger.info(`  survivors in catalog   ${rows.length}`)
  logger.info(`  to delete              ${toDelete.length}`)
  logger.info(`  image sets to rewrite  ${toUpdate.length}`)

  if (!apply) {
    logger.info('')
    logger.info('  DRY RUN — re-run with APPLY=1 to make these changes.')
    logger.info('')
    return
  }

  const BATCH = 100
  for (let i = 0; i < toUpdate.length; i += BATCH) {
    const slice = toUpdate.slice(i, i + BATCH)
    await updateProductsWorkflow(container).run({
      input: { products: slice.map((u) => ({ id: u.id, images: u.images, thumbnail: u.thumbnail })) } as any,
    }).catch((e: any) => logger.warn(`  image update batch failed: ${String(e?.message).slice(0, 120)}`))
    if ((i / BATCH) % 5 === 0) logger.info(`  images ${Math.min(i + BATCH, toUpdate.length)}/${toUpdate.length}`)
  }

  for (let i = 0; i < toDelete.length; i += BATCH) {
    await deleteProductsWorkflow(container).run({ input: { ids: toDelete.slice(i, i + BATCH) } })
    if ((i / BATCH) % 2 === 0) logger.info(`  deleted ${Math.min(i + BATCH, toDelete.length)}/${toDelete.length}`)
  }

  const { data: after } = await query.graph({
    entity: 'product', fields: ['id'], pagination: { take: 100000, skip: 0 },
  })
  logger.info('')
  logger.info('  ┌─ DEDUPE APPLIED ────────────────────────────────────────')
  logger.info(`  │ deleted        ${toDelete.length}`)
  logger.info(`  │ image sets set ${toUpdate.length}`)
  logger.info(`  │ products now   ${(after as any[]).length}`)
  logger.info('  └─────────────────────────────────────────────────────────')
  logger.info('')
}
