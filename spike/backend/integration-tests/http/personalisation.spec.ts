import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { adminHeaders, seedWorld, storeHeaders, type World } from './fixtures'
import { CATALOG_MODULE } from '../../src/modules/catalog'
import { LINE_REF_KEY } from '../../src/api/store/personalisation/attach/route'

jest.setTimeout(180 * 1000)

/**
 * The personalisation money path, end to end.
 *
 * The unit tests cover pricing and validation as pure functions. What they cannot cover is
 * the part that actually takes money: the add-on line, the price the pricing engine puts on
 * it, and whether the server refuses a request whose cart does not match it. That last one
 * is the whole reason `attach` re-validates — the client's validation counts for nothing,
 * because a browser can call the endpoint directly.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let world: World
    let headers: Record<string, string>
    let admin: { headers: Record<string, string> }

    beforeAll(async () => {
      world = await seedWorld(getContainer())
      headers = { 'x-publishable-api-key': world.publishableKey }
      admin = await adminHeaders(getContainer(), api)
    })

    const newCart = async () => {
      const res = await api.post('/store/carts', { region_id: world.regionId }, { headers })
      return res.data.cart.id
    }
    const addLine = async (cartId: string, variantId: string) => {
      const res = await api.post(
        `/store/carts/${cartId}/line-items`,
        { variant_id: variantId, quantity: 1 },
        { headers }
      )
      return res.data.cart
    }
    const lineFor = (cart: any, variantId: string) =>
      (cart.items ?? []).find((i: any) => i.variant_id === variantId)

    describe('the offer', () => {
      it('is eligible for a reviewed jersey with a known team', async () => {
        const res = await api.get(
          `/store/personalisation?product_id=${world.productId}`, { headers }
        )
        expect(res.data.eligible).toBe(true)
        expect(res.data.reason).toBeNull()
      })

      it('quotes "from" over what is offered, not over the price table', async () => {
        const res = await api.get(
          `/store/personalisation?product_id=${world.productId}`, { headers }
        )
        // No PATCHES_NFL configured, so the $7.99 patch is not purchasable and must not be
        // the advertised floor.
        expect(res.data.patches).toEqual([])
        expect(res.data.from).toBe(999)
      })

      it('ships the non-returnable disclosure with the offer', async () => {
        const res = await api.get(
          `/store/personalisation?product_id=${world.productId}`, { headers }
        )
        // §7: the exclusion only holds if it is disclosed before purchase, so it travels
        // with the offer rather than being left to the storefront to remember.
        expect(res.data.notice.non_returnable).toMatch(/can’t be returned/i)
        expect(res.data.notice.lead_time).toBeTruthy()
      })

      it('404s an unknown product', async () => {
        const res = await api.get('/store/personalisation?product_id=prod_nope', {
          headers, validateStatus: () => true,
        })
        expect(res.status).toBe(404)
      })
    })

    describe('validation over HTTP', () => {
      const check = (body: Record<string, unknown>) =>
        api.post('/store/personalisation', { product_id: world.productId, ...body },
          { headers, validateStatus: () => true })

      it('normalises and prices a bundle', async () => {
        const res = await check({ name: 'Mbappé', number: '10' })
        expect(res.data.ok).toBe(true)
        expect(res.data.normalised.name).toBe('MBAPPE')
        expect(res.data.total).toBe(1999)
        expect(res.data.lines.map((l: any) => l.kind)).toEqual(['bundle'])
      })

      it('refuses a blocked name and does not price it', async () => {
        const res = await check({ name: 'Hitler', number: '9' })
        expect(res.data.ok).toBe(false)
        expect(res.data.normalised.name).toBeNull()
        // The valid half is still priced; the refused half is not.
        expect(res.data.total).toBe(999)
      })

      it('answers 200 for an invalid keystroke, not an error status', async () => {
        // This is called as the customer types. A 422 makes an ordinary keystroke look
        // like a client failure.
        const res = await check({ number: '07' })
        expect(res.status).toBe(200)
        expect(res.data.ok).toBe(false)
      })
    })

    describe('attaching to a cart', () => {
      it('records what will be printed, and leaves it pending', async () => {
        const cartId = await newCart()
        let cart = await addLine(cartId, world.variantIds[0])
        cart = await addLine(cartId, world.addonVariantIds.BUNDLE)

        const res = await api.post('/store/personalisation/attach', {
          cart_id: cartId,
          line_id: lineFor(cart, world.variantIds[0]).id,
          addon_line_id: lineFor(cart, world.addonVariantIds.BUNDLE).id,
          product_id: world.productId,
          name: 'Allen',
          number: '17',
        }, { headers })

        expect(res.status).toBe(200)
        expect(res.data.total).toBe(1999)
        // Nothing prints without a human (spec §6).
        expect(res.data.review_status).toBe('pending')

        const kinds = res.data.personalisations.map((p: any) => p.kind).sort()
        // A bundle is a price, not something that goes on a shirt: two rows, not one.
        expect(kinds).toEqual(['name', 'number'])
        const total = res.data.personalisations.reduce((t: number, p: any) => t + p.price, 0)
        expect(total).toBe(1999)
      })

      it('stamps the typeface from the league at capture time', async () => {
        const cartId = await newCart()
        let cart = await addLine(cartId, world.variantIds[0])
        cart = await addLine(cartId, world.addonVariantIds.NAME)
        const res = await api.post('/store/personalisation/attach', {
          cart_id: cartId,
          line_id: lineFor(cart, world.variantIds[0]).id,
          addon_line_id: lineFor(cart, world.addonVariantIds.NAME).id,
          product_id: world.productId,
          name: 'Allen',
        }, { headers })
        // The fixture product is NFL, so a later change to the league table cannot rewrite
        // what this order prints.
        expect(res.data.personalisations[0].typeface).toBe('nfl-block')
      })

      it('refuses when the cart holds a cheaper tier than the request', async () => {
        // The attack this closes: add the $9.99 number variant, then ask for a name AND a
        // number, and get $19.99 of printing for $9.99.
        const cartId = await newCart()
        let cart = await addLine(cartId, world.variantIds[0])
        cart = await addLine(cartId, world.addonVariantIds.NUMBER)
        const res = await api.post('/store/personalisation/attach', {
          cart_id: cartId,
          line_id: lineFor(cart, world.variantIds[0]).id,
          addon_line_id: lineFor(cart, world.addonVariantIds.NUMBER).id,
          product_id: world.productId,
          name: 'Allen',
          number: '17',
        }, { headers, validateStatus: () => true })

        expect(res.status).toBe(409)
        expect(res.data.expected).toBe(1999)
        expect(res.data.found).toBe(999)
      })

      it('re-validates server-side and refuses a blocked name', async () => {
        const cartId = await newCart()
        let cart = await addLine(cartId, world.variantIds[0])
        cart = await addLine(cartId, world.addonVariantIds.NAME)
        const res = await api.post('/store/personalisation/attach', {
          cart_id: cartId,
          line_id: lineFor(cart, world.variantIds[0]).id,
          addon_line_id: lineFor(cart, world.addonVariantIds.NAME).id,
          product_id: world.productId,
          name: 'Hitler',
        }, { headers, validateStatus: () => true })
        // The client already validated. That counts for nothing here.
        expect(res.status).toBe(422)
        expect(res.data.errors[0].field).toBe('name')
      })

      it('refuses without the add-on line, so printing is never free', async () => {
        const cartId = await newCart()
        const cart = await addLine(cartId, world.variantIds[0])
        const res = await api.post('/store/personalisation/attach', {
          cart_id: cartId,
          line_id: lineFor(cart, world.variantIds[0]).id,
          product_id: world.productId,
          name: 'Allen',
        }, { headers, validateStatus: () => true })
        expect(res.status).toBe(400)
      })

      it('refuses a line that belongs to another cart', async () => {
        const mine = await newCart()
        const other = await newCart()
        const otherCart = await addLine(other, world.variantIds[0])
        const res = await api.post('/store/personalisation/attach', {
          cart_id: mine,
          line_id: lineFor(otherCart, world.variantIds[0]).id,
          addon_line_id: 'li_nope',
          product_id: world.productId,
          name: 'Allen',
        }, { headers, validateStatus: () => true })
        expect(res.status).toBe(404)
      })

      it('replaces rather than appends when a personalisation is edited', async () => {
        const cartId = await newCart()
        let cart = await addLine(cartId, world.variantIds[0])
        cart = await addLine(cartId, world.addonVariantIds.NAME)
        const lineId = lineFor(cart, world.variantIds[0]).id
        const addonId = lineFor(cart, world.addonVariantIds.NAME).id
        const body = {
          cart_id: cartId, line_id: lineId, addon_line_id: addonId,
          product_id: world.productId,
        }

        await api.post('/store/personalisation/attach', { ...body, name: 'Allen' }, { headers })
        await api.post('/store/personalisation/attach', { ...body, name: 'Diggs' }, { headers })

        const catalog: any = getContainer().resolve(CATALOG_MODULE)
        const rows = await catalog.listLinePersonalisations({ cart_line_id: lineId })
        // Appending would leave 'ALLEN' queued for print alongside 'DIGGS'.
        expect(rows).toHaveLength(1)
        expect(rows[0].value).toBe('DIGGS')
      })
    })

    /**
     * Surviving checkout.
     *
     * This is the block that would have caught the defect. Everything above proves the
     * personalisation is captured correctly against a *cart*; none of it noticed that a cart
     * line's id does not survive into the order, so `order_line_id` was written by nothing
     * and the print was unreachable from the paid order.
     *
     * The assertion that matters is the last one. The returns endpoint decides whether an
     * item is made-to-order by looking for personalisations with that `order_id` — and while
     * that query always came back empty, the storefront offered a refund on a printed shirt.
     */
    describe('surviving checkout', () => {
      /**
       * The link is made by a subscriber, so it is not done when `complete` returns.
       *
       * Polling rather than sleeping: a fixed sleep is either flaky or slow, and on a local
       * event bus the handler usually lands in well under a second. The timeout is what
       * fails the test if the subscriber never runs at all.
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

      /** A completed order through the system provider, so no Stripe key is needed. */
      const buyPersonalised = async (email: string, name = 'Allen', number = '17') => {
        const cartId = await newCart()
        await addLine(cartId, world.variantIds[0])
        const cart = await addLine(cartId, world.addonVariantIds.BUNDLE)

        await api.post('/store/personalisation/attach', {
          cart_id: cartId,
          line_id: lineFor(cart, world.variantIds[0]).id,
          addon_line_id: lineFor(cart, world.addonVariantIds.BUNDLE).id,
          product_id: world.productId,
          name, number,
        }, { headers })

        await api.post(`/store/carts/${cartId}`, {
          email,
          shipping_address: { first_name: 'P', last_name: 'T', address_1: '1 St',
            city: 'Dallas', province: 'TX', postal_code: '75201', country_code: 'us', phone: '+1 214 555 0142' },
        }, { headers })
        const opts = await api.get(`/store/shipping-options?cart_id=${cartId}`, { headers })
        await api.post(`/store/carts/${cartId}/shipping-methods`,
          { option_id: opts.data.shipping_options[0].id }, { headers })
        const pc = await api.post('/store/payment-collections', { cart_id: cartId }, { headers })
        await api.post(
          `/store/payment-collections/${pc.data.payment_collection.id}/payment-sessions`,
          { provider_id: 'pp_system_default' }, { headers })
        const done = await api.post(`/store/carts/${cartId}/complete`, {}, { headers })
        return { cartId, order: done.data.order }
      }

      it('stamps the cart line with a ref that checkout can carry', async () => {
        const cartId = await newCart()
        await addLine(cartId, world.variantIds[0])
        const cart = await addLine(cartId, world.addonVariantIds.BUNDLE)
        const lineId = lineFor(cart, world.variantIds[0]).id

        await api.post('/store/personalisation/attach', {
          cart_id: cartId, line_id: lineId,
          addon_line_id: lineFor(cart, world.addonVariantIds.BUNDLE).id,
          product_id: world.productId, name: 'Kelce', number: '87',
        }, { headers })

        const after = await api.get(`/store/carts/${cartId}`, { headers })
        const line = (after.data.cart.items ?? []).find((i: any) => i.id === lineId)
        // Metadata is the only field that crosses from cart line to order line intact.
        expect(typeof line.metadata?.[LINE_REF_KEY]).toBe('string')

        const catalog: any = getContainer().resolve(CATALOG_MODULE)
        const rows = await catalog.listLinePersonalisations({ cart_line_id: lineId })
        expect(rows.length).toBeGreaterThan(0)
        // Both sides hold the same ref, which is what makes the join possible.
        expect(new Set(rows.map((r: any) => r.line_ref)))
          .toEqual(new Set([line.metadata[LINE_REF_KEY]]))
      })

      it('keeps the ref across an edit rather than churning it', async () => {
        const cartId = await newCart()
        await addLine(cartId, world.variantIds[0])
        const cart = await addLine(cartId, world.addonVariantIds.BUNDLE)
        const lineId = lineFor(cart, world.variantIds[0]).id
        const attach = (name: string) => api.post('/store/personalisation/attach', {
          cart_id: cartId, line_id: lineId,
          addon_line_id: lineFor(cart, world.addonVariantIds.BUNDLE).id,
          product_id: world.productId, name, number: '9',
        }, { headers })

        await attach('Before')
        const first = await api.get(`/store/carts/${cartId}`, { headers })
        const ref1 = first.data.cart.items.find((i: any) => i.id === lineId)
          .metadata[LINE_REF_KEY]

        await attach('After')
        const second = await api.get(`/store/carts/${cartId}`, { headers })
        const ref2 = second.data.cart.items.find((i: any) => i.id === lineId)
          .metadata[LINE_REF_KEY]

        // An order placed between two edits still has to resolve, so the ref is stable.
        expect(ref2).toBe(ref1)
      })

      it('links the personalisation to the order line once the order is placed', async () => {
        const { order } = await buyPersonalised('printme@example.com', 'Mahomes', '15')

        const catalog: any = getContainer().resolve(CATALOG_MODULE)
        const rows = await eventually(
          () => catalog.listLinePersonalisations({ order_id: order.id }),
          (r: any[]) => r.length >= 2
        )

        expect(rows.length).toBe(2)          // name + number
        for (const r of rows) {
          expect(r.order_id).toBe(order.id)
          expect(r.order_line_id).toBeTruthy()
          // The cart line it came from is kept, not overwritten — it is the audit trail.
          expect(r.cart_line_id).toBeTruthy()
        }

        // It points at the shirt line, not the add-on line: the add-on is a price, the
        // shirt is the thing with a name printed on it.
        const full = await api.get(`/admin/orders/${order.id}?fields=*items`, admin)
        const shirt = full.data.order.items.find(
          (i: any) => i.variant_id === world.variantIds[0])
        expect(rows[0].order_line_id).toBe(shirt.id)
      })

      it('marks the personalised line non-returnable, which is what the defect broke',
        async () => {
          const email = 'noreturn@example.com'
          const { order } = await buyPersonalised(email, 'Kelce', '87')

          const catalog: any = getContainer().resolve(CATALOG_MODULE)
          await eventually(
            () => catalog.listLinePersonalisations({ order_id: order.id }),
            (r: any[]) => r.length > 0
          )

          const res = await api.get(
            `/store/return-requests?email=${email}&order_number=${order.display_id}`,
            storeHeaders(world))

          const full = await api.get(`/admin/orders/${order.id}?fields=*items`, admin)
          const shirtId = full.data.order.items.find(
            (i: any) => i.variant_id === world.variantIds[0]).id
          const line = res.data.items.find((i: any) => i.line_item_id === shirtId)

          // Made to specification. Before the link existed this came back eligible, and the
          // storefront offered a refund on a shirt with someone's name printed on it.
          expect(line.eligible).toBe(false)
          expect(line.reason).toMatch(/personalis/i)
        })

      it('leaves an unpersonalised order alone', async () => {
        // The join must not touch orders that carry no ref — and must not log an error for
        // them either, which is why the promotion returns early rather than querying.
        const cartId = await newCart()
        await addLine(cartId, world.variantIds[0])
        await api.post(`/store/carts/${cartId}`, {
          email: 'plain@example.com',
          shipping_address: { first_name: 'P', last_name: 'T', address_1: '1 St',
            city: 'Dallas', province: 'TX', postal_code: '75201', country_code: 'us', phone: '+1 214 555 0142' },
        }, { headers })
        const opts = await api.get(`/store/shipping-options?cart_id=${cartId}`, { headers })
        await api.post(`/store/carts/${cartId}/shipping-methods`,
          { option_id: opts.data.shipping_options[0].id }, { headers })
        const pc = await api.post('/store/payment-collections', { cart_id: cartId }, { headers })
        await api.post(
          `/store/payment-collections/${pc.data.payment_collection.id}/payment-sessions`,
          { provider_id: 'pp_system_default' }, { headers })
        const done = await api.post(`/store/carts/${cartId}/complete`, {}, { headers })

        // Given a second to do the wrong thing, and asserted that it did not.
        await new Promise((r) => setTimeout(r, 1000))
        const catalog: any = getContainer().resolve(CATALOG_MODULE)
        const rows = await catalog.listLinePersonalisations({ order_id: done.data.order.id })
        expect(rows).toHaveLength(0)
      })
    })

    describe('the admin queue', () => {
      let id: string

      beforeEach(async () => {
        const catalog: any = getContainer().resolve(CATALOG_MODULE)
        const [row] = await catalog.createLinePersonalisations([{
          cart_line_id: `li_${Date.now()}`,
          product_id: world.productId,
          kind: 'name', value: 'ALLEN', price: 1499,
          typeface: 'nfl-block', placement: 'back',
        }])
        id = row.id
      })

      it('lists pending work oldest first', async () => {
        const res = await api.get('/admin/personalisations?status=pending', admin)
        expect(res.status).toBe(200)
        const dates = res.data.personalisations.map((p: any) => new Date(p.created_at).getTime())
        // Newest-first starves the backlog, and the backlog is what holds up orders.
        expect([...dates].sort((a, b) => a - b)).toEqual(dates)
      })

      it('refuses to reject without a reason', async () => {
        const res = await api.post(`/admin/personalisations/${id}`, { action: 'reject' },
          { ...admin, validateStatus: () => true })
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/needs a reason/)
      })

      it('refuses an invented reason', async () => {
        const res = await api.post(`/admin/personalisations/${id}`,
          { action: 'reject', reason: 'i_did_not_like_it' },
          { ...admin, validateStatus: () => true })
        expect(res.status).toBe(400)
      })

      it('rejects with a reason and names the follow-up', async () => {
        const res = await api.post(`/admin/personalisations/${id}`,
          { action: 'reject', reason: 'trademark' }, admin)
        expect(res.data.personalisation.review_status).toBe('rejected')
        expect(res.data.personalisation.rejection_reason).toBe('trademark')
        // Refund and notification are separate steps, so a half-failed rejection cannot
        // leave the customer refunded but still queued.
        expect(res.data.next).toEqual(['refund_add_on', 'notify_customer'])
      })

      it('approves and records who did it', async () => {
        const res = await api.post(`/admin/personalisations/${id}`,
          { action: 'approve', reviewer: 'emil' }, admin)
        expect(res.data.personalisation.review_status).toBe('approved')
        expect(res.data.personalisation.reviewed_by).toBe('emil')
        expect(res.data.personalisation.reviewed_at).toBeTruthy()
      })

      it('clears a previous rejection reason on approval', async () => {
        await api.post(`/admin/personalisations/${id}`,
          { action: 'reject', reason: 'illegible' }, admin)
        const res = await api.post(`/admin/personalisations/${id}`, { action: 'approve' }, admin)
        // A rejection reason left on an approved row is a queue that lies about itself.
        expect(res.data.personalisation.rejection_reason).toBeNull()
      })

      it('404s an unknown id', async () => {
        const res = await api.post('/admin/personalisations/lp_nope', { action: 'approve' },
          { ...admin, validateStatus: () => true })
        expect(res.status).toBe(404)
      })
    })
  },
})
