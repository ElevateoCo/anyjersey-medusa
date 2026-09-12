import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { adminHeaders, seedWorld, storeHeaders, type World } from './fixtures'
import { __reset as resetRateLimits } from '../../src/rate-limit'

jest.setTimeout(240 * 1000)

/**
 * The order register and its two exports, against a real database.
 *
 * The unit suite covers what is pure — filtering, sorting, the CSV escaping, the state
 * machines as functions over a shaped object. None of that could answer the question this
 * file exists for: **do `payment` and `fulfilment` resolve at all?**
 *
 * `src/orders.ts` derives both from relations rather than requesting Medusa's computed
 * `payment_status` and `fulfillment_status`, because a computed field that does not resolve
 * through `query.graph` comes back `undefined` instead of erroring — the trap that once
 * produced a cart page showing $0.00 above a $4.99 total. A derivation is only better than
 * the trap if it is checked, and until this file ran it was not: it was written against a
 * database that had already gone unreachable.
 *
 * It found one. `paymentState()` summed `captured_amount` and `refunded_amount` off each
 * *payment*, and `payment` has no such columns — on the Payment model both are computed from
 * the `captures` and `refunds` relations. Both sums were always 0, so the refund branch was
 * dead and a fully refunded order reported as `paid`. The totals now come off the payment
 * *collection*, where they are ordinary stored columns.
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

    beforeEach(() => resetRateLimits())

    const fail = (e: any) => e.response

    /** A distinct IP per shopper, or the checkout rate limit answers instead of the cart. */
    const shopper = () => ({
      headers: {
        ...storeHeaders(w).headers,
        'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '',
        'x-client-ip': `198.51.100.${shoppers++}`,
      },
    })

    /**
     * One completed order through the system provider, so no Stripe key is needed.
     *
     * `personalise` attaches a name and number to the shirt line, which is what puts a
     * pending approval on the order — the only thing in this shop that stops a paid,
     * in-stock order from shipping.
     */
    async function buy(opts: {
      email: string
      quantity?: number
      personalise?: boolean
      firstName?: string
    }) {
      const who = shopper()
      const { email, quantity = 1, personalise = false } = opts

      const { data: created } = await api.post('/store/carts', {
        region_id: w.regionId, sales_channel_id: w.salesChannelId, email,
      }, who)
      const cartId = created.cart.id

      const afterShirt = await api.post(`/store/carts/${cartId}/line-items`,
        { variant_id: w.variantIds[0], quantity }, who)
      let cart = afterShirt.data.cart

      if (personalise) {
        const afterAddon = await api.post(`/store/carts/${cartId}/line-items`,
          { variant_id: w.addonVariantIds.BUNDLE, quantity: 1 }, who)
        cart = afterAddon.data.cart
        const lineFor = (variantId: string) =>
          (cart.items ?? []).find((i: any) => i.variant_id === variantId)
        await api.post('/store/personalisation/attach', {
          cart_id: cartId,
          line_id: lineFor(w.variantIds[0]).id,
          addon_line_id: lineFor(w.addonVariantIds.BUNDLE).id,
          product_id: w.productId,
          name: 'Allen',
          number: '17',
        }, who)
      }

      await api.post(`/store/carts/${cartId}`, {
        shipping_address: {
          first_name: opts.firstName ?? 'Norby', last_name: 'Krenik',
          address_1: '17 Nokomis Ave', city: 'Lake Hiawatha', province: 'New Jersey',
          postal_code: '07034', country_code: 'us', phone: '+1 718 902 1256',
        },
      }, who)

      const opt = await api.get(`/store/shipping-options?cart_id=${cartId}`, who)
      await api.post(`/store/carts/${cartId}/shipping-methods`,
        { option_id: opt.data.shipping_options[0].id }, who)
      const pc = await api.post('/store/payment-collections', { cart_id: cartId }, who)
      await api.post(
        `/store/payment-collections/${pc.data.payment_collection.id}/payment-sessions`,
        { provider_id: 'pp_system_default' }, who)
      const done = await api.post(`/store/carts/${cartId}/complete`, {}, who)
      return done.data.order ?? done.data
    }

    const list = (qs = '') => api.get(`/admin/order-list${qs ? `?${qs}` : ''}`, admin)

    /** The register row for one order, found the way an operator would find it. */
    const rowFor = async (email: string) => {
      const res = await list(`q=${encodeURIComponent(email)}`)
      return res.data.orders.find((o: any) => o.email?.toLowerCase() === email.toLowerCase())
    }

    /**
     * The personalisation link is made by a subscriber, so it is not done when `complete`
     * returns. Polling rather than sleeping: a fixed sleep is either flaky or slow.
     */
    const eventually = async <T>(
      get: () => Promise<T>, ready: (v: T) => boolean, timeoutMs = 15_000
    ): Promise<T> => {
      const deadline = Date.now() + timeoutMs
      let last = await get()
      while (!ready(last) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 150))
        last = await get()
      }
      return last
    }

    describe('payment, derived from the collection', () => {
      it('resolves — and reports authorized for a system-provider order', async () => {
        const email = `pay-${Date.now()}@example.com`
        await buy({ email })
        const row = await rowFor(email)

        expect(row).toBeTruthy()
        /**
         * `authorized`, not `paid`, and that is correct rather than a shortfall.
         *
         * `@medusajs/payment`'s system provider authorises and does not capture, so the
         * collection lands on `authorized` and the money is not taken until something
         * captures it. Stripe's provider captures on confirm, so a real order reads `paid`.
         *
         * The assertion that carries the weight is the second one. `not_paid` is the
         * default on the column and is exactly what a failed resolution would produce —
         * silently, and on the screen a bookkeeper reads.
         */
        expect(row.payment).toBe('authorized')
        expect(row.payment).not.toBe('not_paid')
      })

      it('agrees with the status the database actually stored', async () => {
        // The derivation is only trustworthy if it is not quietly inventing a state. This
        // reads the collection the way nothing in src/orders.ts does and compares.
        const email = `paycheck-${Date.now()}@example.com`
        const order = await buy({ email })

        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: 'order',
          fields: ['id', 'payment_collections.*'],
          filters: { id: order.id },
        })
        const stored = (data[0]?.payment_collections ?? []).map((c: any) => c.status)

        expect(stored).toContain('authorized')
        expect(await rowFor(email).then((r: any) => r.payment)).toBe('authorized')
      })
    })

    describe('fulfilment, derived from the fulfilments', () => {
      it('is unfulfilled while nothing has been packed', async () => {
        const email = `unfulfilled-${Date.now()}@example.com`
        await buy({ email })
        expect((await rowFor(email)).fulfilment).toBe('unfulfilled')
      })

      it('follows the parcel: fulfilled, then shipped, then delivered', async () => {
        const email = `parcel-${Date.now()}@example.com`
        const order = await buy({ email })

        const items = order.items.map((i: any) => ({ id: i.id, quantity: i.quantity }))
        await api.post(`/admin/orders/${order.id}/fulfillments`, { items }, admin)

        // A parcel exists and is sitting on the bench.
        expect((await rowFor(email)).fulfilment).toBe('fulfilled')

        /**
         * The fulfilment id comes from a fresh read, not from the create response.
         *
         * `POST /admin/orders/:id/fulfillments` answers with the order under that route's
         * own field config, and `fulfillments` is not in it — so the response has no id to
         * follow, and reading one off it gets `undefined` rather than an error.
         */
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: fetched } = await query.graph({
          entity: 'order',
          fields: ['id', 'fulfillments.id'],
          filters: { id: order.id },
        })
        const fid = fetched[0].fulfillments.at(-1).id
        await api.post(`/admin/orders/${order.id}/fulfillments/${fid}/shipments`,
          { items }, admin)
        expect((await rowFor(email)).fulfilment).toBe('shipped')

        await api.post(
          `/admin/orders/${order.id}/fulfillments/${fid}/mark-as-delivered`, {}, admin)
        // Delivered outranks shipped deliberately: a delivered parcel is a closed case.
        expect((await rowFor(email)).fulfilment).toBe('delivered')
      })

      it('filters on it, so a picking list is one request', async () => {
        const email = `picklist-${Date.now()}@example.com`
        await buy({ email })

        const res = await list('fulfilment=unfulfilled&limit=200')
        expect(res.data.orders.length).toBeGreaterThan(0)
        for (const o of res.data.orders) expect(o.fulfilment).toBe('unfulfilled')
        expect(res.data.orders.some((o: any) => o.email === email)).toBe(true)
      })
    })

    describe('the money, broken out', () => {
      it('reconciles: subtotal + shipping + tax − discount = total', async () => {
        // The whole reason the columns are split. If these do not add up, the export is
        // worse than no export — it is a month that has to be redone by hand.
        const email = `money-${Date.now()}@example.com`
        const order = await buy({ email, quantity: 2 })
        const row = await rowFor(email)

        const sum = row.subtotal + row.shipping_total + row.tax_total - row.discount_total
        expect(sum).toBeCloseTo(row.total, 2)
        expect(row.total).toBeCloseTo(Number(order.total), 2)
        expect(row.shipping_total).toBeGreaterThan(0)
        expect(row.currency_code).toBe('usd')
        expect(row.items).toBe(2)
      })

      it('adds the revenue up across the selection', async () => {
        /**
         * Every test builds the orders it counts.
         *
         * The runner truncates between tests — measured, not assumed: an order created in
         * one test is gone by the next, and `/admin/orders` agrees with the register on
         * that at every step. So a test that asserts on "the orders that exist" is really
         * asserting on the ones it made itself, and one that expects to find its
         * neighbours' will read 0 and look like a broken endpoint.
         */
        const first = await buy({ email: `rev-a-${Date.now()}@example.com` })
        const second = await buy({ email: `rev-b-${Date.now()}@example.com` })

        const res = await list('limit=200')
        expect(res.data.summary.orders).toBe(2)
        expect(res.data.summary.currency_code).toBe('usd')
        expect(res.data.summary.revenue)
          .toBeCloseTo(Number(first.total) + Number(second.total), 2)
        // The null-across-currencies guard is unit-tested: a second currency is not
        // something to introduce into a shop that has one just to reach a branch.
      })

      it('summarises the selection rather than the page', async () => {
        const stamp = Date.now()
        await buy({ email: `summary-a-${stamp}@example.com` })
        await buy({ email: `summary-b-${stamp}@example.com` })

        const res = await list('limit=1')
        expect(res.data.orders).toHaveLength(1)
        // An operator who filtered to a state is asking what that state is worth, not what
        // the first row of it is worth.
        expect(res.data.summary.orders).toBe(2)
        expect(res.data.summary.items).toBe(2)
        expect(res.data.count).toBe(2)
      })
    })

    describe('personalisation, on the row', () => {
      it('counts what is on the order and how much of it blocks printing', async () => {
        const email = `pers-${Date.now()}@example.com`
        await buy({ email, personalise: true })

        // A bundle is a name and a number: two rows, both pending until a human approves.
        const row = await eventually(
          () => rowFor(email),
          (r: any) => !!r && r.personalisations === 2,
        )
        expect(row.personalisations).toBe(2)
        expect(row.personalisations_pending).toBe(2)
      })

      it('filters to the orders that cannot be printed yet', async () => {
        const email = `approve-${Date.now()}@example.com`
        const plain = `plain-${Date.now()}@example.com`
        await buy({ email, personalise: true })
        await buy({ email: plain })

        const res = await eventually(
          () => list('needs_approval=true&limit=200'),
          (r: any) => r.data.orders.some((o: any) => o.email === email),
        )
        expect(res.data.orders.some((o: any) => o.email === email)).toBe(true)
        expect(res.data.orders.some((o: any) => o.email === plain)).toBe(false)
        for (const o of res.data.orders) expect(o.personalisations_pending).toBeGreaterThan(0)
        expect(res.data.summary.needs_approval).toBeGreaterThan(0)
      })
    })

    describe('finding an order', () => {
      it('searches the products in it, not only the customer', async () => {
        // How somebody answers "who bought the shirt we have to recall".
        const email = `bytitle-${Date.now()}@example.com`
        const order = await buy({ email })
        const title = order.items[0].title

        const res = await list(`q=${encodeURIComponent(title)}&limit=200`)
        expect(res.data.orders.some((o: any) => o.email === email)).toBe(true)
      })

      it('carries the address the parcel needs', async () => {
        const email = `addr-${Date.now()}@example.com`
        await buy({ email })
        const row = await rowFor(email)

        expect(row.customer_name).toBe('Norby Krenik')
        expect(row.city).toBe('Lake Hiawatha')
        expect(row.postal_code).toBe('07034')
        expect(row.country_code).toBe('us')
        expect(row.has_account).toBe(false)
      })

      it('bounds the period when asked, without dropping today', async () => {
        const email = `recent-${Date.now()}@example.com`
        await buy({ email })

        const week = await list('days=7&limit=200')
        expect(week.data.orders.some((o: any) => o.email === email)).toBe(true)
      })
    })

    describe('the register CSV', () => {
      const download = (qs = '') =>
        api.get(`/admin/order-list/export${qs ? `?${qs}` : ''}`, admin)

      it('is served as a download, and never cached', async () => {
        const res = await download()
        expect(res.headers['content-type']).toContain('text/csv')
        expect(res.headers['content-disposition']).toMatch(/attachment; filename="orders-/)
        // A file of customer records must not sit in a proxy cache.
        expect(res.headers['cache-control']).toContain('no-store')
      })

      it('starts with a UTF-8 BOM on the wire', async () => {
        // Read as bytes: axios strips a leading BOM from a text response, so asserting on
        // the parsed body tests axios. Without the BOM, Excel reads UTF-8 as Latin-1.
        const res = await api.get('/admin/order-list/export',
          { ...admin, responseType: 'arraybuffer' })
        expect([...Buffer.from(res.data).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
      })

      it('has one row per order, with the money in separate columns', async () => {
        const email = `csv-${Date.now()}@example.com`
        const order = await buy({ email, quantity: 2 })

        const body = String((await download(`q=${email}`)).data)
        const rows = body.split('\r\n').filter(Boolean)
        const header = rows[0]

        for (const column of ['Order', 'Payment', 'Fulfilment', 'Subtotal', 'Discount',
                              'Shipping', 'Tax', 'Total', 'Awaiting approval', 'Postal code']) {
          expect(header).toContain(column)
        }
        // Two of the same shirt is still one order, and therefore one row.
        expect(rows).toHaveLength(2)
        expect(rows[1]).toContain(Number(order.total).toFixed(2))
        expect(rows[1]).toContain('authorized')
      })

      it('exports the selection, not everything', async () => {
        const stamp = Date.now()
        const email = `narrow-a-${stamp}@example.com`
        await buy({ email })
        await buy({ email: `narrow-b-${stamp}@example.com` })

        const all = String((await download()).data).split('\r\n').filter(Boolean)
        const one = String((await download(`q=${email}`)).data).split('\r\n').filter(Boolean)

        expect(all).toHaveLength(3)   // header + both orders
        expect(one).toHaveLength(2)   // header + the one match
      })

      it('escapes a name that would otherwise execute in a spreadsheet', async () => {
        // The customer types their own delivery name, which makes this CSV a stored-
        // injection sink pointed at whoever opens the file.
        const email = `inject-${Date.now()}@example.com`
        await buy({ email, firstName: '=HYPERLINK("http://evil","click")' })

        const body = String((await download(`q=${email}`)).data)
        expect(body).toContain('HYPERLINK')
        for (const cell of body.split('\r\n').slice(1).flatMap((l) => l.split(','))) {
          expect(cell.replace(/^"/, '').startsWith('=')).toBe(false)
        }
      })
    })

    describe('the line-item CSV', () => {
      const download = (qs: string) =>
        api.get(`/admin/order-list/export?rows=items&${qs}`, admin)

      it('has one row per line, not one per order', async () => {
        const email = `lines-${Date.now()}@example.com`
        // A shirt and a personalisation bundle: two lines, one order.
        await buy({ email, personalise: true })

        const rows = String((await download(`q=${email}`)).data)
          .split('\r\n').filter(Boolean)
        expect(rows).toHaveLength(3)   // header + two lines
        expect(rows[0]).toContain('SKU')
        expect(rows[0]).toContain('Quantity')
      })

      it('omits the order-level money, so a line file cannot be summed for a month', async () => {
        // Summing a line file that repeated shipping on every row double-counts it. The
        // register is the file that reconciles; this one picks and packs.
        const email = `nomoney-${Date.now()}@example.com`
        await buy({ email })

        const header = String((await download(`q=${email}`)).data).split('\r\n')[0]
        expect(header).toContain('Line total')
        expect(header).not.toContain('Subtotal')
        expect(header).not.toContain('Shipping')
        expect(header).not.toContain('Tax')
      })

      it('carries what gets printed, on the line it gets printed on', async () => {
        const email = `print-${Date.now()}@example.com`
        await buy({ email, personalise: true })

        const body = await eventually(
          () => download(`q=${email}`).then((r: any) => String(r.data)),
          (b: string) => b.includes('name: ALLEN'),
        )
        /**
         * `ALLEN`, not `Allen`. The name is upper-cased at capture, because that is what
         * goes on the shirt — a print file is not the place to preserve the casing somebody
         * happened to type. Asserted in the exported shape rather than assumed, since this
         * file is what a printer works from.
         */
        expect(body).toContain('name: ALLEN')
        expect(body).toContain('number: 17')
      })

      it('has a filename that says which shape it is', async () => {
        const res = await download('limit=1')
        expect(res.headers['content-disposition']).toMatch(/filename="orders-items-/)
      })
    })

    describe('authorisation is declared', () => {
      // Enforcement is exercised in rbac.spec.ts, the only suite that runs with the flag
      // on. This asserts the endpoints exist and answer.
      it('serves the register to an authenticated admin', async () => {
        expect((await list()).status).toBe(200)
      })

      it('refuses an unauthenticated caller', async () => {
        const res = await api.get('/admin/order-list').catch(fail)
        expect(res.status).toBe(401)
      })
    })
  },
})
