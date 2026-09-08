import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { seedWorld, storeHeaders, adminHeaders, type World } from './fixtures'
import { __reset as resetRateLimits } from '../../src/rate-limit'

jest.setTimeout(180 * 1000)

/**
 * Reviews and jersey requests.
 *
 * These are the endpoints where the legal shape matters more than the feature. The FTC
 * Consumer Reviews and Testimonials Rule carries $51,744 per violation, so the guarantees
 * asserted here are: verified status cannot be claimed, rejection cannot be done on
 * sentiment, and the published aggregate cannot disagree with the published reviews.
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
     * Both public writers here are rate limited per IP, and every test in this file arrives
     * from the same one. Without this the ninth review submission of the run gets a 429 and
     * a suite about the FTC review rule starts failing on throughput instead.
     *
     * Cleared rather than raised: a budget wide enough for a test run is not a budget. The
     * limit itself is asserted in its own test below, so resetting here neutralises the
     * limiter for the tests that are about something else without leaving it uncovered.
     */
    beforeEach(() => resetRateLimits())

    const review = (over: Record<string, unknown> = {}) => ({
      product_id: w.productId,
      rating: 5,
      body: 'Fits well and the print looks clean. Wore it to the game.',
      author_name: 'A Reviewer',
      email: `rev-${Math.round(Number(process.hrtime.bigint() % 100000n))}@example.com`,
      ...over,
    })

    async function buyAs(email: string) {
      const { data } = await api.post('/store/carts', {
        region_id: w.regionId, sales_channel_id: w.salesChannelId, email,
      }, storeHeaders(w))
      const id = data.cart.id
      await api.post(`/store/carts/${id}/line-items`,
        { variant_id: w.variantIds[0], quantity: 1 }, storeHeaders(w))
      await api.post(`/store/carts/${id}`, {
        shipping_address: { first_name: 'T', last_name: 'B', address_1: '1 St',
          city: 'Dallas', province: 'TX', postal_code: '75201', country_code: 'us', phone: '+1 214 555 0142' },
      }, storeHeaders(w))
      const opts = await api.get(`/store/shipping-options?cart_id=${id}`, storeHeaders(w))
      await api.post(`/store/carts/${id}/shipping-methods`,
        { option_id: opts.data.shipping_options[0].id }, storeHeaders(w))
      const pc = await api.post('/store/payment-collections', { cart_id: id }, storeHeaders(w))
      await api.post(
        `/store/payment-collections/${pc.data.payment_collection.id}/payment-sessions`,
        { provider_id: 'pp_system_default' }, storeHeaders(w))
      return api.post(`/store/carts/${id}/complete`, {}, storeHeaders(w))
    }

    describe('review submission', () => {
      it('derives verified_purchase from real order history', async () => {
        const email = 'realbuyer@example.com'
        await buyAs(email)
        const res = await api.post('/store/reviews', review({ email }), storeHeaders(w))
        expect(res.status).toBe(201)
        expect(res.data.verified_purchase).toBe(true)
      })

      it('does not verify someone with no order', async () => {
        const res = await api.post('/store/reviews',
          review({ email: 'nobuyer@example.com' }), storeHeaders(w))
        expect(res.data.verified_purchase).toBe(false)
      })

      it('ignores a client claiming to be verified', async () => {
        // A badge the submitter can set is exactly what the FTC rule prohibits.
        const res = await api.post('/store/reviews',
          review({ email: 'liar@example.com', verified_purchase: true }), storeHeaders(w))
        expect(res.data.verified_purchase).toBe(false)
      })

      it('lands pending, never published on submission', async () => {
        const res = await api.post('/store/reviews',
          review({ email: 'pending@example.com' }), storeHeaders(w))
        expect(res.data.status).toBe('pending')
      })

      it('rejects an out-of-range rating', async () => {
        for (const rating of [0, 6, -1, 99]) {
          const res = await api.post('/store/reviews',
            review({ rating, email: `r${rating}@example.com` }), storeHeaders(w))
            .catch((e: any) => e.response)
          expect(res.status).toBe(400)
        }
      })

      it('rejects a body that says nothing', async () => {
        const res = await api.post('/store/reviews',
          review({ body: 'ok', email: 'short@example.com' }), storeHeaders(w))
          .catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })

      it('rejects a malformed email', async () => {
        const res = await api.post('/store/reviews',
          review({ email: 'not-an-email' }), storeHeaders(w)).catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })

      it('allows one review per email per product', async () => {
        const email = 'once@example.com'
        const first = await api.post('/store/reviews', review({ email }), storeHeaders(w))
        expect(first.status).toBe(201)
        const second = await api.post('/store/reviews',
          review({ email, body: 'Trying again with different words entirely.' }),
          storeHeaders(w)).catch((e: any) => e.response)
        expect(second.status).toBe(409)
      })
    })

    describe('publication', () => {
      it('publishes nothing until it is approved', async () => {
        await api.post('/store/reviews',
          review({ email: 'unapproved@example.com' }), storeHeaders(w))
        const res = await api.get(
          `/store/reviews?product_id=${w.productId}`, storeHeaders(w)
        )
        expect(res.data.reviews.every((r: any) => r.id)).toBe(true)
        // whatever is visible must be approved, and the aggregate must match it
        expect(res.data.count).toBe(res.data.reviews.length)
      })

      it('computes the aggregate from exactly the published set', async () => {
        // The reference store shows 137,135 reviews on its homepage and 8,342 on its
        // product page. That mismatch is impossible here by construction.
        const email = 'agg@example.com'
        await api.post('/store/reviews',
          review({ email, rating: 3 }), storeHeaders(w))
        const queue = await api.get('/admin/reviews?status=pending', admin)
        const mine = queue.data.reviews.find((r: any) => r.email === email)
        await api.post(`/admin/reviews/${mine.id}`, { status: 'approved' }, admin)

        const res = await api.get(`/store/reviews?product_id=${w.productId}`, storeHeaders(w))
        expect(res.data.count).toBe(res.data.reviews.length)
        const mean = res.data.reviews.reduce((n: number, r: any) => n + r.rating, 0)
          / res.data.reviews.length
        expect(Math.abs(res.data.average - mean)).toBeLessThan(0.06)
      })

      it('never exposes reviewer email addresses', async () => {
        const res = await api.get(`/store/reviews?product_id=${w.productId}`, storeHeaders(w))
        expect(JSON.stringify(res.data)).not.toContain('@example.com')
      })

      it('discloses how reviews are verified', async () => {
        // Omnibus requires saying whether and how verification happens.
        const res = await api.get(`/store/reviews?product_id=${w.productId}`, storeHeaders(w))
        expect(res.data.verification_note).toMatch(/verified/i)
      })

      it('requires a product_id', async () => {
        const res = await api.get('/store/reviews', storeHeaders(w))
          .catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })
    })

    describe('moderation', () => {
      it('refuses to reject without a policy reason', async () => {
        // Suppressing negative reviews is named in the FTC rule, and a bare reject button
        // is the mechanism for doing it.
        await api.post('/store/reviews', review({ email: 'mod1@example.com', rating: 1 }),
          storeHeaders(w))
        const queue = await api.get('/admin/reviews?status=pending', admin)
        const target = queue.data.reviews.find((r: any) => r.email === 'mod1@example.com')

        const bare = await api.post(`/admin/reviews/${target.id}`,
          { status: 'rejected' }, admin).catch((e: any) => e.response)
        expect(bare.status).toBe(400)
        expect(bare.data.message).toMatch(/policy reason/i)
      })

      it('accepts a rejection that names a reason', async () => {
        await api.post('/store/reviews', review({ email: 'mod2@example.com' }), storeHeaders(w))
        const queue = await api.get('/admin/reviews?status=pending', admin)
        const target = queue.data.reviews.find((r: any) => r.email === 'mod2@example.com')
        const res = await api.post(`/admin/reviews/${target.id}`,
          { status: 'rejected', rejection_reason: 'spam' }, admin)
        expect(res.status).toBe(200)
        expect(res.data.review.status).toBe('rejected')
        expect(res.data.review.rejection_reason).toBe('spam')
      })

      it('refuses an invented rejection reason', async () => {
        await api.post('/store/reviews', review({ email: 'mod3@example.com' }), storeHeaders(w))
        const queue = await api.get('/admin/reviews?status=pending', admin)
        const target = queue.data.reviews.find((r: any) => r.email === 'mod3@example.com')
        const res = await api.post(`/admin/reviews/${target.id}`,
          { status: 'rejected', rejection_reason: 'i_did_not_like_it' }, admin)
          .catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })

      it('keeps a rejected review out of the storefront', async () => {
        const before = await api.get(
          `/store/reviews?product_id=${w.productId}`, storeHeaders(w))
        await api.post('/store/reviews', review({ email: 'mod4@example.com' }), storeHeaders(w))
        const queue = await api.get('/admin/reviews?status=pending', admin)
        const target = queue.data.reviews.find((r: any) => r.email === 'mod4@example.com')
        await api.post(`/admin/reviews/${target.id}`,
          { status: 'rejected', rejection_reason: 'off_topic' }, admin)
        const after = await api.get(
          `/store/reviews?product_id=${w.productId}`, storeHeaders(w))
        expect(after.data.count).toBe(before.data.count)
      })
    })

    describe('jersey requests', () => {
      it('captures a request and parses what it can', async () => {
        const res = await api.post('/store/jersey-requests', {
          email: 'wants@example.com',
          raw_request: '1998 Vikings Randy Moss purple, XL',
          team: 'Minnesota Vikings', player: 'Randy Moss', size_code: 'XL',
          source: 'product',
        }, storeHeaders(w))
        expect(res.status).toBe(201)
        expect(res.data.status).toBe('new')
      })

      it('requires a usable email', async () => {
        const res = await api.post('/store/jersey-requests',
          { email: 'nope', raw_request: 'something' }, storeHeaders(w))
          .catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })

      it('requires an actual request', async () => {
        const res = await api.post('/store/jersey-requests',
          { email: 'a@b.co', raw_request: 'x' }, storeHeaders(w))
          .catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })

      it('ranks demand rather than arrival order', async () => {
        for (let i = 0; i < 3; i++) {
          await api.post('/store/jersey-requests', {
            email: `fan${i}@example.com`, raw_request: `Kobe 2004 gold, attempt ${i}`,
            team: 'Los Angeles Lakers', player: 'Kobe Bryant', source: 'homepage',
          }, storeHeaders(w))
        }
        await api.post('/store/jersey-requests', {
          email: 'solo@example.com', raw_request: 'Some other shirt entirely',
          team: 'Chicago Bulls', player: 'Derrick Rose', source: 'homepage',
        }, storeHeaders(w))

        const res = await api.get('/admin/jersey-requests?status=new', admin)
        expect(res.data.demand[0].count).toBeGreaterThanOrEqual(3)
        expect(res.data.demand[0].player).toBe('Kobe Bryant')
      })

      it('moves a request through the queue', async () => {
        const created = await api.post('/store/jersey-requests', {
          email: 'moveme@example.com', raw_request: 'A jersey to be sourced please',
          source: 'homepage',
        }, storeHeaders(w))
        const res = await api.post(`/admin/jersey-requests/${created.data.id}`,
          { status: 'sourcing' }, admin)
        expect(res.data.request.status).toBe('sourcing')
      })

      it('refuses an invalid status', async () => {
        const created = await api.post('/store/jersey-requests', {
          email: 'badstatus@example.com', raw_request: 'Another jersey request here',
        }, storeHeaders(w))
        const res = await api.post(`/admin/jersey-requests/${created.data.id}`,
          { status: 'banana' }, admin).catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })
    })

    /**
     * Notifying a demand group.
     *
     * The queue has always ranked demand — twelve people asking for the same shirt are one
     * row — and acting on it emailed exactly one of them, with no link to buy anything. This
     * is the action that row was ranked for.
     */
    describe('notifying everyone who asked', () => {
      const ask = (email: string, over: Record<string, unknown> = {}) =>
        api.post('/store/jersey-requests', {
          email, raw_request: 'Kobe 2004 gold, whatever size you can get',
          team: 'Los Angeles Lakers', player: 'Kobe Bryant', ...over,
        }, storeHeaders(w))

      const notify = (body: Record<string, unknown>) =>
        api.post('/admin/jersey-requests/notify', body, admin)
          .catch((e: any) => e.response)

      it('refuses without something to buy', async () => {
        const res = await notify({ team: 'Los Angeles Lakers', player: 'Kobe Bryant' })
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/product_id is required/i)
      })

      it('refuses to send people to a draft product', async () => {
        const draft = await api.post('/admin/jerseys', {
          title: 'Draft Kobe', handle: `draft-kobe-${Date.now()}`, price: '65.99',
          sizes: ['L'], status: 'draft', team: 'Los Angeles Lakers',
        }, admin)
        await ask('draftcheck@example.com')

        const res = await notify({
          product_id: draft.data.product.id,
          team: 'Los Angeles Lakers', player: 'Kobe Bryant',
        })
        // A dead link sent to everybody who was waiting cannot be unsent.
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/not published/i)
      })

      it('previews the audience without sending', async () => {
        const p = await api.post('/admin/jerseys', {
          title: 'Preview Kobe', handle: `preview-kobe-${Date.now()}`, price: '65.99',
          sizes: ['L'], status: 'published', team: 'Los Angeles Lakers',
        }, admin)
        await ask('preview1@example.com')
        await ask('preview2@example.com')

        const res = await notify({
          product_id: p.data.product.id, team: 'Los Angeles Lakers',
          player: 'Kobe Bryant', dry_run: true,
        })
        expect(res.data.dry_run).toBe(true)
        expect(res.data.would_notify).toBeGreaterThanOrEqual(2)
        // Masked: this response is the kind of thing that gets pasted into a chat window.
        expect(res.data.recipients.join(' ')).not.toContain('preview1@example.com')
        expect(res.data.recipients.some((r: string) => /^p\*+@example\.com$/.test(r))).toBe(true)

        // Nothing was closed.
        const still = await api.get('/admin/jersey-requests?status=new', admin)
        expect(still.data.requests.some((r: any) => r.email === 'preview1@example.com'))
          .toBe(true)
      })

      it('notifies the whole group and closes their requests', async () => {
        const p = await api.post('/admin/jerseys', {
          title: 'Sourced Kobe', handle: `sourced-kobe-${Date.now()}`, price: '65.99',
          sizes: ['L'], status: 'published', team: 'Los Angeles Lakers',
        }, admin)
        const emails = ['fan-a@example.com', 'fan-b@example.com', 'fan-c@example.com']
        for (const e of emails) await ask(e, { player: 'Shaquille ONeal' })

        const res = await notify({
          product_id: p.data.product.id,
          team: 'Los Angeles Lakers', player: 'Shaquille ONeal',
        })

        expect(res.status).toBe(200)
        expect(res.data.notified).toBe(3)
        expect(res.data.requests_closed).toBe(3)
        expect(res.data.product.url).toContain('/jerseys/sourced-kobe')

        // Closed, so a second click cannot email the same three people again.
        const again = await notify({
          product_id: p.data.product.id,
          team: 'Los Angeles Lakers', player: 'Shaquille ONeal',
        })
        expect(again.data.notified).toBe(0)
        expect(again.data.message).toMatch(/nothing to send/i)
      })

      it('sends one email to somebody who asked three times', async () => {
        const p = await api.post('/admin/jerseys', {
          title: 'Repeat Kobe', handle: `repeat-kobe-${Date.now()}`, price: '65.99',
          sizes: ['L'], status: 'published', team: 'Los Angeles Lakers',
        }, admin)
        const email = 'persistent@example.com'
        for (let i = 0; i < 3; i++) await ask(email, { player: 'Pau Gasol' })

        const res = await notify({
          product_id: p.data.product.id,
          team: 'Los Angeles Lakers', player: 'Pau Gasol',
        })
        // One person, one email — and all three of their requests closed, because all three
        // of them are.
        expect(res.data.notified).toBe(1)
        expect(res.data.requests_closed).toBe(3)
      })

      it('accepts an explicit list of requests', async () => {
        const p = await api.post('/admin/jerseys', {
          title: 'Explicit Kobe', handle: `explicit-kobe-${Date.now()}`, price: '65.99',
          sizes: ['L'], status: 'published', team: 'Los Angeles Lakers',
        }, admin)
        const one = await ask('picked@example.com', { player: 'Derek Fisher' })
        await ask('notpicked@example.com', { player: 'Derek Fisher' })

        const res = await notify({ product_id: p.data.product.id, ids: [one.data.id] })
        expect(res.data.notified).toBe(1)

        const open = await api.get('/admin/jersey-requests?status=new', admin)
        expect(open.data.requests.some((r: any) => r.email === 'notpicked@example.com'))
          .toBe(true)
      })

      it('refuses a selection that names nobody', async () => {
        const p = await api.post('/admin/jerseys', {
          title: 'Empty Kobe', handle: `empty-kobe-${Date.now()}`, price: '65.99',
          sizes: ['L'], status: 'published', team: 'Los Angeles Lakers',
        }, admin)
        const res = await notify({ product_id: p.data.product.id })
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/ids, or a team and player/i)
      })
    })

    /**
     * The rate limit itself.
     *
     * Every other test in this file resets the limiter, so without these two the control
     * would be exercised by nothing — and a limit that is only reset is a limit that can be
     * deleted without a single test going red. That is the failure mode this whole session
     * is about: `assertConfigured()` was documented, tested around, and called from nowhere.
     */
    describe('one review per email per product', () => {
      it('refuses the second review, sequentially', async () => {
        const email = 'twice@example.com'
        const first = await api.post('/store/reviews', review({ email }), storeHeaders(w))
        const second = await api.post('/store/reviews', review({ email }), storeHeaders(w))
          .catch((e: any) => e.response)

        expect(first.status).toBe(201)
        expect(second.status).toBe(409)
        expect(second.data.message).toMatch(/already reviewed/i)
      })

      it('refuses the second review when both arrive at once', async () => {
        // The rule used to be a read followed by a write, which is not a rule — both
        // requests saw no existing row and both inserted. The unique index is what enforces
        // it; this is the test that would have caught its absence.
        const email = 'simultaneous@example.com'
        const codes = await Promise.all(
          Array.from({ length: 6 }, () =>
            api.post('/store/reviews', review({ email }), storeHeaders(w))
              .then((r: any) => r.status)
              .catch((e: any) => e.response.status))
        )

        expect(codes.filter((c) => c === 201)).toHaveLength(1)
        expect(codes.filter((c) => c === 409)).toHaveLength(5)
        // No 500s: the loser of the race gets the same answer as an ordinary duplicate,
        // and cannot tell which path refused it.
        expect(codes.some((c) => c >= 500)).toBe(false)

        const listed = await api.get(
          `/store/reviews?product_id=${w.productId}&limit=100`, storeHeaders(w))
        expect(listed.status).toBe(200)
      })

      it('lets a different address review the same product', async () => {
        const a = await api.post('/store/reviews',
          review({ email: 'person-a@example.com' }), storeHeaders(w))
        const b = await api.post('/store/reviews',
          review({ email: 'person-b@example.com' }), storeHeaders(w))
        expect(a.status).toBe(201)
        expect(b.status).toBe(201)
      })
    })

    describe('rate limiting on the public writers', () => {
      /**
       * A counter, not a timestamp.
       *
       * The shared `review()` helper derives its email from `hrtime % 100000`, which is
       * unique enough for one submission and not for eleven in a loop — and a collision
       * lands on "one review per email per product" rather than on the limit, so the test
       * fails intermittently and blames the wrong control.
       */
      let n = 0
      const uniqueReview = () => review({ email: `flood-${n++}@example.com` })

      const answers = async (n: number, post: () => Promise<{ status: number }>) => {
        const codes: number[] = []
        for (let i = 0; i < n; i++) {
          codes.push(await post().then((r) => r.status).catch((e: any) => e.response.status))
        }
        return codes
      }

      it('answers 429 once the review budget is spent, with Retry-After', async () => {
        // Eleven attempts against a budget of ten. The first ten are 201s and the
        // eleventh is the assertion.
        const codes = await answers(11, () =>
          api.post('/store/reviews', uniqueReview(), storeHeaders(w)))

        expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true)
        expect(codes[10]).toBe(429)

        const refused = await api.post('/store/reviews', uniqueReview(), storeHeaders(w))
          .catch((e: any) => e.response)
        // Without this header a client retries immediately and fails again, which turns one
        // refusal into a loop.
        expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0)
        expect(refused.data.type).toBe('too_many_requests')
      })

      it('answers 429 once the jersey-request budget is spent', async () => {
        const codes = await answers(11, () =>
          api.post('/store/jersey-requests', {
            email: 'flood@example.com', raw_request: 'A jersey, repeatedly',
          }, storeHeaders(w)))

        expect(codes[10]).toBe(429)
      })

      it('scopes the budget per endpoint', async () => {
        // Spending the review budget must not close the request form. Sharing one bucket
        // across endpoints is the easy mistake, and it means an abusive script pointed at
        // one form silently disables the others.
        await answers(11, () => api.post('/store/reviews', uniqueReview(), storeHeaders(w)))

        const res = await api.post('/store/jersey-requests', {
          email: 'unaffected@example.com', raw_request: 'Still able to ask for a jersey',
        }, storeHeaders(w))
        expect(res.status).toBe(201)
      })
    })
  },
})
