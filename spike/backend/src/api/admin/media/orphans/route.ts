import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { deleteAssets, findOrphanAssets } from '../../../../media-store'

/**
 * The orphan sweep: `GET` to see what would go, `DELETE` to remove it.
 *
 * Images are content-addressed and therefore shared, so deleting a product deliberately
 * keeps its images — two products can carry identical bytes and blanking one because the
 * other left would be a bug. The consequence is that orphans accumulate, and nothing was
 * collecting them: `media_asset` had no delete path anywhere in the repository.
 *
 * **Two verbs rather than one, on purpose.** This deletes image bytes that exist nowhere
 * else — the originals were optimised on ingest and the source folder is a laptop. So the
 * destructive call is separate from the one that tells you what it would do, and `DELETE`
 * takes an explicit list of content addresses rather than "everything you found": between a
 * `GET` and a `DELETE` somebody may have attached one of them to a product, and a sweep that
 * re-derives its own target list would race with that.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 200) || 200, 1), 1000)
  const orphans = await findOrphanAssets(req.scope as never, limit)

  res.json({
    orphans: orphans.map((o) => ({
      sha256: o.sha256,
      url: `/media/${o.sha256}.webp`,
      kb: Math.round(o.bytes / 1024),
      created_at: o.created_at,
    })),
    count: orphans.length,
    reclaimable_kb: Math.round(orphans.reduce((n, o) => n + o.bytes, 0) / 1024),
    limit,
    note:
      'Referenced means: a product thumbnail, a row in Medusa’s image table, or a ' +
      'personalisation preview. Soft-deleted products still count as references, because ' +
      'restoring one whose images were swept is worse than paying for the bytes.',
  })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as { sha256?: unknown }
  const asked = Array.isArray(body.sha256) ? body.sha256.map(String) : []

  if (!asked.length) {
    return res.status(400).json({
      message: 'Send { "sha256": [...] } listing exactly which assets to remove. ' +
               'GET this endpoint first to see the candidates.',
    })
  }
  const invalid = asked.filter((s) => !/^[0-9a-f]{64}$/.test(s))
  if (invalid.length) {
    return res.status(400).json({ message: `Not content addresses: ${invalid.join(', ')}` })
  }

  // Re-checked at the moment of deletion rather than trusted from the caller's list. The
  // caller's list came from a GET that may be minutes old, and the cost of being wrong here
  // is a product page with a missing image.
  const stillOrphaned = new Set(
    (await findOrphanAssets(req.scope as never, 100000)).map((o) => o.sha256)
  )
  const removable = asked.filter((s) => stillOrphaned.has(s))
  const skipped = asked.filter((s) => !stillOrphaned.has(s))

  const deleted = await deleteAssets(req.scope as never, removable)

  res.json({
    deleted,
    skipped: skipped.length,
    // Named, not just counted: "3 skipped" leaves an operator wondering which, and the
    // answer is interesting — it means something referenced them since the GET.
    skipped_sha256: skipped,
  })
}
