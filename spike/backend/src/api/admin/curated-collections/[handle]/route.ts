import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../../modules/catalog'
import { invalidate, cacheKey } from '../../../../cache'

const drop = (req: MedusaRequest) =>
  invalidate(req.scope as never, cacheKey('curated-collections'))

async function load(req: MedusaRequest) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const [collection] = await catalog.listCuratedCollections(
    { handle: req.params.handle }, { take: 1 }
  )
  if (!collection) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'No such collection.')
  return { catalog, collection }
}

/** GET one collection with its products, in position order. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { catalog, collection } = await load(req)
  const members = await catalog.listCollectionMemberships(
    { collection_handle: collection.handle },
    { order: { position: 'ASC' }, take: 10000 }
  )
  res.json({ collection, products: members, count: members.length })
}

/**
 * POST /admin/curated-collections/:handle — edit the collection itself.
 *
 * The handle is not editable here. It is the storefront URL and the foreign key every
 * membership row carries, so renaming it means rewriting the membership table and breaking
 * every existing link — a migration, not a form field. Delete and recreate if it has to
 * change.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { catalog, collection } = await load(req)
  const body = (req.body ?? {}) as Record<string, unknown>

  const update: Record<string, unknown> = { id: collection.id }
  if (body.title !== undefined) {
    const title = String(body.title).trim()
    if (!title) throw new MedusaError(MedusaError.Types.INVALID_DATA, 'A title is required.')
    update.title = title
  }
  if (body.description !== undefined) {
    update.description = String(body.description).trim() || null
  }
  if (body.position !== undefined && Number.isFinite(Number(body.position))) {
    update.position = Number(body.position)
  }
  if (body.active !== undefined) {
    update.active = body.active === true || body.active === 'true'
  }
  if (Object.keys(update).length === 1) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'Nothing to update.')
  }

  const [updated] = await catalog.updateCuratedCollections([update])
  await drop(req)
  res.json({ collection: updated })
}

/**
 * DELETE /admin/curated-collections/:handle
 *
 * The memberships go with it. They are keyed by handle rather than by a foreign key the
 * database enforces, so nothing else would ever remove them — and a later collection reusing
 * the handle would silently inherit the old one's products.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { catalog, collection } = await load(req)

  const members = await catalog.listCollectionMemberships(
    { collection_handle: collection.handle }, { select: ['id'], take: 100000 }
  )
  if (members.length) {
    await catalog.deleteCollectionMemberships(members.map((m: any) => m.id))
  }
  await catalog.deleteCuratedCollections([collection.id])

  await drop(req)
  res.json({ handle: collection.handle, deleted: true, memberships_removed: members.length })
}
