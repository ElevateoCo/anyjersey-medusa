import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../modules/catalog'
import { invalidate, cacheKey } from '../../../cache'
import { slugify } from '../../../jerseys'

/**
 * The eleven collections in the storefront navigation, editable.
 *
 * `curated_collection` and `collection_membership` had no HTTP surface at all — the only
 * writer in the repository was `scripts/import-collections.ts`. Adding one product to Best
 * Sellers meant editing a JSON file and running a script against production.
 *
 * **Not at `/admin/collections`.** Medusa owns that path for its own product collections, and
 * a file route there inherits its validators rather than replacing it. These are a different
 * thing: Medusa's collections put a product in at most one, which is why this table exists —
 * importing the live store's 1,564 memberships into Medusa's resolved to first-wins and
 * silently dropped 80 products out of Football 2026.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)

  const collections = await catalog.listCuratedCollections(
    {}, { order: { position: 'ASC' }, take: 500 }
  )
  const memberships = await catalog.listCollectionMemberships(
    {}, { select: ['collection_handle'], take: 100000 }
  )
  const counts = new Map<string, number>()
  for (const m of memberships as any[]) {
    counts.set(m.collection_handle, (counts.get(m.collection_handle) ?? 0) + 1)
  }

  res.json({
    // Inactive and empty ones are included here and hidden on the storefront: this is the
    // screen where you fix an empty collection, so it is the one place it must be visible.
    collections: (collections as any[]).map((c) => ({
      ...c,
      count: counts.get(c.handle) ?? 0,
      live: c.active && (counts.get(c.handle) ?? 0) > 0,
    })),
  })
}

/** POST /admin/curated-collections — create one. */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>

  const title = String(body.title ?? '').trim()
  if (!title) throw new MedusaError(MedusaError.Types.INVALID_DATA, 'A title is required.')

  const handle = String(body.handle ?? '').trim() || slugify(title)
  if (!handle || !/^[a-z0-9][a-z0-9-]*$/.test(handle)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      'A handle may contain only lowercase letters, numbers and hyphens.')
  }

  const [clash] = await catalog.listCuratedCollections({ handle }, { take: 1 })
  if (clash) {
    throw new MedusaError(MedusaError.Types.DUPLICATE_ERROR,
      `The handle "${handle}" is already in use.`)
  }

  const [created] = await catalog.createCuratedCollections([{
    handle,
    title,
    description: String(body.description ?? '').trim() || null,
    position: Number.isFinite(Number(body.position)) ? Number(body.position) : 0,
    active: body.active === undefined ? true : body.active === true || body.active === 'true',
    source: 'admin',
  }])

  await invalidate(req.scope as never, cacheKey('curated-collections'))
  res.status(201).json({ collection: { ...created, count: 0, live: false } })
}
