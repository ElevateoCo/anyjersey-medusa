import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { CATALOG_MODULE } from '../../../modules/catalog'
import { cacheKey, invalidate, serveCached } from '../../../cache'

/**
 * GET /store/curated-collections
 *
 * The editorial groupings, with their sizes.
 *
 * Deliberately **not** at `/store/collections`: Medusa ships its own store endpoint on that
 * path, and a file route there does not replace it — it inherits its query validator, which
 * rejected `limit` and `region_id` with "Unrecognized fields" and made the endpoint look
 * broken rather than shadowed. Facet navigation answers "Chicago Bears
 * shirts"; this answers "what is selling" and "the World Cup range", which no property of a
 * product implies.
 *
 * Counts come from the membership table rather than being stored on the collection, so a
 * collection cannot advertise 417 products and then show 415 — the §12.7 mismatch, one
 * layer down.
 */
/** Shared across instances once REDIS_URL is set — see src/cache.ts. */
const TTL_SECONDS = 10 * 60
const KEY = cacheKey('curated-collections')

/**
 * Drop the cached body.
 *
 * Takes a container now that the cache is a module rather than a variable in this file.
 * That is the point of the change — a reset that only cleared one process's copy was never
 * going to work on two instances — but it does mean every caller has to hand over the
 * container it already has.
 */
export const __resetCache = (container: { resolve: (k: string) => unknown }) =>
  invalidate(container, KEY)

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return serveCached(
    req,
    res,
    { key: KEY, ttlSeconds: TTL_SECONDS, header: 'x-collections-cache' },
    () => build(req)
  )
}

async function build(req: MedusaRequest) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const collections = await catalog.listCuratedCollections(
    { active: true }, { order: { position: 'ASC' }, take: 200 }
  )

  const memberships = await catalog.listCollectionMemberships(
    {}, { select: ['collection_handle'], take: 100000 }
  )
  const counts = new Map<string, number>()
  for (const m of memberships as any[]) {
    counts.set(m.collection_handle, (counts.get(m.collection_handle) ?? 0) + 1)
  }

  const body = {
    collections: (collections as any[])
      .map((c) => ({
        handle: c.handle,
        title: c.title,
        description: c.description,
        count: counts.get(c.handle) ?? 0,
      }))
      // An empty collection is a dead link in the navigation. Hidden rather than deleted,
      // because a seasonal one refills.
      .filter((c) => c.count > 0),
  }

  return body
}
