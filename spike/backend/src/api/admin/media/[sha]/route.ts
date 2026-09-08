import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { deleteAssets, findOrphanAssets, getAsset } from '../../../../media-store'

/**
 * GET / DELETE one asset by content address.
 *
 * The single-asset counterpart to the sweep. `DELETE` refuses an asset something still
 * references unless `?force=true` is passed — because the common reason to delete one image
 * by hand is that it is wrong or should never have been uploaded, and that is exactly the
 * case where it *is* still attached to a product.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sha = String(req.params.sha ?? '')
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    return res.status(400).json({ message: 'Not a content address.' })
  }
  const asset = await getAsset(req.scope as never, sha)
  if (!asset) return res.status(404).json({ message: 'No such asset.' })

  res.json({
    sha256: asset.sha256,
    url: `/media/${asset.sha256}.webp`,
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    bytes: asset.bytes,
    // Both, because a thumbnail rounds to 0 KB and an operator scanning a list wants the
    // round number while anything doing arithmetic wants the exact one.
    kb: Math.round(asset.bytes / 1024),
    // Whether the bytes are in this row or in the bucket, without shipping the bytes.
    stored_inline: !!asset.data,
  })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const sha = String(req.params.sha ?? '')
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    return res.status(400).json({ message: 'Not a content address.' })
  }

  const force = String(req.query.force ?? '') === 'true'
  if (!force) {
    const orphaned = (await findOrphanAssets(req.scope as never, 100000))
      .some((o) => o.sha256 === sha)
    if (!orphaned) {
      return res.status(409).json({
        message:
          'That image is still attached to a product or a personalisation. Detach it first, ' +
          'or pass ?force=true if it must go regardless.',
      })
    }
  }

  const deleted = await deleteAssets(req.scope as never, [sha])
  if (!deleted) return res.status(404).json({ message: 'No such asset.' })

  res.json({ sha256: sha, deleted: true, forced: force })
}
