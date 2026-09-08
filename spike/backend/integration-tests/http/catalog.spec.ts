import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { seedWorld, storeHeaders, type World } from './fixtures'

jest.setTimeout(120 * 1000)

/**
 * The catalog endpoints, against a real database.
 *
 * The invariant that matters most here is **count integrity**: a listing that reports a
 * count it cannot deliver is the bug that shipped twice in this project — first from
 * filtering in memory, then from joining on a slug. Both times the count was right and the
 * grid was short, so nothing errored and nobody noticed.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let w: World

    beforeAll(async () => { w = await seedWorld(getContainer()) })

    describe('GET /store/jerseys', () => {
      it('returns as many products as it claims', async () => {
        const res = await api.get(
          `/store/jerseys?region_id=${w.regionId}&limit=24`, storeHeaders(w)
        )
        expect(res.status).toBe(200)
        expect(res.data.products.length).toBe(Math.min(res.data.limit, res.data.count))
      })

      it('filters by team through the link, not by handle', async () => {
        const hit = await api.get(
          `/store/jerseys?team=${encodeURIComponent('Buffalo Bills')}&region_id=${w.regionId}`,
          storeHeaders(w)
        )
        expect(hit.data.count).toBe(1)
        expect(hit.data.products[0].detail.team).toBe('Buffalo Bills')

        const miss = await api.get(
          `/store/jerseys?team=${encodeURIComponent('Nonexistent Team')}&region_id=${w.regionId}`,
          storeHeaders(w)
        )
        expect(miss.data.count).toBe(0)
        expect(miss.data.products).toHaveLength(0)
      })

      it('combines facets', async () => {
        const both = await api.get(
          `/store/jerseys?league=NFL&colourway=grey&region_id=${w.regionId}`, storeHeaders(w)
        )
        expect(both.data.count).toBe(1)
        const contradiction = await api.get(
          `/store/jerseys?league=NFL&colourway=purple&region_id=${w.regionId}`, storeHeaders(w)
        )
        expect(contradiction.data.count).toBe(0)
      })

      it('prices variants for the region', async () => {
        const res = await api.get(
          `/store/jerseys?region_id=${w.regionId}`, storeHeaders(w)
        )
        expect(res.data.products[0].price).toBe(64.99)
      })

      it('matches free text without the accent', async () => {
        const res = await api.get(
          `/store/jerseys?q=allen&region_id=${w.regionId}`, storeHeaders(w)
        )
        expect(res.data.count).toBe(1)
      })

      it('falls back to a safe sort on an unknown value', async () => {
        const res = await api.get(
          `/store/jerseys?sort=nonsense&region_id=${w.regionId}`, storeHeaders(w)
        )
        expect(res.status).toBe(200)
        expect(res.data.sort).toBe('relevance')
      })

      it('caps the page size', async () => {
        const res = await api.get(
          `/store/jerseys?limit=99999&region_id=${w.regionId}`, storeHeaders(w)
        )
        expect(res.data.limit).toBeLessThanOrEqual(100)
      })

      it('does not fall over past the end', async () => {
        const res = await api.get(
          `/store/jerseys?offset=100000&region_id=${w.regionId}`, storeHeaders(w)
        )
        expect(res.status).toBe(200)
        expect(res.data.products).toHaveLength(0)
        expect(res.data.count).toBeGreaterThan(0)
      })
    })

    describe('GET /store/facets', () => {
      it('counts what exists', async () => {
        const res = await api.get('/store/facets', storeHeaders(w))
        expect(res.data.total).toBe(1)
        expect(res.data.leagues).toEqual([{ value: 'NFL', count: 1 }])
        expect(res.data.teams).toEqual([{ value: 'Buffalo Bills', count: 1 }])
      })
    })

    describe('GET /store/suggest', () => {
      it('suggests entities, not only products', async () => {
        const res = await api.get('/store/suggest?q=buffalo', storeHeaders(w))
        expect(res.data.teams.map((t: any) => t.value)).toContain('Buffalo Bills')
        expect(res.data.products.length).toBeGreaterThan(0)
      })

      it('suggests players', async () => {
        const res = await api.get('/store/suggest?q=allen', storeHeaders(w))
        expect(res.data.players.map((p: any) => p.value)).toContain('Josh Allen')
      })

      it('stays quiet below two characters', async () => {
        const res = await api.get('/store/suggest?q=b', storeHeaders(w))
        expect(res.data.teams).toHaveLength(0)
        expect(res.data.products).toHaveLength(0)
      })

      it('returns nothing rather than everything for no match', async () => {
        const res = await api.get('/store/suggest?q=zzzzzz', storeHeaders(w))
        expect(res.data.total).toBe(0)
      })
    })

    describe('GET /store/shipping-zones', () => {
      it('lists the zone rate card', async () => {
        const res = await api.get('/store/shipping-zones', storeHeaders(w))
        expect(res.data.zones.length).toBeGreaterThanOrEqual(5)
        const us = res.data.zones.find((z: any) => z.name === 'United States')
        expect(us.rate).toBe(4.99)
        expect(us.freeOver).toBe(75)
      })

      it('resolves the zone for a region', async () => {
        const res = await api.get(
          `/store/shipping-zones?region_id=${w.regionId}`, storeHeaders(w)
        )
        expect(res.data.zone.name).toBe('United States')
      })
    })
  },
})
