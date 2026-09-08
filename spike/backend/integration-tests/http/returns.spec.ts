import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { seedWorld, storeHeaders, adminHeaders, type World } from './fixtures'
import { CATALOG_MODULE } from '../../src/modules/catalog'
import { __reset as resetRateLimits } from '../../src/rate-limit'

jest.setTimeout(180 * 1000)

/**
 * Self-service returns.
 *
 * The endpoint is unauthenticated and operates on somebody's order, so the guarantees
 * asserted here are the same ones `/store/order-lookup` needed: both the order number and
 * the matching email, one indistinguishable response for a wrong email and a missing order,
 * and no field returned that the customer did not already know.
 *
 * On top of that, the thing worth testing hardest: **eligibility is re-decided on submit.**
 * The GET tells the storefront what to offer; a client that ignores it and posts anyway must
 * be refused rather than creating a row a human has to decline by hand.
 *
 * **Every test builds its own order and its own request.** The runner rolls the database
 * back between tests, so state created in one `it` is gone by the next — the first version
 * of this file created a request in one test and asserted the duplicate rule in the next,
 * which reported the rule as broken when it was the test that was. Same convention as
 * `community.spec.ts`, and worth stating because "it worked when I ran that test alone" is
 * the symptom.
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

    /**
     * The rate limiter's buckets are module state and every request in the suite arrives
     * from the same address, so a suite of eighteen tests exhausts a 6-per-minute budget
     * around test seven and every later test 429s. That is the limiter working; it is the
     * suite that has to reset it. Cleared per test rather than raising the limit under test,
     * because a budget that is only enforced in production is not a tested budget — and the
     * two tests at the bottom deliberately blow through it.
     */
    beforeEach(() => resetRateLimits())

    /** A completed order through the system provider, so no Stripe key is needed. */
    async function buy(as: string) {
      const { data } = await api.post('/store/carts', {
        region_id: w.regionId, sales_channel_id: w.salesChannelId, email: as,
      }, storeHeaders(w))
      const id = data.cart.id
      await api.post(`/store/carts/${id}/line-items`,
        { variant_id: w.variantIds[0], quantity: 1 }, storeHeaders(w))
      await api.post(`/store/carts/${id}`, {
        shipping_address: { first_name: 'R', last_name: 'T', address_1: '1 St',
          city: 'Dallas', province: 'TX', postal_code: '75201', country_code: 'us', phone: '+1 214 555 0142' },
      }, storeHeaders(w))
      const opts = await api.get(`/store/shipping-options?cart_id=${id}`, storeHeaders(w))
      await api.post(`/store/carts/${id}/shipping-methods`,
        { option_id: opts.data.shipping_options[0].id }, storeHeaders(w))
      const pc = await api.post('/store/payment-collections', { cart_id: id }, storeHeaders(w))
      await api.post(
        `/store/payment-collections/${pc.data.payment_collection.id}/payment-sessions`,
        { provider_id: 'pp_system_default' }, storeHeaders(w)
      )
      const done = await api.post(`/store/carts/${id}/complete`, {}, storeHeaders(w))
      const order = done.data.order
      const full = await api.get(`/admin/orders/${order.id}?fields=*items`, admin)
      return { order, lineId: full.data.order.items[0].id as string }
    }

    const request = (email: string, displayId: number, lineId: string,
                     over: Record<string, unknown> = {}) =>
      api.post('/store/return-requests', {
        email, order_number: String(displayId), line_item_id: lineId,
        // Faults are the only thing a final-sale policy accepts from a US order, so that is
        // the default here. The refusals get their own tests.
        kind: 'fault', reason: 'faulty', ...over,
      }, storeHeaders(w))

    describe('proving the claim to the order', () => {
      it('lists the returnable items for the right number and email', async () => {
        const { order } = await buy('lookup@example.com')
        const res = await api.get(
          `/store/return-requests?email=lookup@example.com&order_number=${order.display_id}`,
          storeHeaders(w)
        )
        expect(res.data.order.number).toBe(order.display_id)
        expect(res.data.items.length).toBeGreaterThan(0)
        expect(res.data.items[0].eligible).toBe(true)
        expect(res.data.window_days).toBe(30)
        // The published stance travels with the payload, so the form cannot describe a
        // policy the API does not enforce.
        expect(res.data.stance).toBe('final-sale')
        expect(res.data.withdrawal_window_days).toBe(14)
      })

      it('answers identically for a wrong email and a missing order', async () => {
        // Two different responses here would let anyone confirm which addresses have
        // ordered, one order number at a time.
        const { order } = await buy('quiet@example.com')
        const wrongEmail = await api.get(
          `/store/return-requests?email=nobody@example.com&order_number=${order.display_id}`,
          storeHeaders(w)
        ).catch((e: any) => e.response)
        const noOrder = await api.get(
          '/store/return-requests?email=quiet@example.com&order_number=99999999',
          storeHeaders(w)
        ).catch((e: any) => e.response)
        expect(wrongEmail.status).toBe(404)
        expect(noOrder.status).toBe(404)
        expect(wrongEmail.data).toEqual(noOrder.data)
      })

      it('refuses a lookup with only one of the two', async () => {
        const res = await api
          .get('/store/return-requests?email=a@b.c', storeHeaders(w))
          .catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })

      it('returns nothing the customer did not already know', async () => {
        const { order } = await buy('minimal@example.com')
        const res = await api.get(
          `/store/return-requests?email=minimal@example.com&order_number=${order.display_id}`,
          storeHeaders(w)
        )
        const body = JSON.stringify(res.data)
        // No internal identifiers beyond the line id the form has to post back.
        expect(body).not.toContain(order.id)
        expect(body).not.toContain('payment')
      })
    })

    describe('creating a request', () => {
      it('accepts a fault and records that we pay the postage', async () => {
        const { order, lineId } = await buy('ex@example.com')
        const res = await request('ex@example.com', order.display_id, lineId)
        expect(res.status).toBe(201)
        // Our error, so our postage. Stored at creation rather than decided later by
        // whoever opens the queue.
        expect(res.data.we_pay_postage).toBe(true)
        expect(res.data.status).toBe('new')
      })

      it('refuses a wrong size, because all sales are final', async () => {
        // The live policy is explicit: "We do not accept returns for: Incorrect size
        // ordered." This is the request the shop receives most and accepts least.
        const { order, lineId } = await buy('toosmall@example.com')
        const res = await request('toosmall@example.com', order.display_id, lineId,
          { reason: 'too_small' }).catch((e: any) => e.response)
        expect(res.status).toBe(409)
        expect(res.data.message).toMatch(/size guide/i)
      })

      it('refuses a change of mind from a US order', async () => {
        const { order, lineId } = await buy('mind@example.com')
        const res = await request('mind@example.com', order.display_id, lineId,
          { reason: 'changed_mind' }).catch((e: any) => e.response)
        expect(res.status).toBe(409)
        expect(res.data.message).toMatch(/all sales are final/i)
      })

      it('refuses a statutory cancellation where the right does not apply', async () => {
        // The seeded region is the US. Claiming `withdrawal` must not create one.
        const { order, lineId } = await buy('nowithdraw@example.com')
        const res = await request('nowithdraw@example.com', order.display_id, lineId,
          { kind: 'withdrawal', reason: 'changed_mind' }).catch((e: any) => e.response)
        expect(res.status).toBe(409)
      })

      it('does not offer the statutory route on a US order', async () => {
        const { order } = await buy('usonly@example.com')
        const res = await api.get(
          `/store/return-requests?email=usonly@example.com&order_number=${order.display_id}`,
          storeHeaders(w)
        )
        expect(res.data.items.every((i: any) => i.withdrawal === false)).toBe(true)
      })

      it('refuses a second request for the same line', async () => {
        const { order, lineId } = await buy('twice@example.com')
        const first = await request('twice@example.com', order.display_id, lineId)
        expect(first.status).toBe(201)
        const second = await request('twice@example.com', order.display_id, lineId)
          .catch((e: any) => e.response)
        expect(second.status).toBe(409)
        expect(second.data.message).toMatch(/already an open return/i)
      })

      it('refuses a line that is not on the order', async () => {
        const { order } = await buy('wrongline@example.com')
        const res = await request('wrongline@example.com', order.display_id, 'ordli_not_real')
          .catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })

      it('refuses a personalised line, re-deciding server-side', async () => {
        // The whole point of the rule living in one pure function: the page that offers the
        // option and the endpoint that accepts it must not be able to disagree. Here the
        // client asks for something the GET would never have offered.
        const buyer = 'personalised@example.com'
        const { order, lineId } = await buy(buyer)

        const catalog: any = getContainer().resolve(CATALOG_MODULE)
        await catalog.createLinePersonalisations([{
          order_id: order.id, order_line_id: lineId, product_id: w.productId,
          kind: 'name', value: 'ALLEN', price: 1499, typeface: 'block', placement: 'back',
        }])

        const offered = await api.get(
          `/store/return-requests?email=${buyer}&order_number=${order.display_id}`,
          storeHeaders(w)
        )
        const item = offered.data.items.find((i: any) => i.line_item_id === lineId)
        expect(item.eligible).toBe(false)
        expect(item.reason).toMatch(/specification/i)

        const res = await request(buyer, order.display_id, lineId)
          .catch((e: any) => e.response)
        expect(res.status).toBe(409)
        expect(res.data.message).toMatch(/specification/i)
      })
    })

    describe('the admin queue', () => {
      it('lists new requests oldest first', async () => {
        const a = await buy('q1@example.com')
        await request('q1@example.com', a.order.display_id, a.lineId)
        const b = await buy('q2@example.com')
        await request('q2@example.com', b.order.display_id, b.lineId)

        const res = await api.get('/admin/return-requests?status=new', admin)
        expect(res.data.count).toBeGreaterThanOrEqual(2)
        expect(res.data.counts).toHaveProperty('new')
        const dates = res.data.return_requests.map((r: any) => +new Date(r.created_at))
        // Oldest first: a newest-first queue starves its own backlog, and the backlog here
        // is a customer waiting to be told whether they can send a shirt back.
        expect([...dates].sort((x: number, y: number) => x - y)).toEqual(dates)
      })

      it('refuses to decline without a note, because the customer is told it', async () => {
        const { order, lineId } = await buy('nonote@example.com')
        const made = await request('nonote@example.com', order.display_id, lineId)
        const res = await api.post(`/admin/return-requests/${made.data.id}`,
          { action: 'decline' }, admin).catch((e: any) => e.response)
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/note/i)
      })

      it('records the note on a decline, so support has something to say', async () => {
        const { order, lineId } = await buy('declined@example.com')
        const made = await request('declined@example.com', order.display_id, lineId)
        const res = await api.post(`/admin/return-requests/${made.data.id}`,
          { action: 'decline', note: 'Outside the window by four months.' }, admin)
        expect(res.data.return_request.status).toBe('declined')
        expect(res.data.return_request.decision_note).toMatch(/four months/)
      })

      it('moves a request along and keeps the postage promise unchanged', async () => {
        const { order, lineId } = await buy('approve@example.com')
        const made = await request('approve@example.com', order.display_id, lineId)
        expect(made.data.we_pay_postage).toBe(true)

        const res = await api.post(`/admin/return-requests/${made.data.id}`,
          { action: 'approve' }, admin)
        expect(res.data.return_request.status).toBe('approved')
        // Whoever actions the case must not be able to revoke what the customer was
        // already promised by email.
        expect(res.data.return_request.return_shipping_paid_by).toBe('us')
      })

      it('rejects an action it does not know', async () => {
        const { order, lineId } = await buy('badaction@example.com')
        const made = await request('badaction@example.com', order.display_id, lineId)
        const res = await api.post(`/admin/return-requests/${made.data.id}`,
          { action: 'refund_everything' }, admin).catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })

      it('404s an id that does not exist', async () => {
        const res = await api.post('/admin/return-requests/rr_nope',
          { action: 'approve' }, admin).catch((e: any) => e.response)
        expect(res.status).toBe(404)
      })
    })

    describe('rate limiting', () => {
      it('answers 429 once the write budget is gone', async () => {
        // A public POST that writes a row and emails a human. The limit is 6/minute; this
        // fires twelve and expects to be stopped. Closes the gap the README listed as open:
        // "/store/jersey-requests has no rate limit — a public POST that writes rows."
        const attempts = await Promise.all(
          Array.from({ length: 12 }, () =>
            api.post('/store/return-requests', {
              email: 'flood@example.com', order_number: '1', line_item_id: 'x',
              kind: 'fault', reason: 'faulty',
            }, storeHeaders(w)).then(
              (r: any) => r.status,
              (e: any) => e.response?.status ?? 0
            )
          )
        )
        expect(attempts).toContain(429)
      })

      it('rate-limits jersey requests too', async () => {
        const attempts = await Promise.all(
          Array.from({ length: 16 }, (_, i) =>
            api.post('/store/jersey-requests', {
              email: `flood${i}@example.com`, raw_request: 'A shirt, any shirt',
            }, storeHeaders(w)).then(
              (r: any) => r.status,
              (e: any) => e.response?.status ?? 0
            )
          )
        )
        expect(attempts).toContain(429)
      })
    })
    /**
     * The refund.
     *
     * The one action in this queue that is irreversible outside the database, and the reason
     * the queue recorded decisions and moved no money until now. What is asserted hardest is
     * the second click: Medusa's refund workflow takes no idempotency key, so `refunded_at`
     * is the entire guarantee.
     */
    describe('refunding', () => {
      const catalog = () => getContainer().resolve(CATALOG_MODULE) as any

      const refund = (id: string, body: Record<string, unknown> = {}) =>
        api.post(`/admin/return-requests/${id}`,
          { action: 'refund', ...body }, admin).catch((e: any) => e.response)

      /** A return request sitting in the state a refund is allowed from. */
      const received = async (over: Record<string, unknown> = {}) => {
        const [row] = await catalog().createReturnRequests([{
          order_id: 'order_missing', email: 'refundme@example.com',
          kind: 'fault', reason: 'faulty', status: 'received', ...over,
        }])
        return row
      }

      it('refuses before the goods are back', async () => {
        const row = await received({ status: 'approved' })
        const res = await refund(row.id, { amount: 6599 })

        // Under a final-sale policy the goods coming back is the thing being verified.
        expect(res.status).toBe(409)
        expect(res.data.message).toMatch(/marked received/i)
      })

      it('refuses without an amount rather than guessing one', async () => {
        const row = await received()
        const res = await refund(row.id)

        // A return is usually one item out of several, and a default that refunds the order
        // total is a mistake nobody notices until it has happened.
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/no safe default/i)
      })

      it('refuses when the order has no captured payment', async () => {
        const row = await received()
        const res = await refund(row.id, { amount: 6599 })
        expect(res.status).toBe(409)
        expect(res.data.message).toMatch(/nothing to refund/i)
      })

      it('will not refund the same return twice', async () => {
        // The guarantee, asserted directly on the row rather than through a payment: the
        // check is `refunded_at`, and it is what stops a lost response becoming two refunds.
        const row = await received()
        await catalog().updateReturnRequests([{
          id: row.id, refunded_at: new Date(), refunded_by: 'someone', refund_amount: 6599,
        }])

        const res = await refund(row.id, { amount: 6599 })
        expect(res.status).toBe(409)
        expect(res.data.message).toMatch(/already refunded/i)
        // Told what the first one did, so an operator who clicked twice knows it worked.
        expect(res.data.refund_amount).toBe(6599)
      })

      it('names refund in the list of valid actions', async () => {
        const row = await received()
        const res = await api.post(`/admin/return-requests/${row.id}`,
          { action: 'nonsense' }, admin).catch((e: any) => e.response)
        expect(res.data.message).toMatch(/refund/)
      })
    })
  },
})
