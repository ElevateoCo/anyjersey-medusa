import { Modules } from '@medusajs/framework/utils'
import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'

/**
 * Read-through caching for the aggregate endpoints, on Medusa's cache module.
 *
 * Four endpoints — facets, sitemap, store reviews and curated collections — each kept their
 * own `let cache: { at, body }` in module scope. That is correct on one instance and wrong
 * on two: each process answers from its own copy, so two shoppers can see different facet
 * counts, and an import stays invisible on some instances until an unrelated TTL expires.
 *
 * Going through `Modules.CACHE` fixes both without changing what any endpoint computes. The
 * default registration is in-memory, so a single instance behaves exactly as it did; with
 * `REDIS_URL` set, medusa-config.ts registers `cache-redis` and the same four endpoints
 * become consistent across instances and survive a restart. There is one cache to reason
 * about instead of five, and `invalidate()` below is what an importer can call to make an
 * import visible immediately rather than at the end of a window.
 *
 * **A cache failure must not become a page failure.** Every call here is wrapped: if Redis
 * is unreachable, `get` and `set` are skipped and the endpoint computes its answer the slow
 * way. The alternative — a 500 on the homepage because a cache is down — is strictly worse
 * than being slow.
 */
type CacheService = {
  get<T>(key: string): Promise<T | null>
  set(key: string, data: unknown, ttl?: number): Promise<void>
  invalidate(key: string): Promise<void>
}

/** Namespaced so a key can never collide with Medusa's own cached queries. */
const NS = 'faj'
export const cacheKey = (scope: string, suffix = '') =>
  `${NS}:${scope}${suffix ? `:${suffix}` : ''}`

const service = (container: { resolve: (k: string) => unknown }): CacheService | null => {
  try {
    return container.resolve(Modules.CACHE) as CacheService
  } catch {
    return null
  }
}

/**
 * Serve `key` from cache, or compute it and store it for `ttlSeconds`.
 *
 * Returns the value and whether it was a hit, because every one of these endpoints already
 * advertised its cache state in a response header and losing that would make the change
 * unobservable from outside.
 */
export async function cached<T>(
  container: { resolve: (k: string) => unknown },
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>
): Promise<{ value: T; hit: boolean }> {
  const cache = service(container)

  if (cache) {
    try {
      const hit = await cache.get<T>(key)
      // `null` is indistinguishable from a miss in ICacheService, which is why nothing here
      // caches a nullable body. All four callers cache an object.
      if (hit != null) return { value: hit, hit: true }
    } catch {
      /* fall through to compute */
    }
  }

  const value = await compute()

  if (cache) {
    try {
      await cache.set(key, value, ttlSeconds)
    } catch {
      /* a value that could not be stored is still a value that can be served */
    }
  }

  return { value, hit: false }
}

/** Drop a cached entry — for an importer that wants its work visible now, not in 10 minutes. */
export async function invalidate(
  container: { resolve: (k: string) => unknown },
  key: string
): Promise<void> {
  try {
    await service(container)?.invalidate(key)
  } catch {
    /* best effort */
  }
}

/**
 * The whole pattern for a cached GET, since all four call sites are identical apart from
 * the key, the TTL, the header name and the body they compute.
 */
export async function serveCached<T>(
  req: MedusaRequest,
  res: MedusaResponse,
  opts: { key: string; ttlSeconds: number; header: string },
  compute: () => Promise<T>
) {
  const { value, hit } = await cached(req.scope as never, opts.key, opts.ttlSeconds, compute)
  res.setHeader(opts.header, hit ? 'hit' : 'miss')
  return res.json(value)
}
