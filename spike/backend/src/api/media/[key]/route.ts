import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import sharp from 'sharp'
import { getAsset } from '../../../media-store'

/**
 * GET /media/:sha256.webp?w=400
 *
 * A **root** route, not a /store one. That is not cosmetic: everything under /store is
 * gated on the `x-publishable-api-key` header, and a browser cannot put a header on an
 * `<img src>`. The first version of this lived at /store/media and returned
 * `{"type":"not_allowed"}` to every image request — the storefront would have launched
 * with 4,825 blank tiles and a green test suite, because the tests fetched through the
 * API client, which does send the key. Images are public assets; they belong outside the
 * authenticated store namespace.
 *
 * Serves image bytes out of Postgres. Because the URL is content-addressed, the bytes at a
 * given URL can never change — so the response is `immutable` with a one-year max-age and
 * an ETag. A warm browser or CDN never asks twice, which is what keeps image traffic off
 * the database.
 *
 * `?w=` renders a narrower version on the fly rather than storing one per breakpoint. That
 * keeps the table as small as it can be — the instruction was to store as little as
 * possible — at the cost of CPU on a cold miss. Derivatives are held in a bounded
 * in-process cache so a cold miss happens once per width per process.
 *
 * **The extension in the URL is honoured**, and that is a fix rather than a feature. The
 * route already accepted `.png` and `.jpg` in the path — it stripped them to get the content
 * address and then served WebP bytes under a WebP content type regardless, so a URL ending
 * `.png` returned something that was not a PNG. Nothing noticed while every consumer was a
 * browser, because browsers read the content type and all of them decode WebP.
 *
 * The consumer that did notice is the Open Graph image route: Satori, behind Next's
 * `ImageResponse`, cannot decode WebP at all. It fetched the shirt, silently got nothing it
 * could read, and rendered a share card with a blank panel where the jersey should be — no
 * error, in a route only crawlers request. Asking for `.png` now returns a PNG.
 */
const ALLOWED_WIDTHS = [200, 400, 800, 1400]
const MAX_CACHE_ENTRIES = 400

/** The formats the URL may ask for, and what to answer with. */
const FORMATS: Record<string, { mime: string; encode: (s: import('sharp').Sharp) => import('sharp').Sharp }> = {
  webp: { mime: 'image/webp', encode: (s) => s.webp({ quality: 76 }) },
  png: { mime: 'image/png', encode: (s) => s.png({ compressionLevel: 9 }) },
  jpg: { mime: 'image/jpeg', encode: (s) => s.jpeg({ quality: 82 }) },
  jpeg: { mime: 'image/jpeg', encode: (s) => s.jpeg({ quality: 82 }) },
}

/** Tiny LRU. Bounded on purpose: an unbounded image cache is a memory leak with a plan. */
const cache = new Map<string, { buf: Buffer; mime: string }>()
const remember = (key: string, value: { buf: Buffer; mime: string }) => {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, value)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const raw = String(req.params.key ?? '')
  const extMatch = raw.match(/\.(webp|jpe?g|png|avif)$/i)
  const sha = raw.replace(/\.(webp|jpe?g|png|avif)$/i, '')
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    return res.status(400).json({ message: 'Not a content address.' })
  }

  const requested = Number(req.query.w)
  const width = ALLOWED_WIDTHS.includes(requested) ? requested : null

  // avif is deliberately absent from FORMATS — measured at ~6x the encode time for two
  // points of size (Step 20) — so an .avif URL falls back to the stored format rather than
  // paying that on a cold request.
  const ext = (extMatch?.[1] ?? '').toLowerCase()
  const format = FORMATS[ext] ?? null

  /**
   * The ETag varies by format only when the format changes the bytes.
   *
   * Every stored asset is WebP — ingest converts them all — so `.webp` and a bare address
   * return byte-identical responses and must therefore share an ETag. The first version of
   * this appended the mime unconditionally, which changed the ETag of every existing
   * `.webp` URL: caught by the test asserting the plain ETag, and worth more than the test
   * says, because a changed ETag invalidates every cached image in every browser and CDN
   * for a request whose bytes did not move.
   *
   * Keyed off the extension rather than the stored mime on purpose, so the 304 below can be
   * answered without reading the asset out of the database first.
   */
  const transcoding = !!format && ext !== 'webp'
  const etag = `"${sha}${width ? `-w${width}` : ''}${transcoding ? `-${ext}` : ''}"`
  if (req.headers['if-none-match'] === etag) {
    res.setHeader('ETag', etag)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    return res.status(304).end()
  }

  const cacheKey = `${sha}:${width ?? 'full'}:${transcoding ? ext : 'native'}`
  const hit = cache.get(cacheKey)
  if (hit) {
    cache.delete(cacheKey)
    cache.set(cacheKey, hit) // move to most-recently-used
    return send(res, hit.buf, hit.mime, etag, 'hit')
  }

  const asset = await getAsset(req.scope as never, sha)
  if (!asset?.data) {
    return res.status(404).json({ message: 'No such image.' })
  }

  let buf = asset.data as Buffer
  let mime = asset.mime
  const needsResize = !!width && (asset.width ?? 0) > width
  const needsTranscode = transcoding && format!.mime !== asset.mime

  if (needsResize || needsTranscode) {
    try {
      let pipeline = sharp(buf)
      if (needsResize) pipeline = pipeline.resize({ width: width!, withoutEnlargement: true })
      const target = format ?? FORMATS.webp
      buf = await target.encode(pipeline).toBuffer()
      mime = target.mime
    } catch {
      // Fall back to the canonical asset rather than failing the request — but report the
      // format we are actually sending, never the one that was asked for.
      buf = asset.data as Buffer
      mime = asset.mime
    }
  }

  remember(cacheKey, { buf, mime })
  return send(res, buf, mime, etag, 'miss')
}

function send(res: MedusaResponse, buf: Buffer, mime: string, etag: string, cacheState: string) {
  res.setHeader('Content-Type', mime)
  res.setHeader('Content-Length', String(buf.length))
  res.setHeader('ETag', etag)
  // Content-addressed: safe to cache for a year, and safe to keep serving while stale.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.setHeader('X-Media-Cache', cacheState)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  return res.status(200).send(buf)
}
