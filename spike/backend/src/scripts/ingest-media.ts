/**
 * Optimise the image archive and store the bytes in Postgres.
 *
 *   npx medusa exec ./src/scripts/ingest-media.ts              # dry run: report only
 *   APPLY=1 npx medusa exec ./src/scripts/ingest-media.ts
 *   APPLY=1 WIDTH=1400 QUALITY=78 npx medusa exec ./src/scripts/ingest-media.ts
 *
 * Idempotent: assets are keyed by the sha256 of the *source* file, so re-running skips
 * anything already stored and never duplicates.
 *
 * After ingest it rewrites every product's image URLs to /store/media/<sha>.webp, so the
 * storefront stops depending on a symlink into a Downloads folder.
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { updateProductsWorkflow } from '@medusajs/medusa/core-flows'
import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { basename, join } from 'path'
import sharp from 'sharp'
import { assetUrl, ensureTable, getAsset, putAsset, assetStats } from '../media-store'

/**
 * The image archive, from the environment rather than hardcoded.
 *
 * This was an absolute path into `~/Downloads`, and `static/media` was a symlink pointing
 * at the same place so Medusa could serve the files over HTTP during an import. Both are
 * gone, and the reason is worth keeping:
 *
 * **macOS gates `~/Downloads` and `~/Desktop` behind a privacy prompt, and a prompt nobody
 * can answer blocks the syscall rather than failing it.** `medusa build` scans `static/`,
 * followed the symlink, and stopped dead inside `open()` — not an error, not a timeout,
 * just a process sitting at 1.5 seconds of CPU for twenty minutes. It cost a day
 * (`hist.md`, 2026-09-10) and the diagnosis needed a stack sample, because nothing in the
 * output said anything was wrong.
 *
 * Granting Full Disk Access fixes it on one machine, which is what happened here — the
 * build completes today. It does not fix it on a colleague's machine or in CI, where
 * there is no one to click the prompt. So the dependency is gone instead: the assets this
 * script produced are already in Postgres and the storefront reads them from `/media/<sha>`,
 * so nothing in normal operation touches the archive at all.
 *
 * Set `MEDIA_ARCHIVE_DIR` to re-run an ingest. **Do not put the archive back inside the
 * project tree**, and if it must live under `~/Downloads`, point the variable at it rather
 * than symlinking — a variable that is unset fails loudly, and a symlink into a gated
 * folder hangs.
 */
const ARCHIVE = process.env.MEDIA_ARCHIVE_DIR ?? ''
// Fallback index over the serving directory.
//
// Added while chasing a gap that turned out not to exist: 1,038 image rows and 532 product
// thumbnails still pointed at the local path after the first run, which looked like the
// archive's checksum file being an incomplete index. It wasn't — every one of those rows
// belongs to a soft-deleted product from the duplicate merge. All 4,825 live image rows
// were repointed.
//
// It stays because the archive genuinely is a point-in-time snapshot and a future image
// added straight to the serving directory would otherwise be silently skipped. Hashing on
// demand keeps such a file content-addressed like every other, so it can never collide
// with a different image under the same name.
/**
 * The serving directory, if one is configured.
 *
 * Was `static/media` — the symlink. It is optional now: with no archive and no serving
 * directory there is simply nothing to ingest, which is the normal state.
 */
const LOCAL = process.env.MEDIA_SERVING_DIR ?? ''

export default async function ingest({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  // Refuse clearly rather than reading an empty path and reporting nothing to do, which is
  // indistinguishable from a completed run.
  if (!ARCHIVE) {
    logger.error(
      'MEDIA_ARCHIVE_DIR is not set, so there is no archive to ingest from.\n' +
      '  This is the normal state: the 4,635 assets this script produced are already in\n' +
      '  Postgres and every product image URL points at /media/<sha>.\n' +
      '  Set it only to re-run an ingest, and point it at the archive directly rather\n' +
      '  than symlinking the archive into the project — see the note on ARCHIVE.'
    )
    return
  }
  if (!existsSync(ARCHIVE)) {
    logger.error(`MEDIA_ARCHIVE_DIR does not exist: ${ARCHIVE}`)
    return
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const apply = process.env.APPLY === '1'
  const width = Number(process.env.WIDTH ?? 1400)
  const quality = Number(process.env.QUALITY ?? 78)

  await ensureTable(container)

  // sha256 (of the source file) -> local path, from the archive's own checksum file
  const bySha = new Map<string, string>()
  for (const line of readFileSync(join(ARCHIVE, 'checksums.sha256'), 'utf8').split('\n')) {
    if (!line.includes('  ')) continue
    const [digest, rel] = line.split('  ')
    const p = join(ARCHIVE, rel.trim())
    if (existsSync(p)) bySha.set(digest.trim(), p)
  }

  // which images do the products actually reference?
  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle', 'thumbnail', 'images.id', 'images.url'],
    pagination: { take: 100000, skip: 0 },
  })

  const fileToSha = new Map<string, string>()
  for (const [sha, path] of bySha) fileToSha.set(basename(path), sha)

  // Second index: filename -> local path, for anything the snapshot missed. Listing the
  // directory once beats stat-ing per URL, and the archive still wins on a name collision
  // because it is the audited copy.
  const localFiles = new Map<string, string>()
  if (existsSync(LOCAL)) {
    for (const f of readdirSync(LOCAL)) localFiles.set(f, join(LOCAL, f))
  }
  let fromLocal = 0

  // Product image URLs currently end in the archive filename; map back to a sha.
  const wanted = new Map<string, string>() // sha -> path
  const perProduct = new Map<string, string[]>() // product id -> ordered shas
  for (const p of products as any[]) {
    const shas: string[] = []
    for (const img of (p.images ?? [])) {
      const file = decodeURIComponent(String(img.url).split('/').pop() ?? '')
      let sha = fileToSha.get(file)
      let path = sha ? bySha.get(sha) : undefined

      if (!path && localFiles.has(file)) {
        // Not in the snapshot. Hash the local file so the sha still identifies content
        // rather than a filename — the whole store is content-addressed, and a name-keyed
        // fallback would let two different images share an id.
        path = localFiles.get(file)!
        sha = createHash('sha256').update(readFileSync(path)).digest('hex')
        fileToSha.set(file, sha)
        bySha.set(sha, path)
        fromLocal++
      }

      if (sha && path) {
        wanted.set(sha, path)
        shas.push(sha)
      }
    }
    if (shas.length) perProduct.set(p.id, shas)
  }

  if (process.env.DEBUG_MEDIA === '1') {
    const rows = (products as any[]).flatMap((p) => p.images ?? [])
    logger.info(`  DEBUG products=${(products as any[]).length} imageRows=${rows.length} localIndex=${localFiles.size}`)
    logger.info(`  DEBUG sample=${JSON.stringify(rows.slice(0, 2).map((r) => r.url))}`)
  }

  const before = await assetStats(container)
  logger.info('')
  logger.info(`  archive files          ${bySha.size - fromLocal}`)
  logger.info(`  found only locally     ${fromLocal}`)
  logger.info(`  referenced by products ${wanted.size}`)
  logger.info(`  already stored         ${before.count} (${(before.total_bytes / 1048576).toFixed(1)} MB)`)
  logger.info(`  target                 webp q${quality}, max ${width}px`)

  if (!apply) {
    logger.info('')
    logger.info('  DRY RUN — re-run with APPLY=1 to encode and store.')
    logger.info('')
    return
  }

  let stored = 0
  let skipped = 0
  let failed = 0
  let rawBytes = 0
  let outBytes = 0
  const started = Date.now()
  const shas = [...wanted.keys()]

  for (let i = 0; i < shas.length; i++) {
    const sha = shas[i]
    if (await getAsset(container, sha)) { skipped++; continue }
    try {
      const src = readFileSync(wanted.get(sha)!)
      rawBytes += src.length
      const img = sharp(src).rotate().resize({ width, withoutEnlargement: true })
      const data = await img.webp({ quality }).toBuffer()
      const meta = await sharp(data).metadata()
      outBytes += data.length
      await putAsset(container, {
        id: `mda_${sha.slice(0, 24)}`,
        sha256: sha,
        mime: 'image/webp',
        width: meta.width ?? null,
        height: meta.height ?? null,
        bytes: data.length,
        data,
      })
      stored++
    } catch (e) {
      failed++
      logger.warn(`  failed ${sha.slice(0, 12)}: ${e instanceof Error ? e.message : e}`)
    }
    if ((i + 1) % 500 === 0) {
      const rate = (i + 1) / ((Date.now() - started) / 1000)
      logger.info(`  ${i + 1}/${shas.length}  ${rate.toFixed(0)}/s  stored ${stored}`)
    }
  }

  // point the product records at the database-backed URLs
  const updates = [...perProduct.entries()].map(([id, list]) => ({
    id,
    images: list.map((sha) => ({ url: assetUrl(sha) })),
    thumbnail: assetUrl(list[0]),
  }))
  const BATCH = 100
  for (let i = 0; i < updates.length; i += BATCH) {
    await updateProductsWorkflow(container).run({
      input: { products: updates.slice(i, i + BATCH) } as any,
    }).catch((e: any) => logger.warn(`  url batch failed: ${String(e?.message).slice(0, 120)}`))
  }

  const after = await assetStats(container)
  logger.info('')
  logger.info('  ┌─ MEDIA INGESTED ────────────────────────────────────────')
  logger.info(`  │ encoded and stored   ${stored}`)
  logger.info(`  │ already present      ${skipped}`)
  logger.info(`  │ failed               ${failed}`)
  logger.info(`  │ source bytes         ${(rawBytes / 1073741824).toFixed(2)} GB`)
  logger.info(`  │ stored bytes         ${(outBytes / 1048576).toFixed(0)} MB` +
              (rawBytes ? `  (${(100 * outBytes / rawBytes).toFixed(0)}% of source)` : ''))
  logger.info(`  │ table total          ${after.count} rows, ${(after.total_bytes / 1048576).toFixed(0)} MB`)
  logger.info(`  │ products repointed   ${updates.length}`)
  logger.info(`  │ elapsed              ${((Date.now() - started) / 1000).toFixed(0)}s`)
  logger.info('  └─────────────────────────────────────────────────────────')
  logger.info('')
}
