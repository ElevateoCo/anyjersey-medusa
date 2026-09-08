import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { adminHeaders, seedWorld, storeHeaders, type World } from './fixtures'
import { __reset as resetRateLimits } from '../../src/rate-limit'

jest.setTimeout(180 * 1000)

/**
 * The customer list and its export, against a real database.
 *
 * The unit suite covers the parts that are pure — escaping, sorting, filtering. What it
 * cannot cover is the half that made this worth building: that spend and order counts are
 * assembled correctly across three modules, that a guest checkout produces a customer row at
 * all, and that marketing state reflects what the shop would actually send.
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

    /** One completed order, through the system provider, as its own shopper. */
    async function buy(email: string, quantity = 1) {
      const who = {
        headers: {
          ...storeHeaders(w).headers,
          'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '',
          'x-client-ip': `198.51.100.${shoppers++}`,
        },
      }
      const { data: created } = await api.post('/store/carts', {
        region_id: w.regionId, sales_channel_id: w.salesChannelId, email,
      }, who)
      const cartId = created.cart.id

      await api.post(`/store/carts/${cartId}/line-items`,
        { variant_id: w.variantIds[0], quantity }, who)
      await api.post(`/store/carts/${cartId}`, {
        shipping_address: {
          first_name: 'Norby', last_name: 'Krenik', address_1: '17 Nokomis Ave',
          city: 'Lake Hiawatha', province: 'New Jersey', postal_code: '07034',
          country_code: 'us', phone: '+1 718 902 1256',
        },
      }, who)

      const opts = await api.get(`/store/shipping-options?cart_id=${cartId}`, who)
      await api.post(`/store/carts/${cartId}/shipping-methods`,
        { option_id: opts.data.shipping_options[0].id }, who)
      const pc = await api.post('/store/payment-collections', { cart_id: cartId }, who)
      await api.post(
        `/store/payment-collections/${pc.data.payment_collection.id}/payment-sessions`,
        { provider_id: 'pp_system_default' }, who)
      const done = await api.post(`/store/carts/${cartId}/complete`, {}, who)
      return done.data.order ?? done.data
    }

    const list = (qs = '') =>
      api.get(`/admin/customer-list${qs ? `?${qs}` : ''}`, admin)

    const find = (rows: any[], email: string) =>
      rows.find((c: any) => c.email?.toLowerCase() === email.toLowerCase())

    describe('the list', () => {
      it('includes a guest checkout, and marks it as one', async () => {
        // The shop has no account requirement, so a list that only showed real accounts
        // would hide almost every buyer. This is the case that matters most.
        const email = `guest-${Date.now()}@example.com`
        await buy(email)

        const res = await list('limit=200')
        const row = find(res.data.customers, email)

        expect(row).toBeTruthy()
        expect(row.has_account).toBe(false)
        expect(row.orders).toBe(1)
      })

      it('sums what a customer has spent across their orders', async () => {
        const email = `repeat-${Date.now()}@example.com`
        const first = await buy(email)
        const second = await buy(email, 2)

        const res = await list('limit=200')
        const row = find(res.data.customers, email)

        expect(row.orders).toBe(2)
        // Against the orders themselves rather than a hardcoded price: the point is that the
        // aggregate matches the ledger, not that a jersey costs $64.99.
        const expected = Number(first.total) + Number(second.total)
        expect(row.amount_spent).toBeCloseTo(Math.round(expected * 100) / 100, 2)
        expect(row.currency_code).toBe('usd')
        expect(row.mixed_currency).toBe(false)
      })

      it('carries the delivery address and phone from the order', async () => {
        const email = `addr-${Date.now()}@example.com`
        await buy(email)

        const res = await list('limit=200')
        const row = find(res.data.customers, email)

        expect(row.city).toBe('Lake Hiawatha')
        expect(row.postal_code).toBe('07034')
        expect(row.country_code).toBe('us')
        expect(String(row.phone ?? '')).toContain('718')
      })

      it('records the most recent order, by number and date', async () => {
        const email = `latest-${Date.now()}@example.com`
        await buy(email)
        const second = await buy(email)

        const res = await list('limit=200')
        const row = find(res.data.customers, email)
        expect(row.last_order_display_id).toBe(String(second.display_id))
      })

      it('searches by email, name, city and order number', async () => {
        const email = `findme-${Date.now()}@example.com`
        const order = await buy(email)

        expect(find((await list(`q=${email}&limit=200`)).data.customers, email)).toBeTruthy()
        expect(find((await list(`q=Krenik&limit=200`)).data.customers, email)).toBeTruthy()
        expect(
          find((await list(`q=${order.display_id}&limit=200`)).data.customers, email)
        ).toBeTruthy()
      })

      it('sorts by spend, highest first', async () => {
        const big = `big-${Date.now()}@example.com`
        await buy(big, 5)

        const res = await list('sort=amount_spent&limit=200')
        const spends = res.data.customers
          .map((c: any) => c.amount_spent)
          .filter((v: number | null) => v !== null)
        expect(spends).toEqual([...spends].sort((a: number, b: number) => b - a))
      })

      it('pages, and reports the full count rather than the page size', async () => {
        // Creates its own two customers rather than relying on the ones other tests left
        // behind. The runner keeps data across a file, so borrowing works — until somebody
        // runs this test alone and it fails against an empty base for no visible reason.
        const stamp = Date.now()
        await buy(`page-a-${stamp}@example.com`)
        await buy(`page-b-${stamp}@example.com`)

        const first = await list('limit=1')
        expect(first.data.customers).toHaveLength(1)
        expect(first.data.count).toBeGreaterThan(1)

        const second = await list('limit=1&offset=1')
        expect(second.data.customers).toHaveLength(1)
        expect(second.data.customers[0].id).not.toBe(first.data.customers[0].id)
        // The count describes the base, not the page.
        expect(second.data.count).toBe(first.data.count)
      })

      describe('marketing state', () => {
        it('is a soft opt-in for somebody who only ever checked out', async () => {
          // PECR reg. 22(3): the address came from a sale, which is the basis the
          // cart-recovery email rests on — and the only commercial message they get.
          const email = `implied-${Date.now()}@example.com`
          await buy(email)

          const row = find((await list('limit=200')).data.customers, email)
          expect(row.marketing).toBe('implied')
        })

        it('is subscribed after a newsletter signup', async () => {
          const email = `news-${Date.now()}@example.com`
          await buy(email)
          await api.post('/store/newsletter', { email }, storeHeaders(w))

          const row = find((await list('limit=200')).data.customers, email)
          expect(row.marketing).toBe('subscribed')
        })

        it('is unsubscribed once they refuse, whatever they signed up to', async () => {
          // Suppression is marketing-wide by design, so one refusal has to be visible here
          // regardless of which list it came from.
          const email = `gone-${Date.now()}@example.com`
          await buy(email)
          await api.post('/store/newsletter', { email }, storeHeaders(w))

          const catalog: any = getContainer().resolve('catalog')
          const rows = await catalog.listInboundMessages({ email }, { take: 10 })
          await catalog.updateInboundMessages(
            rows.map((r: any) => ({ id: r.id, unsubscribed_at: new Date() }))
          )

          const row = find((await list('limit=200')).data.customers, email)
          expect(row.marketing).toBe('unsubscribed')
        })

        it('filters on it', async () => {
          const res = await list('marketing=unsubscribed&limit=200')
          expect(res.data.customers.every((c: any) => c.marketing === 'unsubscribed')).toBe(true)
        })
      })
    })

    describe('CSV export', () => {
      const download = (qs = '') =>
        api.get(`/admin/customer-list/export${qs ? `?${qs}` : ''}`, admin)

      it('is served as a downloadable CSV, not as JSON', async () => {
        const res = await download()
        expect(res.headers['content-type']).toContain('text/csv')
        expect(res.headers['content-disposition']).toMatch(/attachment; filename="customers-/)
        // A file of customer records must not sit in a proxy cache.
        expect(res.headers['cache-control']).toContain('no-store')
      })

      it('starts with a UTF-8 BOM on the wire', async () => {
        /**
         * Read as bytes, deliberately.
         *
         * Axios strips a leading BOM from a text response (`utils.stripBOM`), so asserting
         * `charCodeAt(0)` on the parsed body tests axios and not this endpoint — the first
         * version of this test did exactly that and failed against a server that was sending
         * the BOM correctly. The bytes are the only honest place to check.
         *
         * It matters because Excel opens a UTF-8 CSV without one as Latin-1, and every
         * accented name arrives as mojibake.
         */
        const res = await api.get('/admin/customer-list/export',
          { ...admin, responseType: 'arraybuffer' })
        const bytes = Buffer.from(res.data)
        expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
      })

      it('has a header row naming every column', async () => {
        const header = String((await download()).data).split('\r\n')[0]
        expect(header).toContain('Email')
        expect(header).toContain('Amount spent')
        expect(header).toContain('Postal code')
      })

      it('contains a real customer with their spend', async () => {
        const email = `csv-${Date.now()}@example.com`
        const order = await buy(email)

        const body = String((await download(`q=${email}`)).data)
        const line = body.split('\r\n').find((l) => l.includes(email))

        expect(line).toBeTruthy()
        expect(line).toContain(Number(order.total).toFixed(2))
        expect(line).toContain('Lake Hiawatha')
      })

      it('exports the selection, not everything', async () => {
        // The data-minimisation half of this: narrowing the screen has to narrow the file,
        // or an operator looking for one person walks away with the whole base.
        const email = `narrow-${Date.now()}@example.com`
        await buy(email)

        const all = String((await download()).data).split('\r\n').length
        const one = String((await download(`q=${email}`)).data).split('\r\n')

        expect(one.filter(Boolean)).toHaveLength(2)  // header + the one match
        expect(all).toBeGreaterThan(2)
      })

      it('escapes a name that would otherwise execute in a spreadsheet', async () => {
        // The storefront lets a customer choose their own name, which makes the CSV a
        // stored-injection sink pointed at whoever opens the file.
        const email = `inject-${Date.now()}@example.com`
        await api.post('/store/newsletter', { email }, storeHeaders(w))
        await api.post('/store/contact', {
          email, name: '=HYPERLINK("http://evil","click")',
          subject: 'Hello', body: 'A message long enough to pass validation.',
        }, storeHeaders(w))
        await buy(email)

        const body = String((await download(`q=${email}`)).data)
        // Whatever cell it lands in, it must not begin a formula.
        for (const cell of body.split('\r\n').slice(1).flatMap((l) => l.split(','))) {
          expect(cell.replace(/^"/, '').startsWith('=')).toBe(false)
        }
      })
    })

    describe('authorisation is declared', () => {
      // Enforcement itself is exercised in rbac.spec.ts, which is the only suite that runs
      // with the feature flag on. This asserts the endpoints exist and answer.
      it('serves the list to an authenticated admin', async () => {
        expect((await list()).status).toBe(200)
      })

      it('refuses an unauthenticated caller', async () => {
        const res = await api.get('/admin/customer-list').catch(fail)
        expect(res.status).toBe(401)
      })
    })
  },
})
