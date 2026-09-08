import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { seedWorld, storeHeaders, adminHeaders, type World } from './fixtures'

jest.setTimeout(180 * 1000)

/**
 * The money path, end to end, through HTTP against a real database.
 *
 * This is the test the unit suite structurally cannot be: it exercises the workflows, the
 * price context, the shipping-profile match and the order totals — every one of which
 * produced a real defect during the build, and none of which a mocked test would have
 * caught.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let w: World
    let admin: { headers: Record<string, string> }
    let shoppers = 1

    beforeAll(async () => {
      w = await seedWorld(getContainer())
      admin = await adminHeaders(getContainer(), api)
    })

    /**
     * Drives a cart to a completed order using the system payment provider, which
     * auto-authorises — so there is no manual authorize step. The first version of this
     * called paymentModule.authorizePaymentSession on a session the cart relation did not
     * return, threw on undefined, and failed every test in the suite.
     */
    async function buy(email: string, quantity = 1) {
      /**
       * Each simulated purchase is a different shopper, and now has to say so.
       *
       * Cart creation, payment sessions and completion are all rate-limited per customer —
       * card testing is the whole reason — and a customer is identified by the address the
       * storefront forwards (src/rate-limit.ts). Without this the reporting tests, which
       * place a dozen orders inside one `it`, buy through one identity and are refused on
       * the eleventh. That 429 is the limit working; making every buyer distinct is what
       * makes the fixture honest rather than what makes the failure go away.
       */
      // Counted rather than randomised: a random address collides often enough at this
      // sample size to make a failure look intermittent, which is the worst kind.
      const shopper = {
        headers: {
          ...storeHeaders(w).headers,
          'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '',
          'x-client-ip': `203.0.113.${shoppers++}`,
        },
      }

      const { data: created } = await api.post('/store/carts', {
        region_id: w.regionId, sales_channel_id: w.salesChannelId, email,
      }, shopper)
      const cartId = created.cart.id

      // Only variant_id and quantity ever cross the wire — the price is the server's.
      await api.post(`/store/carts/${cartId}/line-items`,
        { variant_id: w.variantIds[0], quantity }, storeHeaders(w))

      await api.post(`/store/carts/${cartId}`, {
        shipping_address: {
          first_name: 'Test', last_name: 'Buyer', address_1: '1 Example St',
          city: 'Dallas', province: 'TX', postal_code: '75201', country_code: 'us',
          // Checkout requires one by default, so a fixture simulating a real checkout
          // carries one. The requirement itself is tested in settings.spec.ts.
          phone: '+1 214 555 0142',
        },
      }, storeHeaders(w))

      const opts = await api.get(`/store/shipping-options?cart_id=${cartId}`, storeHeaders(w))
      await api.post(`/store/carts/${cartId}/shipping-methods`,
        { option_id: opts.data.shipping_options[0].id }, storeHeaders(w))

      const pc = await api.post('/store/payment-collections',
        { cart_id: cartId }, shopper)
      await api.post(`/store/payment-collections/${pc.data.payment_collection.id}/payment-sessions`,
        { provider_id: 'pp_system_default' }, shopper)

      const done = await api.post(`/store/carts/${cartId}/complete`, {}, shopper)
      return { cartId, order: done.data.order ?? done.data }
    }

    describe('cart to order', () => {
      it('rejects a client-supplied price outright', async () => {
        const { data } = await api.post('/store/carts', {
          region_id: w.regionId, sales_channel_id: w.salesChannelId, email: 'p@example.com',
        }, storeHeaders(w))
        // Stronger than ignoring it: Medusa refuses the request. Asserting the rejection
        // pins the actual guarantee rather than a weaker one.
        const res = await api.post(`/store/carts/${data.cart.id}/line-items`,
          { variant_id: w.variantIds[0], quantity: 1, unit_price: 1 }, storeHeaders(w))
          .catch((e: any) => e.response)
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/unit_price/)
      })

      it('prices from the server', async () => {
        const { data } = await api.post('/store/carts', {
          region_id: w.regionId, sales_channel_id: w.salesChannelId, email: 'p2@example.com',
        }, storeHeaders(w))
        await api.post(`/store/carts/${data.cart.id}/line-items`,
          { variant_id: w.variantIds[0], quantity: 1 }, storeHeaders(w))
        const cart = await api.get(`/store/carts/${data.cart.id}`, storeHeaders(w))
        expect(Number(cart.data.cart.subtotal)).toBe(64.99)
      })

      it('adds shipping at the zone rate', async () => {
        const { order } = await buy('buyer1@example.com')
        expect(Number(order.shipping_total)).toBe(4.99)
        expect(Number(order.total)).toBe(69.98)
      })

      it('produces an order with the right line items', async () => {
        const { order } = await buy('buyer2@example.com', 2)
        expect(order.items).toHaveLength(1)
        expect(Number(order.items[0].quantity)).toBe(2)
        expect(Number(order.total)).toBe(64.99 * 2 + 4.99)
      })

      it('completing twice is idempotent, not a second order', async () => {
        // Medusa returns the same order rather than erroring. That is the safer
        // behaviour — a retried request must never bill twice — so the invariant to
        // pin is "same order", not "second call fails".
        const { cartId, order } = await buy('buyer3@example.com')
        const again = await api.post(`/store/carts/${cartId}/complete`, {}, storeHeaders(w))
          .catch((e: any) => e.response)
        if (again.status === 200) {
          expect((again.data.order ?? again.data).id).toBe(order.id)
        } else {
          expect(again.status).toBeGreaterThanOrEqual(400)
        }
      })
    })

    // Every test that needs an order makes its own. Sharing one through a describe-level
    // beforeAll made several tests fail for reasons that had nothing to do with the code
    // under test — self-contained is slower and worth it.
    describe('POST /store/order-lookup', () => {
      it('finds an order with the number and the matching email', async () => {
        const email = 'lookup1@example.com'
        const { order } = await buy(email)
        const res = await api.post('/store/order-lookup',
          { order_number: order.display_id, email }, storeHeaders(w))
        expect(res.status).toBe(200)
        expect(res.data.order.number).toBe(order.display_id)
        expect(res.data.order.items.length).toBeGreaterThan(0)
        expect(res.data.order.total).toBe(69.98)
      })

      it('leaks no internal identifiers', async () => {
        const email = 'lookup2@example.com'
        const { order } = await buy(email)
        const res = await api.post('/store/order-lookup',
          { order_number: order.display_id, email }, storeHeaders(w))
        const keys = Object.keys(res.data.order)
        for (const leaky of ['id', 'customer_id', 'payment_collections', 'metadata']) {
          expect(keys).not.toContain(leaky)
        }
      })

      it('refuses the right number with the wrong email', async () => {
        const { order } = await buy('lookup3@example.com')
        const res = await api.post('/store/order-lookup',
          { order_number: order.display_id, email: 'attacker@example.com' }, storeHeaders(w))
          .catch((e: any) => e.response)
        expect(res.status).toBe(404)
      })

      it('cannot be used to enumerate order numbers', async () => {
        // Wrong email and no-such-order must be indistinguishable, or the endpoint
        // becomes an oracle for which order numbers exist.
        const { order } = await buy('lookup4@example.com')
        const wrongEmail = await api.post('/store/order-lookup',
          { order_number: order.display_id, email: 'nobody@example.com' }, storeHeaders(w))
          .catch((e: any) => e.response)
        const noSuchOrder = await api.post('/store/order-lookup',
          { order_number: 999999, email: 'nobody@example.com' }, storeHeaders(w))
          .catch((e: any) => e.response)
        expect(wrongEmail.status).toBe(noSuchOrder.status)
        expect(wrongEmail.data).toEqual(noSuchOrder.data)
      })

      it('requires both fields', async () => {
        const res = await api.post('/store/order-lookup',
          { order_number: 1 }, storeHeaders(w)).catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })
    })

    describe('abandoned carts', () => {
      /**
       * The recovery email is the one commercial message this shop sends, and it now refuses
       * to go out without a postal address — CAN-SPAM requires one, and the route treats a
       * missing regulatory value the way the rest of this codebase does: as a reason to stop
       * rather than something to omit quietly.
       *
       * Set here rather than asserted around, because these tests are about the recovery
       * mechanics — sent once, refused twice — and the compliance checks have their own suite
       * in unsubscribe.spec.ts.
       */
      const savedAddress = process.env.SHOP_POSTAL_ADDRESS
      beforeAll(() => { process.env.SHOP_POSTAL_ADDRESS = '1 Example Street, Dallas TX 75201' })
      afterAll(() => {
        if (savedAddress === undefined) delete process.env.SHOP_POSTAL_ADDRESS
        else process.env.SHOP_POSTAL_ADDRESS = savedAddress
      })

      it('lists a cart with items, an email and no order', async () => {
        const { data } = await api.post('/store/carts', {
          region_id: w.regionId, sales_channel_id: w.salesChannelId,
          email: 'abandoned@example.com',
        }, storeHeaders(w))
        await api.post(`/store/carts/${data.cart.id}/line-items`,
          { variant_id: w.variantIds[0], quantity: 1 }, storeHeaders(w))

        // hours=0 must mean zero. It became 1 in the first version because
        // `Number(x) || 1` treats 0 as absent.
        const res = await api.get('/admin/abandoned-carts?hours=0', admin)
        const mine = res.data.abandoned_carts.find(
          (c: any) => c.email === 'abandoned@example.com'
        )
        expect(mine).toBeDefined()
        expect(mine.value).toBe(64.99)
        expect(mine.units).toBe(1)
      })

      it('excludes completed carts', async () => {
        const { cartId } = await buy('completed@example.com')
        const res = await api.get('/admin/abandoned-carts?hours=0', admin)
        expect(res.data.abandoned_carts.map((c: any) => c.id)).not.toContain(cartId)
      })

      it('sends recovery once and refuses a second time', async () => {
        const { data } = await api.post('/store/carts', {
          region_id: w.regionId, sales_channel_id: w.salesChannelId,
          email: 'recover-me@example.com',
        }, storeHeaders(w))
        await api.post(`/store/carts/${data.cart.id}/line-items`,
          { variant_id: w.variantIds[0], quantity: 1 }, storeHeaders(w))

        const first = await api.post(
          `/admin/abandoned-carts/${data.cart.id}/recover`, {}, admin
        )
        expect(first.status).toBe(200)
        expect(first.data.recovery_sent_at).toBeTruthy()

        // A duplicate "you left something behind" email is a good way to lose the
        // customer you were recovering.
        const second = await api.post(
          `/admin/abandoned-carts/${data.cart.id}/recover`, {}, admin
        ).catch((e: any) => e.response)
        expect(second.status).toBe(409)
      })

      it('refuses recovery on a completed cart', async () => {
        const { cartId } = await buy('done@example.com')
        const res = await api.post(`/admin/abandoned-carts/${cartId}/recover`, {}, admin)
          .catch((e: any) => e.response)
        expect(res.status).toBe(409)
      })
    })

    describe('GET /admin/reports/overview', () => {
      it('reports revenue as a number, not a concatenated string', async () => {
        // Postgres numerics arrive as strings; `revenue += total` once produced a report
        // where revenue equalled the shipping total exactly.
        await buy('report1@example.com')
        const res = await api.get('/admin/reports/overview?days=30', admin)
        const t = res.data.totals
        expect(typeof t.revenue).toBe('number')
        expect(t.orders).toBeGreaterThan(0)
        expect(t.revenue).toBeGreaterThan(t.shipping)
        expect(t.units).toBeGreaterThan(0)
      })

      it('AOV reconciles with revenue and order count', async () => {
        await buy('report2@example.com')
        const { totals } = (await api.get('/admin/reports/overview?days=30', admin)).data
        expect(Math.abs(totals.aov * totals.orders - totals.revenue)).toBeLessThan(1)
      })

      it('groups by the derived taxonomy', async () => {
        // Only possible because the taxonomy is derived — these fields are empty in the
        // source catalog, so the same report on Shopify would be blank.
        await buy('report3@example.com')
        const res = await api.get('/admin/reports/overview?days=30', admin)
        expect(res.data.by_league.map((b: any) => b.key)).toContain('NFL')
        expect(res.data.by_team.map((b: any) => b.key)).toContain('Buffalo Bills')
      })

      it('fills empty days instead of skipping them', async () => {
        const res = await api.get('/admin/reports/overview?days=14', admin)
        expect(res.data.series).toHaveLength(14)
      })
    })
  },
})
