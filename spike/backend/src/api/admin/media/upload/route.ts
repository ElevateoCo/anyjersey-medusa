import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { MAX_UPLOAD_BYTES, optimiseAndStore } from '../../../../media-ingest'

/**
 * POST /admin/media/upload — multipart, field name `files`.
 *
 * This exists because there is no other way to get an image into this store from a browser.
 * Medusa's own `/admin/uploads` hands the bytes to the **File module**, and this project
 * registers no file module at all — it has no default, so the stock admin's "add image"
 * control has nothing behind it. The images that are in the catalogue got there through
 * `scripts/ingest-media.ts`, from a folder on a laptop.
 *
 * So the pipeline is the script's, called from HTTP: WebP q78 capped at 1400px, hashed,
 * stored once per distinct result. What that buys over registering `file-local` is the part
 * worth keeping — every image the admin adds is optimised, content-addressed, immutable,
 * served with `?w=` derivatives, and lands in `media_asset` alongside the other 4,300
 * rather than in a directory that a container restart forgets.
 *
 * Several files at once, because the UI is a drop zone and dropping four photos on it is
 * one gesture. Each is reported separately: a bad file in a batch of good ones fails on its
 * own line rather than taking the batch with it, since the alternative is a person
 * re-dragging three files that were fine.
 */
type UploadedFile = { originalname?: string; buffer?: Buffer; size?: number }

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const files = ((req as unknown as { files?: UploadedFile[] }).files ?? [])

  if (!files.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'No files received. Send multipart/form-data with one or more `files` fields.'
    )
  }

  const results = await Promise.all(files.map(async (f) => {
    const name = f.originalname ?? 'image'
    try {
      const stored = await optimiseAndStore(req.scope as never, f.buffer as Buffer)
      return { filename: name, ok: true as const, ...stored }
    } catch (e) {
      return { filename: name, ok: false as const, error: (e as Error).message }
    }
  }))

  const stored = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)

  // 207 when the batch is mixed. A 200 would let a UI that only checks the status code
  // report four successes when one file was rejected.
  res.status(failed.length && stored.length ? 207 : failed.length ? 400 : 200).json({
    uploaded: stored,
    failed,
    limits: { max_bytes: MAX_UPLOAD_BYTES },
  })
}
