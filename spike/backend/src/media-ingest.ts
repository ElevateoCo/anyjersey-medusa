import sharp from 'sharp'
import { createHash } from 'crypto'
import type { MedusaContainer } from '@medusajs/framework/types'
import { assetUrl, getAsset, putAsset, ensureTable } from './media-store'

/**
 * One image, optimised and stored, from wherever it came from.
 *
 * This is `scripts/ingest-media.ts` lifted out of the script so the admin upload endpoint
 * runs the *same* pipeline rather than a second one that drifts. The parameters are the
 * measured ones: WebP at q78 capped at 1400px is about 21% of the raw archive — 410 MB
 * rather than 3.09 GB — and everything below 1400 is rendered on request by the media
 * route instead of being stored per breakpoint.
 *
 * **Content-addressed, so uploading is idempotent.** The sha256 is of the *encoded* bytes,
 * not the source file, so two source files that optimise to identical output share one row
 * and one URL. Dragging the same photo in twice costs nothing and produces no duplicate —
 * which matters more in an admin UI than in a script, because a person will do it.
 *
 * `.rotate()` before resizing is not decorative. It applies the EXIF orientation and then
 * strips the tag; without it a photo taken on a phone in portrait is stored rotated, and
 * every derivative the media route renders inherits the rotation.
 */
export const MAX_WIDTH = Number(process.env.MEDIA_MAX_WIDTH ?? 1400)
export const QUALITY = Number(process.env.MEDIA_QUALITY ?? 78)

/** 15 MB. A phone photo is 3-5 MB; anything past this is a mistake or an attack. */
export const MAX_UPLOAD_BYTES = Number(process.env.MEDIA_MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024)

export type StoredAsset = {
  sha256: string
  url: string
  width: number | null
  height: number | null
  bytes: number
  /** True when these bytes were already stored — the caller may want to say so. */
  deduped: boolean
}

/**
 * What sharp will accept from an upload.
 *
 * Checked against the *decoded* image rather than the declared content type, because the
 * declared type is whatever the browser felt like sending and `image/jpeg` on a zip file
 * is a one-line lie. `sharp.metadata()` has to actually parse the bytes to answer, which
 * is the check.
 *
 * SVG is excluded deliberately and is the reason this list is a list. An SVG is a document:
 * it can carry script and external references, and it is served from our origin. Rasterising
 * one is not obviously safe either — librsvg has had its share — so it is simply refused.
 */
const ACCEPTED = new Set(['jpeg', 'jpg', 'png', 'webp', 'gif', 'avif', 'tiff', 'heif'])

export async function optimiseAndStore(
  container: MedusaContainer,
  input: Buffer
): Promise<StoredAsset> {
  if (!input?.length) throw new Error('Empty file.')
  if (input.length > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File is ${(input.length / 1048576).toFixed(1)} MB, over the ` +
      `${(MAX_UPLOAD_BYTES / 1048576).toFixed(0)} MB limit.`
    )
  }

  let probe: sharp.Metadata
  try {
    probe = await sharp(input).metadata()
  } catch {
    throw new Error('That file is not an image sharp can read.')
  }
  if (!probe.format || !ACCEPTED.has(probe.format)) {
    throw new Error(
      `Unsupported image format${probe.format ? ` (${probe.format})` : ''}. ` +
      `Accepted: JPEG, PNG, WebP, GIF, AVIF, TIFF, HEIF.`
    )
  }

  const data = await sharp(input)
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer()

  const meta = await sharp(data).metadata()
  const sha256 = createHash('sha256').update(data).digest('hex')

  // `create table if not exists`, so this is cheap and makes the endpoint work on a
  // database that has never run an ingest script.
  await ensureTable(container)

  const existing = await getAsset(container, sha256)
  if (!existing) {
    await putAsset(container, {
      id: sha256,
      sha256,
      mime: 'image/webp',
      width: meta.width ?? null,
      height: meta.height ?? null,
      bytes: data.length,
      data,
    })
  }

  return {
    sha256,
    url: assetUrl(sha256),
    width: meta.width ?? null,
    height: meta.height ?? null,
    bytes: existing?.bytes ?? data.length,
    deduped: !!existing,
  }
}
