import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { updateProductsWorkflow } from '@medusajs/medusa/core-flows'
import type { ExecArgs } from '@medusajs/framework/types'
import { createHash } from 'crypto'
import sharp from 'sharp'
import { assetUrl, ensureTable, getAsset, putAsset } from '../media-store'

/**
 * Pull product images that still live on a remote CDN into Postgres.
 *
 *   npx medusa exec ./src/scripts/ingest-remote-media.ts            # report only
 *   APPLY=1 npx medusa exec ./src/scripts/ingest-remote-media.ts    # download and store
 *
 * `ingest-media.ts` reads the 2026-08-18 archive off disk. The custom-jersey line did not
 * exist when that archive was taken, so its images are on the source store's CDN — which
 * makes every product page depend on a third party staying up and quietly tells them how
 * much traffic we have.
 *
 * Same encoding as the archive path (WebP q78 at 1400px), same content addressing, so an
 * image already stored under either route is skipped rather than duplicated.
 *
 * Failure is per-image and never fatal. A product keeps its remote URL if the download
 * fails, which renders correctly and can be retried, whereas repointing before a successful
 * store would blank the tile.
 */
const DEFAULT_WIDTH = 1400
const DEFAULT_QUALITY = 78
/** Deliberately serial-ish: this is somebody else's CDN, not ours. */
const CONCURRENCY = 4

export default async function ingestRemoteMedia({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const apply = process.env.APPLY === '1'
  const width = Number(process.env.WIDTH ?? DEFAULT_WIDTH)
  const quality = Number(process.env.QUALITY ?? DEFAULT_QUALITY)

  await ensureTable(container)

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle', 'thumbnail', 'images.url'],
    pagination: { take: 100000, skip: 0 },
  })

  const remote = (products as any[])
    .map((p) => ({
      id: p.id,
      handle: p.handle,
      urls: [...new Set(
        ((p.images ?? []).map((i: any) => i.url) as string[])
          .concat(p.thumbnail ? [p.thumbnail] : [])
          .filter((u) => /^https?:\/\//i.test(u))
      )],
    }))
    .filter((p) => p.urls.length > 0)

  logger.info('')
  logger.info(`  products with remote images  ${remote.length}`)
  logger.info(`  images to fetch              ${remote.reduce((n, p) => n + p.urls.length, 0)}`)

  if (!remote.length) {
    logger.info('  nothing to do — every image is already served from the database.')
    return
  }
  if (!apply) {
    for (const p of remote.slice(0, 5)) logger.info(`    ${p.handle}  ${p.urls[0].slice(0, 90)}`)
    if (remote.length > 5) logger.info(`    … and ${remote.length - 5} more`)
    logger.info('')
    logger.info('  Report only. Re-run with APPLY=1 to download and store these.')
    return
  }

  let stored = 0
  let skipped = 0
  let failed = 0
  let outBytes = 0
  const started = Date.now()
  /** product id -> the content addresses to repoint it to, in order. */
  const perProduct = new Map<string, string[]>()

  async function fetchOne(url: string): Promise<string | null> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const src = Buffer.from(await res.arrayBuffer())

    // Address the *encoded* bytes, not the source, so an image already ingested from the
    // archive under the same encoding collapses onto one row.
    const data = await sharp(src).rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer()
    const sha = createHash('sha256').update(data).digest('hex')

    if (await getAsset(container, sha)) { skipped++; return sha }

    const meta = await sharp(data).metadata()
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
    outBytes += data.length
    return sha
  }

  for (let i = 0; i < remote.length; i += CONCURRENCY) {
    const batch = remote.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (p) => {
      const shas: string[] = []
      for (const url of p.urls) {
        try {
          const sha = await fetchOne(url)
          if (sha) shas.push(sha)
        } catch (e) {
          failed++
          logger.warn(`  failed ${p.handle}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      // Only repoint a product whose images all landed. A partial repoint would drop the
      // ones that failed rather than leaving them retryable.
      if (shas.length === p.urls.length) perProduct.set(p.id, shas)
    }))
    if ((i + batch.length) % 20 === 0 || i + batch.length >= remote.length) {
      logger.info(`  ${i + batch.length}/${remote.length}  stored ${stored}  failed ${failed}`)
    }
  }

  const updates = [...perProduct.entries()].map(([id, shas]) => ({
    id,
    images: shas.map((sha) => ({ url: assetUrl(sha) })),
    thumbnail: assetUrl(shas[0]),
  }))
  const BATCH = 100
  for (let i = 0; i < updates.length; i += BATCH) {
    await updateProductsWorkflow(container).run({
      input: { products: updates.slice(i, i + BATCH) } as any,
    }).catch((e: any) => logger.warn(`  url batch failed: ${String(e?.message).slice(0, 120)}`))
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1)
  logger.info('')
  logger.info('  ┌─ REMOTE MEDIA INGESTED ─────────────────────────────────')
  logger.info(`  │ stored     ${stored} (${(outBytes / 1024 / 1024).toFixed(1)} MB)`)
  logger.info(`  │ already had ${skipped}`)
  logger.info(`  │ failed     ${failed}`)
  logger.info(`  │ repointed  ${updates.length} product(s)`)
  logger.info(`  │ took       ${secs}s`)
  logger.info('  └─────────────────────────────────────────────────────────')
}
