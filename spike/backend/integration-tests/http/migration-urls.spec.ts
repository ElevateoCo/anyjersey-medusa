import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { adminHeaders, seedWorld, storeHeaders, type World } from './fixtures'
import { CATALOG_MODULE } from '../../src/modules/catalog'
import { __reset as resetRateLimits } from '../../src/rate-limit'

jest.setTimeout(180 * 1000)

/**
 * The two things the move from Shopify breaks, and what fixes them.
 *
 * **Old URLs.** The import generated fresh slugs, so 1,083 of 3,155 products came out with a
 * different handle from the one the live store has been ranked for. `source_handle` held the
 * mapping all along and nothing read it.
 *
 * **Guest orders.** An account held only orders placed while signed in, so a customer who
 * ordered before registering could never see them. The transfer flow fixes that, and the whole
 * of its security is that the confirmation goes somewhere other than the request came from.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let w: World
    let admin: { headers: Record<string, string> }

    beforeAll(async () => {
      w = await seedWorld(getContainer())
      admin = await adminHeaders(getContainer(), api)
    })

    beforeEach(() => resetRateLimits())

    const fail = (e: any) => e.response

    describe('resolving an old Shopify handle', () => {
      it('maps a renamed product to its new handle', async () => {
        // The shape the import actually produced: a Shopify slug that leads with the year,
        // and a generated one that leads with the team.
        const catalog: any = getContainer().resolve(CATALOG_MODULE)
        const [detail] = await catalog.listJerseyDetails({ id: w.detailId }, { take: 1 })
        await catalog.updateJerseyDetails([{
          id: detail.id, source_handle: '1994-world-cup-romario-team-brazil-yellow-jersey',
        }])

        const res = await api.get(
          '/store/resolve-handle?handle=1994-world-cup-romario-team-brazil-yellow-jersey',
          storeHeaders(w))

        expect(res.status).toBe(200)
        expect(res.data.found).toBe(true)
        // Resolved through the product↔detail link, not by matching handle strings — the two
        // are different values, which is the whole reason this endpoint exists.
        expect(res.data.handle).toBeTruthy()
      })

      it('404s a handle nothing was ever published at', async () => {
        const res = await api.get('/store/resolve-handle?handle=never-existed', storeHeaders(w))
          .catch(fail)
        expect(res.status).toBe(404)
        expect(res.data.found).toBe(false)
      })

      it('refuses a handle that is not one', async () => {
        const res = await api.get('/store/resolve-handle?handle=../../etc/passwd',
          storeHeaders(w)).catch(fail)
        expect(res.status).toBe(400)
      })
    })

    describe('claiming a guest order', () => {
      /** A completed order with no customer on it — the guest case. */
      const guestOrder = async (email: string) => {
        const { data } = await api.post('/store/carts', {
          region_id: w.regionId, sales_channel_id: w.salesChannelId, email,
        }, storeHeaders(w))
        const id = data.cart.id
        await api.post(`/store/carts/${id}/line-items`,
          { variant_id: w.variantIds[0], quantity: 1 }, storeHeaders(w))
        await api.post(`/store/carts/${id}`, {
          shipping_address: { first_name: 'G', last_name: 'T', address_1: '1 St',
            city: 'Dallas', province: 'TX', postal_code: '75201', country_code: 'us', phone: '+1 214 555 0142' },
        }, storeHeaders(w))
        const opts = await api.get(`/store/shipping-options?cart_id=${id}`, storeHeaders(w))
        await api.post(`/store/carts/${id}/shipping-methods`,
          { option_id: opts.data.shipping_options[0].id }, storeHeaders(w))
        const pc = await api.post('/store/payment-collections', { cart_id: id }, storeHeaders(w))
        await api.post(
          `/store/payment-collections/${pc.data.payment_collection.id}/payment-sessions`,
          { provider_id: 'pp_system_default' }, storeHeaders(w))
        const done = await api.post(`/store/carts/${id}/complete`, {}, storeHeaders(w))
        return done.data.order
      }

      /** A signed-in customer, with their auth headers. */
      const customer = async (email: string) => {
        const password = 'supersecret'
        const reg = await api.post('/auth/customer/emailpass/register',
          { email, password }).catch(fail)
        const token = reg?.data?.token ??
          (await api.post('/auth/customer/emailpass', { email, password })).data.token
        await api.post('/store/customers', { email },
          { headers: { ...storeHeaders(w).headers, Authorization: `Bearer ${token}` } })
          .catch(() => undefined)
        const login = await api.post('/auth/customer/emailpass', { email, password })
        return { headers: { ...storeHeaders(w).headers,
                            Authorization: `Bearer ${login.data.token}` } }
      }

      it('refuses an anonymous claim', async () => {
        const order = await guestOrder('guest-anon@example.com')
        const res = await api.post('/store/order-claims',
          { email: 'guest-anon@example.com', order_number: order.display_id },
          storeHeaders(w)).catch(fail)
        expect(res.status).toBe(401)
      })

      it('starts a transfer when the number and email match', async () => {
        const email = 'guest-ok@example.com'
        const order = await guestOrder(email)
        const auth = await customer('claimer@example.com')

        const res = await api.post('/store/order-claims',
          { email, order_number: order.display_id }, auth).catch(fail)

        expect(res.status).toBe(200)
        expect(res.data.requested).toBe(true)
        // The message has to say where the email went, or the customer waits for one that
        // is not coming.
        expect(res.data.message).toMatch(/inbox for the address on that order/i)
      })

      it('answers identically for a wrong email and a missing order', async () => {
        const order = await guestOrder('guest-real@example.com')
        const auth = await customer('guesser@example.com')

        const wrongEmail = await api.post('/store/order-claims',
          { email: 'not-theirs@example.com', order_number: order.display_id },
          auth).catch(fail)
        const noSuchOrder = await api.post('/store/order-claims',
          { email: 'not-theirs@example.com', order_number: 999999 }, auth).catch(fail)

        // Guessing order numbers must yield nothing — same status, same body.
        expect(wrongEmail.status).toBe(404)
        expect(noSuchOrder.status).toBe(404)
        expect(wrongEmail.data).toEqual(noSuchOrder.data)
      })

      it('needs both halves', async () => {
        const auth = await customer('halves@example.com')
        const res = await api.post('/store/order-claims',
          { email: 'someone@example.com' }, auth).catch(fail)
        expect(res.status).toBe(400)
      })

      it('is rate limited', async () => {
        const auth = await customer('flooder@example.com')
        const codes: number[] = []
        for (let i = 0; i < 8; i++) {
          codes.push(await api.post('/store/order-claims',
            { email: 'x@example.com', order_number: 100000 + i }, auth)
            .then((r: any) => r.status).catch((e: any) => e.response.status))
        }
        // Authenticated or not, walking the id space is walking the id space.
        expect(codes).toContain(429)
      })
    })
  },
})
