import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { seedWorld, storeHeaders, type World } from './fixtures'
import { CATALOG_MODULE } from '../../src/modules/catalog'
import { __resetCache as resetStoreReviewCache } from '../../src/api/store/store-reviews/route'

jest.setTimeout(180 * 1000)

/**
 * The marketplace reviews, and the one rule that matters about them.
 *
 * 84 reviews came across from Judge.me: eBay, Depop and Facebook Marketplace purchases made
 * before this store existed. 17 of them match a product in the catalog by exact title; the
 * rest name nothing we stock, or name no product at all.
 *
 * The failure this suite exists to prevent is the §12.7 one — the reference storefront shows
 * **137,135 reviews on its homepage and 8,342 on a product page**. So:
 *
 *   - `/store/store-reviews` answers for the *store* and counts everything
 *   - `/store/reviews?product_id=` answers for a *product* and counts only that product's
 *   - neither number may leak into the other's scope
 *
 * And the labelling rule: an imported review can never be marked `verified_purchase`,
 * because that flag is derived from this store's order history and an eBay order cannot be
 * checked against it. Claiming otherwise is the FTC violation, not a display detail.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let w: World

    beforeAll(async () => {
      w = await seedWorld(getContainer())
    })

    /**
     * The store aggregate is cached for ten minutes. Without clearing it, every
     * test after the first reads the first one's body and the endpoint looks broken while
     * being correct — which is exactly what happened writing this file.
     */
    beforeEach(() => resetStoreReviewCache(getContainer()))

    const seedImported = async (rows: Record<string, unknown>[]) => {
      const catalog: any = getContainer().resolve(CATALOG_MODULE)
      return catalog.createStoreReviews(rows)
    }

    const imported = (over: Record<string, unknown> = {}) => ({
      product_id: null,
      source_item: null,
      rating: 5,
      title: 'Fast shipping',
      body: 'Arrived quickly and exactly as pictured.',
      author_name: 'eBay Buyer _***0',
      source: 'eBay',
      reviewed_at: new Date('2026-05-01T12:00:00Z'),
      match_method: 'unmatched',
      fingerprint: `fp-${Math.random().toString(36).slice(2)}`,
      ...over,
    })

    describe('the store-wide aggregate', () => {
      it('counts every imported review and averages them', async () => {
        await seedImported([
          imported({ rating: 5 }), imported({ rating: 5 }), imported({ rating: 4 }),
        ])
        const res = await api.get('/store/store-reviews', storeHeaders(w))
        expect(res.data.count).toBe(3)
        expect(res.data.average).toBeCloseTo(4.67, 1)
      })

      it('trims the sample without trimming the count', async () => {
        // A count that changed with the page size would be a different number for the same
        // scope on every surface that asked differently — the drift this all guards against.
        await seedImported(Array.from({ length: 8 }, () => imported()))
        const res = await api.get('/store/store-reviews?limit=3', storeHeaders(w))
        expect(res.data.reviews.length).toBe(3)
        expect(res.data.count).toBe(8)
      })

      it('breaks the total down by marketplace', async () => {
        await seedImported([
          imported({ source: 'eBay' }), imported({ source: 'eBay' }),
          imported({ source: 'Depop' }),
        ])
        const res = await api.get('/store/store-reviews', storeHeaders(w))
        const byName = Object.fromEntries(
          res.data.sources.map((s: any) => [s.source, s.count])
        )
        expect(byName).toEqual({ eBay: 2, Depop: 1 })
      })

      it('carries the origin disclosure in the payload, not just the theme', async () => {
        await seedImported([imported()])
        const res = await api.get('/store/store-reviews', storeHeaders(w))
        // §7.10: any surface that renders these has to be able to disclose where they came
        // from, so the disclosure travels with the data.
        expect(res.data.disclosure).toMatch(/eBay/i)
        expect(res.data.disclosure).toMatch(/not verified|cannot be verified|unfiltered/i)
      })

      it('reports zero honestly rather than inventing an average', async () => {
        const res = await api.get('/store/store-reviews', storeHeaders(w))
        expect(res.data.count).toBe(0)
        // null, not 0 — "no reviews" and "rated zero" are different statements.
        expect(res.data.average).toBeNull()
      })
    })

    describe('the product aggregate', () => {
      it('counts only the reviews attached to that product', async () => {
        await seedImported([
          imported({ product_id: w.productId, match_method: 'exact_title', rating: 5 }),
          imported({ product_id: w.productId, match_method: 'exact_title', rating: 4 }),
          // Attached to nothing: must not reach the product page.
          imported({ rating: 1 }),
        ])
        const res = await api.get(
          `/store/reviews?product_id=${w.productId}`, storeHeaders(w)
        )
        expect(res.data.count).toBe(2)
        expect(res.data.average).toBeCloseTo(4.5, 1)
      })

      it('never lets the store aggregate stand in for a product rating', async () => {
        // The §12.7 defect, asserted directly.
        await seedImported(Array.from({ length: 20 }, () => imported({ rating: 5 })))
        const store = await api.get('/store/store-reviews', storeHeaders(w))
        const product = await api.get(
          `/store/reviews?product_id=${w.productId}`, storeHeaders(w)
        )
        expect(store.data.count).toBe(20)
        expect(product.data.count).toBe(0)
        expect(product.data.average).toBeNull()
      })

      it('marks an imported review as not first-party and names its source', async () => {
        await seedImported([
          imported({ product_id: w.productId, match_method: 'exact_title', source: 'Depop' }),
        ])
        const res = await api.get(
          `/store/reviews?product_id=${w.productId}`, storeHeaders(w)
        )
        const row = res.data.reviews[0]
        expect(row.first_party).toBe(false)
        expect(row.source).toBe('Depop')
      })

      it('never marks an imported review as a verified purchase', async () => {
        // The flag is derived from this store's order history. An eBay order cannot be
        // checked against it, so claiming it would be the FTC violation outright.
        await seedImported([
          imported({ product_id: w.productId, match_method: 'exact_title' }),
        ])
        const res = await api.get(
          `/store/reviews?product_id=${w.productId}`, storeHeaders(w)
        )
        expect(res.data.reviews.every((r: any) => r.verified_purchase === false)).toBe(true)
        expect(res.data.verified_count).toBe(0)
        expect(res.data.imported_count).toBe(1)
      })

      it('discloses that marketplace reviews cannot be verified here', async () => {
        await seedImported([
          imported({ product_id: w.productId, match_method: 'exact_title' }),
        ])
        const res = await api.get(
          `/store/reviews?product_id=${w.productId}`, storeHeaders(w)
        )
        expect(res.data.verification_note).toMatch(/marketplace/i)
      })

      it('keeps the aggregate equal to the reviews it lists', async () => {
        await seedImported([
          imported({ product_id: w.productId, match_method: 'exact_title', rating: 5 }),
          imported({ product_id: w.productId, match_method: 'exact_title', rating: 3 }),
        ])
        const res = await api.get(
          `/store/reviews?product_id=${w.productId}`, storeHeaders(w)
        )
        const listed = res.data.reviews
        const recomputed =
          listed.reduce((n: number, r: any) => n + r.rating, 0) / listed.length
        expect(res.data.count).toBe(listed.length)
        expect(res.data.average).toBeCloseTo(recomputed, 1)
      })
    })

    describe('/store/sitemap', () => {
      it('returns handles and real last-modified dates', async () => {
        const res = await api.get('/store/sitemap', storeHeaders(w))
        expect(res.data.products.length).toBeGreaterThan(0)
        const row = res.data.products[0]
        expect(typeof row.handle).toBe('string')
        // A real date, not the build time — a sitemap that claims everything changed at
        // deploy throws away the one signal the file carries well.
        expect(Number.isNaN(Date.parse(row.updated_at))).toBe(false)
      })

      it('lists the facet values that have a live product behind them', async () => {
        const res = await api.get('/store/sitemap', storeHeaders(w))
        expect(Array.isArray(res.data.leagues)).toBe(true)
        expect(Array.isArray(res.data.teams)).toBe(true)
      })
    })
  },
})
