import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { seedWorld, storeHeaders, type World } from './fixtures'
import { CATALOG_MODULE } from '../../src/modules/catalog'

jest.setTimeout(180 * 1000)

/**
 * Custom jerseys: printing included in the shirt's price.
 *
 * The live store sells these as a separate line at $89.99 against a $64.99 base, with the
 * name and number included, and no personalisation control at all on its regular player
 * jerseys. Two things have to hold, and they pull in opposite directions:
 *
 *  1. **Included must mean free printing, not absent personalisation.** A custom shirt with
 *     a name still has to write the rows the print queue and the human review gate work
 *     from, or a printed shirt reaches a supplier with nothing recorded about what to print.
 *  2. **A client must not be able to claim free printing on a paid shirt.** `is_custom` is
 *     read from the product on every request; it is never taken from the caller.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let w: World

    beforeAll(async () => {
      w = await seedWorld(getContainer())
    })

    /** Flip the seeded product between the two commercial shapes. */
    const setCustom = async (is_custom: boolean) => {
      const catalog: any = getContainer().resolve(CATALOG_MODULE)
      await catalog.updateJerseyDetails({ id: w.detailId, is_custom })
    }

    const offer = () =>
      api.get(`/store/personalisation?product_id=${w.productId}`, storeHeaders(w))

    const quote = (body: Record<string, unknown>) =>
      api.post('/store/personalisation', { product_id: w.productId, ...body }, storeHeaders(w))

    async function cartWithShirt() {
      const { data } = await api.post('/store/carts', {
        region_id: w.regionId, sales_channel_id: w.salesChannelId,
      }, storeHeaders(w))
      const cartId = data.cart.id
      await api.post(`/store/carts/${cartId}/line-items`,
        { variant_id: w.variantIds[0], quantity: 1 }, storeHeaders(w))
      const full = await api.get(`/store/carts/${cartId}?fields=*items`, storeHeaders(w))
      return { cartId, lineId: full.data.cart.items[0].id }
    }

    afterEach(() => setCustom(false))

    describe('the offer', () => {
      it('reports included and zeroes the printing prices', async () => {
        await setCustom(true)
        const res = await offer()
        expect(res.data.included).toBe(true)
        expect(res.data.prices.name).toBe(0)
        expect(res.data.prices.number).toBe(0)
        expect(res.data.prices.bundle).toBe(0)
        // "from $9.99" is a price. There is nothing to quote here.
        expect(res.data.from).toBe(0)
      })

      it('still charges for a patch, which is a physical extra rather than printing', async () => {
        await setCustom(true)
        const res = await offer()
        expect(res.data.prices.patch).toBeGreaterThan(0)
      })

      it('leaves a regular jersey priced as an add-on', async () => {
        const res = await offer()
        expect(res.data.included).toBe(false)
        expect(res.data.prices.bundle).toBeGreaterThan(0)
        expect(res.data.from).toBeGreaterThan(0)
      })

      it('discloses the made-to-order exclusion in the custom wording', async () => {
        // §7: the disclosure ships with the offer rather than being left to the storefront.
        await setCustom(true)
        const res = await offer()
        expect(res.data.notice.non_returnable).toMatch(/custom/i)
        expect(res.data.notice.non_returnable).toMatch(/blank/i)
      })
    })

    describe('quoting', () => {
      it('totals zero but still returns a line to print', async () => {
        await setCustom(true)
        const res = await quote({ name: 'RODRIGUEZ', number: '7' })
        expect(res.data.ok).toBe(true)
        expect(res.data.total).toBe(0)
        expect(res.data.included).toBe(true)
        expect(res.data.lines).toHaveLength(1)
        expect(res.data.lines[0].label).toContain('RODRIGUEZ')
      })

      it('still rejects a blocked name — free printing is not a reason to print anything', async () => {
        await setCustom(true)
        const res = await quote({ name: 'HITLER' })
        expect(res.data.ok).toBe(false)
        expect(res.data.normalised.name).toBeNull()
      })
    })

    describe('attaching to a cart', () => {
      it('records the personalisation with no add-on line at all', async () => {
        await setCustom(true)
        const { cartId, lineId } = await cartWithShirt()

        const res = await api.post('/store/personalisation/attach', {
          cart_id: cartId, line_id: lineId, product_id: w.productId,
          name: 'RODRIGUEZ', number: '7',
        }, storeHeaders(w))

        expect(res.data.included).toBe(true)
        expect(res.data.total).toBe(0)
        // Two rows, because a bundle is a price and not a thing that goes on a shirt.
        expect(res.data.personalisations.map((p: any) => p.kind).sort())
          .toEqual(['name', 'number'])
        expect(res.data.personalisations.every((p: any) => p.price === 0)).toBe(true)

        // And the cart still holds exactly one line: the shirt.
        const cart = await api.get(`/store/carts/${cartId}?fields=*items`, storeHeaders(w))
        expect(cart.data.cart.items).toHaveLength(1)
      })

      it('starts the record pending, so nothing prints without a human', async () => {
        await setCustom(true)
        const { cartId, lineId } = await cartWithShirt()
        const res = await api.post('/store/personalisation/attach', {
          cart_id: cartId, line_id: lineId, product_id: w.productId, name: 'ALLEN',
        }, storeHeaders(w))
        expect(res.data.personalisations[0].review_status).toBe('pending')
      })

      it('refuses an empty selection rather than creating a blank record', async () => {
        // The old check tested `total === 0`, which on a custom shirt is true of a perfectly
        // good selection. Emptiness has to be tested on the selection itself.
        await setCustom(true)
        const { cartId, lineId } = await cartWithShirt()
        const res = await api.post('/store/personalisation/attach', {
          cart_id: cartId, line_id: lineId, product_id: w.productId,
        }, storeHeaders(w)).catch((e: any) => e.response)
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/nothing to personalise/i)
      })

      it('refuses free printing on a shirt that is not custom', async () => {
        // The security property. `is_custom` is read from the product, so a client cannot
        // reach this path by asserting it.
        const { cartId, lineId } = await cartWithShirt()
        const res = await api.post('/store/personalisation/attach', {
          cart_id: cartId, line_id: lineId, product_id: w.productId,
          name: 'FREEBIE', number: '1',
        }, storeHeaders(w)).catch((e: any) => e.response)
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/personalisation line is missing/i)
      })

      it('does not let a request body claim the shirt is custom', async () => {
        const { cartId, lineId } = await cartWithShirt()
        const res = await api.post('/store/personalisation/attach', {
          cart_id: cartId, line_id: lineId, product_id: w.productId,
          name: 'FREEBIE', included: true, is_custom: true,
        }, storeHeaders(w)).catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })
    })

    describe('the listing filter', () => {
      it('returns only custom jerseys for custom=true', async () => {
        await setCustom(true)
        const res = await api.get(
          `/store/jerseys?custom=true&region_id=${w.regionId}`, storeHeaders(w)
        )
        expect(res.data.count).toBe(1)
        expect(res.data.products[0].detail.is_custom).toBe(true)
      })

      it('excludes them for custom=false', async () => {
        await setCustom(true)
        const res = await api.get(
          `/store/jerseys?custom=false&region_id=${w.regionId}`, storeHeaders(w)
        )
        expect(res.data.count).toBe(0)
      })

      it('ignores an unparseable value rather than returning nothing', async () => {
        // A boolean column compared against the string "maybe" matches nothing — silently,
        // which reads as an empty catalog rather than a bad parameter.
        await setCustom(true)
        const res = await api.get(
          `/store/jerseys?custom=maybe&region_id=${w.regionId}`, storeHeaders(w)
        )
        expect(res.data.count).toBeGreaterThan(0)
      })

      it('counts them in the facets as a number, not a facet list', async () => {
        await setCustom(true)
        const res = await api.get('/store/facets', storeHeaders(w))
        // The facet cache is 5 minutes, so this asserts the shape rather than the value —
        // a "false" entry appearing in the navigation is the failure being guarded.
        expect(typeof res.data.custom).toBe('number')
        expect(res.data).not.toHaveProperty('customs')
      })
    })
  },
})
