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

    describe('GET /store/jerseys?handle=', () => {
      /**
       * The recently-viewed rail holds handles in the visitor's own browser and turns them
       * into cards here. Looking them up rather than caching the cards is what keeps a
       * stale price off the one rail whose job is to take somebody back to a shirt they
       * are still deciding on.
       */
      it('returns the named products, priced', async () => {
        const all = await api.get(
          `/store/jerseys?region_id=${w.regionId}&limit=100`, storeHeaders(w))
        const handles = all.data.products.slice(0, 2).map((p: any) => p.handle)
        expect(handles.length).toBeGreaterThan(0)

        const qs = handles.map((h: string) => `handle=${encodeURIComponent(h)}`).join('&')
        const res = await api.get(
          `/store/jerseys?${qs}&region_id=${w.regionId}`, storeHeaders(w))
        expect(res.status).toBe(200)
        expect(res.data.products.map((p: any) => p.handle).sort()).toEqual([...handles].sort())
        expect(res.data.products[0].price).not.toBeNull()
      })

      /**
       * `handle` is a product column and the facet filters are `jersey_detail` ones, so
       * they are assembled separately. They still have to compose — this is the assertion
       * that would fail if one of them ever replaced the other.
       */
      it('composes with a facet filter rather than replacing it', async () => {
        const all = await api.get(
          `/store/jerseys?region_id=${w.regionId}&limit=100`, storeHeaders(w))
        const first = all.data.products[0]
        const res = await api.get(
          `/store/jerseys?handle=${encodeURIComponent(first.handle)}` +
          `&team=${encodeURIComponent('No Such Team')}&region_id=${w.regionId}`,
          storeHeaders(w))
        expect(res.data.products).toHaveLength(0)
      })

      it('returns nothing, not everything, for a handle that does not exist', async () => {
        const res = await api.get(
          `/store/jerseys?handle=no-such-shirt&region_id=${w.regionId}`, storeHeaders(w))
        expect(res.data.products).toHaveLength(0)
        expect(res.data.count).toBe(0)
      })
    })

    describe('GET /store/facets', () => {
      it('counts what exists', async () => {
        const res = await api.get('/store/facets', storeHeaders(w))
        expect(res.data.total).toBe(1)
        expect(res.data.leagues).toEqual([{ value: 'NFL', count: 1 }])
      })

      /**
       * The category bar groups 173 teams into the leagues they belong to and into the
       * sports they sell in, and those are not the same grouping — Barcelona is league
       * CLUB and sport soccer. Pairing them off the catalogue here is what keeps a
       * hand-maintained map out of the storefront, so the fields are part of the contract
       * rather than incidental extras.
       */
      it('pairs each team with its league and its sport', async () => {
        const res = await api.get('/store/facets', storeHeaders(w))
        expect(res.data.teams).toEqual([
          {
            value: 'Buffalo Bills', count: 1, league: 'NFL', sport: 'football',
            // A photograph of that team's own stock, for the navigation tile. The fixture
            // product has no image, and null is the value the rail falls back from — so
            // the assertion covers the absent case, which is the one `DEFERRED.md` §6 says
            // is common.
            image: null,
          },
        ])
      })

      /**
       * Players are bucketed by sport and capped per bucket. A flat top-N would be
       * entirely NFL, and the athletes the facet exists for — MMA fighters with no sport,
       * no league and no team — carry one or two products each and would never make it.
       */
      it('buckets players by sport rather than returning a flat top-N', async () => {
        const res = await api.get('/store/facets', storeHeaders(w))
        expect(Array.isArray(res.data.players)).toBe(true)
        const football = res.data.players.find((b: any) => b.sport === 'football')
        expect(football.players).toEqual([
          { value: 'Josh Allen', count: 1, team: 'Buffalo Bills' },
        ])
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
        // Shipping is charged on every order, in every zone — `freeOver: 0` is "no
        // threshold" and every consumer guards on `> 0`. See shipping-zones.unit.spec.ts.
        expect(us.freeOver).toBe(0)
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
