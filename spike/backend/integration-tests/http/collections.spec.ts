import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { seedWorld, storeHeaders, type World } from './fixtures'
import { CATALOG_MODULE } from '../../src/modules/catalog'
import { __resetCache } from '../../src/api/store/curated-collections/route'

jest.setTimeout(180 * 1000)

/**
 * Curated collections.
 *
 * These exist because facet navigation cannot answer "what is selling" or "the World Cup
 * range" — no property of a product implies membership, so a human decides it.
 *
 * The property worth testing hardest is **overlap**. Medusa's own `product_collection` puts
 * a product in at most one collection, and importing the live store's 1,564 memberships
 * into it resolved to first-wins: 80 products vanished from Football 2026 and 22 of the 49
 * in Rookie Draft Class, silently, because Best Sellers had claimed them. That is why this
 * is a separate table, and it is what these tests protect.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let w: World

    beforeAll(async () => {
      w = await seedWorld(getContainer())
    })

    beforeEach(() => __resetCache(getContainer()))

    const seed = async (
      handle: string, title: string, ids: string[], over: Record<string, unknown> = {}
    ) => {
      const catalog: any = getContainer().resolve(CATALOG_MODULE)
      await catalog.createCuratedCollections([{
        handle, title, description: `${title} description`, position: 0, active: true, ...over,
      }])
      if (ids.length) {
        await catalog.createCollectionMemberships(
          ids.map((product_id, i) => ({ collection_handle: handle, product_id, position: i }))
        )
      }
    }

    describe('GET /store/curated-collections', () => {
      it('lists collections with a count from the membership table', async () => {
        await seed('best-sellers', 'Best Sellers', [w.productId])
        const res = await api.get('/store/curated-collections', storeHeaders(w))
        const c = res.data.collections.find((x: any) => x.handle === 'best-sellers')
        expect(c.title).toBe('Best Sellers')
        // Counted, not stored: a collection cannot advertise 417 and then show 415.
        expect(c.count).toBe(1)
      })

      it('hides an empty collection rather than listing a dead link', async () => {
        await seed('empty-one', 'Empty One', [])
        const res = await api.get('/store/curated-collections', storeHeaders(w))
        expect(res.data.collections.find((x: any) => x.handle === 'empty-one')).toBeUndefined()
      })

      it('hides an inactive collection', async () => {
        await seed('retired', 'Retired', [w.productId], { active: false })
        const res = await api.get('/store/curated-collections', storeHeaders(w))
        expect(res.data.collections.find((x: any) => x.handle === 'retired')).toBeUndefined()
      })

      it('orders by position, not by name', async () => {
        await seed('zeta', 'Zeta', [w.productId], { position: 0 })
        await seed('alpha', 'Alpha', [w.productId], { position: 1 })
        const res = await api.get('/store/curated-collections', storeHeaders(w))
        const handles = res.data.collections.map((c: any) => c.handle)
        expect(handles.indexOf('zeta')).toBeLessThan(handles.indexOf('alpha'))
      })
    })

    /**
     * The cache, which nothing asserted while it was a variable in the route file and
     * which nothing would assert now that it is a module either.
     *
     * That matters more than it looks. `src/cache.ts` swallows a cache failure on purpose —
     * a Redis outage must not 500 the homepage — so a wiring mistake degrades to "every
     * request is a miss" and every other test in this file still passes. Without these two
     * assertions the caching would be exactly as verifiable as `assertConfigured()` was,
     * which is to say documented and not in force.
     */
    describe('the cache is actually a cache', () => {
      it('misses once and then hits', async () => {
        await seed('cached-list', 'Cached List', [w.productId])

        const first = await api.get('/store/curated-collections', storeHeaders(w))
        expect(first.headers['x-collections-cache']).toBe('miss')

        const second = await api.get('/store/curated-collections', storeHeaders(w))
        expect(second.headers['x-collections-cache']).toBe('hit')
        expect(second.data).toEqual(first.data)
      })

      it('serves stale until invalidated, and fresh after', async () => {
        await seed('before', 'Before', [w.productId])
        await api.get('/store/curated-collections', storeHeaders(w))

        await seed('after', 'After', [w.productId])
        const stale = await api.get('/store/curated-collections', storeHeaders(w))
        // A ten-minute window is the deal. The new collection is invisible until the window
        // closes or somebody invalidates — which is what the import scripts now do.
        expect(stale.headers['x-collections-cache']).toBe('hit')
        expect(stale.data.collections.find((c: any) => c.handle === 'after')).toBeUndefined()

        await __resetCache(getContainer())
        const fresh = await api.get('/store/curated-collections', storeHeaders(w))
        expect(fresh.headers['x-collections-cache']).toBe('miss')
        expect(fresh.data.collections.find((c: any) => c.handle === 'after')).toBeDefined()
      })
    })

    describe('GET /store/curated-collections/:handle', () => {
      it('returns the collection and its products', async () => {
        await seed('world-cup-2026', 'World Cup 2026', [w.productId])
        const res = await api.get(
          `/store/curated-collections/world-cup-2026?region_id=${w.regionId}`, storeHeaders(w)
        )
        expect(res.data.collection.title).toBe('World Cup 2026')
        expect(res.data.count).toBe(1)
        expect(res.data.products[0].handle).toBeTruthy()
        expect(res.data.products[0].price).toBeGreaterThan(0)
      })

      it('404s an unknown handle', async () => {
        const res = await api.get('/store/curated-collections/nope', storeHeaders(w))
          .catch((e: any) => e.response)
        expect(res.status).toBe(404)
      })

      it('accepts limit and region_id, which the native /store/collections path rejects', async () => {
        // Named `curated-collections` on purpose: a file route at `/store/collections`
        // inherits Medusa's own validator, which 400s on "Unrecognized fields: limit,
        // region_id" and reads as a broken endpoint rather than a shadowed one.
        await seed('paged', 'Paged', [w.productId])
        const res = await api.get(
          `/store/curated-collections/paged?limit=1&offset=0&region_id=${w.regionId}`,
          storeHeaders(w)
        )
        expect(res.status).toBe(200)
      })

      it('paginates without changing the total', async () => {
        await seed('paged2', 'Paged Two', [w.productId])
        const res = await api.get(
          '/store/curated-collections/paged2?limit=1&offset=5', storeHeaders(w)
        )
        // The count is the collection's size, not the page's — a count that shrinks with
        // the offset is the same defect as a review count that shrinks with the page size.
        expect(res.data.count).toBe(1)
        expect(res.data.products).toHaveLength(0)
      })
    })

    describe('a product may belong to several collections', () => {
      it('appears in all of them, which a Medusa collection could not do', async () => {
        // The regression this exists for: first-wins assignment silently emptied
        // collections that overlapped with an earlier one.
        await seed('a-list', 'A List', [w.productId], { position: 0 })
        await seed('b-list', 'B List', [w.productId], { position: 1 })

        const a = await api.get('/store/curated-collections/a-list', storeHeaders(w))
        const b = await api.get('/store/curated-collections/b-list', storeHeaders(w))
        expect(a.data.count).toBe(1)
        expect(b.data.count).toBe(1)

        const list = await api.get('/store/curated-collections', storeHeaders(w))
        const counts = Object.fromEntries(
          list.data.collections.map((c: any) => [c.handle, c.count])
        )
        expect(counts['a-list']).toBe(1)
        expect(counts['b-list']).toBe(1)
      })
    })
  },
})
