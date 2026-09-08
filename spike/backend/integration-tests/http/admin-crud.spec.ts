import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import sharp from 'sharp'
import { adminHeaders, seedWorld, storeHeaders, type World } from './fixtures'
import { CATALOG_MODULE } from '../../src/modules/catalog'
import { __reset as resetRateLimits } from '../../src/rate-limit'

jest.setTimeout(180 * 1000)

/**
 * The CRUD that was missing.
 *
 * Mapping every table against its readers and writers turned up rows that could be created
 * and never corrected, and one table — `inbound_message` — that the admin could not read at
 * all. This suite covers the endpoints that close those gaps, and it exists because "there
 * is an endpoint" is not the same claim as "the endpoint does the thing": several of these
 * have to clean up rows in a second table, or refuse an operation that would leave the
 * storefront pointing at something that is not there.
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

    const catalog = () => getContainer().resolve(CATALOG_MODULE) as any
    const fail = (e: any) => e.response

    // ------------------------------------------------------------------ inbox
    describe('inbound messages — the inbox that did not exist', () => {
      const send = (over: Record<string, unknown> = {}) =>
        api.post('/store/contact', {
          email: `writer-${Math.random().toString(36).slice(2, 8)}@example.com`,
          name: 'A Customer',
          subject: 'Where is my order',
          body: 'I ordered a jersey last week and would like an update please.',
          ...over,
        }, storeHeaders(w))

      it('lists what the contact form wrote', async () => {
        await send({ email: 'listme@example.com' })
        const res = await api.get('/admin/inbound-messages?kind=contact', admin)

        expect(res.status).toBe(200)
        expect(res.data.messages.map((m: any) => m.email)).toContain('listme@example.com')
        expect(res.data.health.contact_new).toBeGreaterThan(0)
      })

      it('separates newsletter signups from contact', async () => {
        await api.post('/store/newsletter',
          { email: 'subscriber@example.com' }, storeHeaders(w))
        await send({ email: 'contacter@example.com' })

        const contact = await api.get('/admin/inbound-messages?kind=contact', admin)
        const news = await api.get('/admin/inbound-messages?kind=newsletter', admin)

        const emails = (r: any) => r.data.messages.map((m: any) => m.email)
        expect(emails(contact)).toContain('contacter@example.com')
        expect(emails(contact)).not.toContain('subscriber@example.com')
        expect(emails(news)).toContain('subscriber@example.com')
      })

      it('hides unsubscribed addresses from the newsletter list by default', async () => {
        const email = 'gone@example.com'
        await api.post('/store/newsletter', { email }, storeHeaders(w))
        await api.delete(`/store/newsletter?email=${encodeURIComponent(email)}`,
          storeHeaders(w)).catch(fail)

        const hidden = await api.get('/admin/inbound-messages?kind=newsletter', admin)
        expect(hidden.data.messages.map((m: any) => m.email)).not.toContain(email)

        // Reading a marketing list with opt-outs in it is how somebody gets emailed after
        // unsubscribing, so it takes an explicit flag.
        const shown = await api.get(
          '/admin/inbound-messages?kind=newsletter&include_unsubscribed=true', admin)
        expect(shown.data.messages.map((m: any) => m.email)).toContain(email)
      })

      it('works the queue and refuses an invented status', async () => {
        const created = await send({ email: 'queue@example.com' })
        const id = created.data.id ?? created.data.message?.id

        const ok = await api.post(`/admin/inbound-messages/${id}`,
          { status: 'answered', notes: 'Replied with tracking.' }, admin)
        expect(ok.data.message.status).toBe('answered')
        expect(ok.data.message.notes).toBe('Replied with tracking.')

        const bad = await api.post(`/admin/inbound-messages/${id}`,
          { status: 'banana' }, admin).catch(fail)
        expect(bad.status).toBe(400)
      })

      it('erases a message properly, not softly', async () => {
        const created = await send({ email: 'erase@example.com' })
        const id = created.data.id ?? created.data.message?.id

        const res = await api.delete(`/admin/inbound-messages/${id}`, admin)
        expect(res.data.deleted).toBe(true)

        // A soft delete would leave the address in the table, which does not answer an
        // erasure request.
        const rows = await catalog().listInboundMessages(
          { email: 'erase@example.com' }, { take: 5, withDeleted: true })
        expect(rows).toHaveLength(0)
      })

      it('warns when erasing also erases an unsubscribe record', async () => {
        const email = 'optout-then-erase@example.com'
        await api.post('/store/newsletter', { email }, storeHeaders(w))
        await api.delete(`/store/newsletter?email=${encodeURIComponent(email)}`,
          storeHeaders(w)).catch(fail)

        const list = await api.get(
          '/admin/inbound-messages?kind=newsletter&include_unsubscribed=true', admin)
        const row = list.data.messages.find((m: any) => m.email === email)

        const res = await api.delete(`/admin/inbound-messages/${row.id}`, admin)
        expect(res.data.warning).toMatch(/suppression list/i)
      })

      it('404s an unknown id', async () => {
        const res = await api.get('/admin/inbound-messages/nope', admin).catch(fail)
        expect(res.status).toBe(404)
      })
    })

    // ------------------------------------------------------------------ collections
    describe('curated collections — previously script-only', () => {
      const create = (over: Record<string, unknown> = {}) =>
        api.post('/admin/curated-collections',
          { title: 'Best Sellers', handle: `bs-${Math.random().toString(36).slice(2, 8)}`,
            ...over }, admin).catch(fail)

      it('creates one and derives a handle from the title', async () => {
        const res = await api.post('/admin/curated-collections',
          { title: 'World Cup Range' }, admin)
        expect(res.status).toBe(201)
        expect(res.data.collection.handle).toBe('world-cup-range')
        // Nothing in it yet, so it is not live — the storefront hides empty collections
        // rather than listing a dead link.
        expect(res.data.collection.live).toBe(false)
      })

      it('refuses a duplicate handle', async () => {
        await create({ handle: 'taken-collection' })
        const again = await create({ handle: 'taken-collection' })
        expect(again.status).toBe(422)
      })

      it('adds products, and the storefront then shows it', async () => {
        const c = await create()
        const handle = c.data.collection.handle

        const add = await api.post(`/admin/curated-collections/${handle}/products`,
          { product_ids: [w.productId] }, admin)
        expect(add.data.added).toBe(1)

        const store = await api.get('/store/curated-collections', storeHeaders(w))
        const listed = store.data.collections.find((x: any) => x.handle === handle)
        expect(listed.count).toBe(1)
      })

      it('refuses a product that does not exist', async () => {
        const c = await create()
        const res = await api.post(
          `/admin/curated-collections/${c.data.collection.handle}/products`,
          { product_ids: ['prod_nope'] }, admin).catch(fail)

        // A membership row pointing at nothing makes the collection advertise a count the
        // page cannot fill — the mismatch this whole table exists to avoid.
        expect(res.status).toBe(404)
      })

      it('treats adding the same product twice as a double-click, not an error', async () => {
        const c = await create()
        const handle = c.data.collection.handle
        await api.post(`/admin/curated-collections/${handle}/products`,
          { product_ids: [w.productId] }, admin)
        const again = await api.post(`/admin/curated-collections/${handle}/products`,
          { product_ids: [w.productId] }, admin)

        expect(again.data.added).toBe(0)
        expect(again.data.already_present).toBe(1)
        expect(again.data.count).toBe(1)
      })

      it('replaces the whole membership set in order on PUT', async () => {
        const c = await create()
        const handle = c.data.collection.handle
        await api.post(`/admin/curated-collections/${handle}/products`,
          { product_ids: [w.productId] }, admin)

        const res = await api.put(`/admin/curated-collections/${handle}/products`,
          { product_ids: [] }, admin)
        expect(res.data.count).toBe(0)
        expect(res.data.replaced).toBe(1)

        const after = await api.get(`/admin/curated-collections/${handle}`, admin)
        expect(after.data.products).toHaveLength(0)
      })

      it('removes a product', async () => {
        const c = await create()
        const handle = c.data.collection.handle
        await api.post(`/admin/curated-collections/${handle}/products`,
          { product_ids: [w.productId] }, admin)

        const res = await api.delete(`/admin/curated-collections/${handle}/products`,
          { ...admin, data: { product_ids: [w.productId] } })
        expect(res.data.removed).toBe(1)
      })

      it('edits the collection but refuses to rename the handle', async () => {
        const c = await create()
        const handle = c.data.collection.handle

        const res = await api.post(`/admin/curated-collections/${handle}`,
          { title: 'Renamed', active: false, handle: 'something-else' }, admin)

        expect(res.data.collection.title).toBe('Renamed')
        expect(res.data.collection.active).toBe(false)
        // The handle is the storefront URL and the key every membership row carries.
        expect(res.data.collection.handle).toBe(handle)
      })

      it('takes its memberships with it when deleted', async () => {
        const c = await create()
        const handle = c.data.collection.handle
        await api.post(`/admin/curated-collections/${handle}/products`,
          { product_ids: [w.productId] }, admin)

        const res = await api.delete(`/admin/curated-collections/${handle}`, admin)
        expect(res.data.memberships_removed).toBe(1)

        // Memberships are keyed by handle, not by an enforced foreign key — so an orphan
        // here would be silently inherited by the next collection to reuse the handle.
        const left = await catalog().listCollectionMemberships(
          { collection_handle: handle }, { take: 10 })
        expect(left).toHaveLength(0)
      })

      it('404s an unknown handle', async () => {
        const res = await api.get('/admin/curated-collections/nope', admin).catch(fail)
        expect(res.status).toBe(404)
      })
    })

    // ------------------------------------------------------------------ store reviews
    describe('store reviews — published, and previously uneditable', () => {
      const seed = async (over: Record<string, unknown> = {}) => {
        const [row] = await catalog().createStoreReviews([{
          rating: 5, title: 'Great', body: 'Arrived fast and looks the part.',
          author_name: 'A Buyer', source: 'eBay', reviewed_at: new Date(),
          fingerprint: `fp-${Math.random().toString(36).slice(2, 10)}`,
          match_method: 'unmatched', ...over,
        }])
        return row
      }

      it('lists them with the numbers an audit needs', async () => {
        await seed()
        const res = await api.get('/admin/store-reviews', admin)
        expect(res.status).toBe(200)
        expect(res.data.health.total).toBeGreaterThan(0)
        expect(res.data.sources).toContain('eBay')
      })

      it('attaches one to a product and records that a human decided it', async () => {
        const row = await seed()
        const res = await api.post(`/admin/store-reviews/${row.id}`,
          { product_id: w.productId }, admin)

        expect(res.data.review.product_id).toBe(w.productId)
        // Automatic exact-title matches stay distinguishable from judgement calls.
        expect(res.data.review.match_method).toBe('manual')
      })

      it('detaches when product_id is cleared', async () => {
        const row = await seed({ product_id: w.productId, match_method: 'manual' })
        const res = await api.post(`/admin/store-reviews/${row.id}`,
          { product_id: null }, admin)
        expect(res.data.review.product_id).toBeNull()
        expect(res.data.review.match_method).toBe('unmatched')
      })

      it('refuses to edit what the reviewer wrote', async () => {
        const row = await seed()
        const res = await api.post(`/admin/store-reviews/${row.id}`,
          { body: 'Something they did not say', rating: 1 }, admin).catch(fail)

        // The storefront says these are shown as written and unfiltered. An endpoint that
        // can rewrite them makes that sentence false.
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/shown as it was written/i)
      })

      it('refuses to attach to a product that does not exist', async () => {
        const row = await seed()
        const res = await api.post(`/admin/store-reviews/${row.id}`,
          { product_id: 'prod_nope' }, admin).catch(fail)
        expect(res.status).toBe(404)
      })

      it('takes one down, and the storefront aggregate follows', async () => {
        const row = await seed()
        const before = await api.get('/store/store-reviews', storeHeaders(w))

        const res = await api.delete(`/admin/store-reviews/${row.id}`, admin)
        expect(res.data.deleted).toBe(true)
        expect(res.data.warning).toMatch(/import-reviews/)

        // The endpoint invalidates the cached aggregate, so the count moves immediately
        // rather than in ten minutes.
        const after = await api.get('/store/store-reviews', storeHeaders(w))
        expect(after.data.count).toBe(before.data.count - 1)
      })
    })

    // ------------------------------------------------------------------ erasure
    describe('removal paths that did not exist', () => {
      it('deletes a product review outright, freeing the address', async () => {
        const email = 'reviewer-delete@example.com'
        const posted = await api.post('/store/reviews', {
          product_id: w.productId, rating: 4, author_name: 'R',
          body: 'A perfectly ordinary review of a jersey.', email,
        }, storeHeaders(w))

        await api.delete(`/admin/reviews/${posted.data.id}`, admin)

        // Rejection keeps the row for the audit trail; deletion is for the cases rejection
        // cannot answer, and it has to actually free the unique index.
        const again = await api.post('/store/reviews', {
          product_id: w.productId, rating: 4, author_name: 'R',
          body: 'A second perfectly ordinary review of a jersey.', email,
        }, storeHeaders(w))
        expect(again.status).toBe(201)
      })

      it('deletes a jersey request', async () => {
        const created = await api.post('/store/jersey-requests', {
          email: 'erase-request@example.com', raw_request: 'A shirt I would like sourced',
        }, storeHeaders(w))

        const res = await api.delete(`/admin/jersey-requests/${created.data.id}`, admin)
        expect(res.data.deleted).toBe(true)

        const rows = await catalog().listJerseyRequests(
          { email: 'erase-request@example.com' }, { take: 5 })
        expect(rows).toHaveLength(0)
      })

      it('soft-deletes a return request, keeping the decision', async () => {
        const [row] = await catalog().createReturnRequests([{
          order_id: 'order_x', email: 'returner@example.com',
          kind: 'fault', reason: 'faulty', status: 'new',
        }])

        const res = await api.delete(`/admin/return-requests/${row.id}`, admin)
        expect(res.data.soft).toBe(true)

        // Hidden from the queue, still on the record: a return decision is the evidence for
        // a refusal under a final-sale policy.
        const visible = await catalog().listReturnRequests({ id: row.id }, { take: 1 })
        expect(visible).toHaveLength(0)
        const withDeleted = await catalog().listReturnRequests(
          { id: row.id }, { take: 1, withDeleted: true })
        expect(withDeleted).toHaveLength(1)
      })
    })

    // ------------------------------------------------------------------ media
    describe('media — orphan sweep and deletion', () => {
      const png = (r: number, g: number, b: number) =>
        sharp({ create: { width: 20, height: 14, channels: 3, background: { r, g, b } } })
          .png().toBuffer()

      const upload = async (buf: Buffer) => {
        const form = new FormData()
        form.append('files', new Blob([new Uint8Array(buf)]), 'shot.png')
        const res = await api.post('/admin/media/upload', form, admin)
        return res.data.uploaded[0].sha256 as string
      }

      it('routes /orphans as a path, not as a content address', async () => {
        // `orphans` sits beside `[sha]`, and if the dynamic route won the match this would
        // be a 400 complaining that "orphans" is not a content address.
        const res = await api.get('/admin/media/orphans', admin)
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.orphans)).toBe(true)
      })

      it('finds an uploaded image that nothing references', async () => {
        const sha = await upload(await png(210, 40, 40))
        const res = await api.get('/admin/media/orphans?limit=1000', admin)
        expect(res.data.orphans.map((o: any) => o.sha256)).toContain(sha)
        expect(res.data.reclaimable_kb).toBeGreaterThanOrEqual(0)
      })

      it('does not call an attached image an orphan', async () => {
        const sha = await upload(await png(40, 210, 40))
        await api.post('/admin/jerseys', {
          title: 'Orphan Check Jersey', handle: `orphan-check-${Date.now()}`,
          price: '65.99', sizes: ['S'], images: [`/media/${sha}.webp`],
          team: 'Chicago Bulls',
        }, admin)

        const res = await api.get('/admin/media/orphans?limit=1000', admin)
        expect(res.data.orphans.map((o: any) => o.sha256)).not.toContain(sha)
      })

      it('refuses a sweep that does not say what to remove', async () => {
        const res = await api.delete('/admin/media/orphans', admin).catch(fail)
        expect(res.status).toBe(400)
      })

      it('removes exactly the assets named', async () => {
        const doomed = await upload(await png(40, 40, 210))
        const spared = await upload(await png(200, 200, 40))

        const res = await api.delete('/admin/media/orphans',
          { ...admin, data: { sha256: [doomed] } })
        expect(res.data.deleted).toBe(1)

        const gone = await api.get(`/media/${doomed}.webp`).catch(fail)
        expect(gone.status).toBe(404)
        const still = await api.get(`/media/${spared}.webp`, { responseType: 'arraybuffer' })
        expect(still.status).toBe(200)
      })

      it('refuses to delete a referenced asset without force', async () => {
        const sha = await upload(await png(120, 60, 180))
        await api.post('/admin/jerseys', {
          title: 'Referenced Jersey', handle: `referenced-${Date.now()}`,
          price: '65.99', sizes: ['S'], images: [`/media/${sha}.webp`],
          team: 'Chicago Bulls',
        }, admin)

        const refused = await api.delete(`/admin/media/${sha}`, admin).catch(fail)
        expect(refused.status).toBe(409)

        const forced = await api.delete(`/admin/media/${sha}?force=true`, admin)
        expect(forced.data.forced).toBe(true)
      })

      it('reads one asset without shipping its bytes', async () => {
        const sha = await upload(await png(15, 15, 15))
        const res = await api.get(`/admin/media/${sha}`, admin)
        expect(res.data.sha256).toBe(sha)
        expect(res.data.bytes).toBeGreaterThan(0)
        // A 20x14 solid colour encodes to well under a kilobyte, so `kb` rounds to 0 —
        // which is why the payload carries the exact byte count as well.
        expect(res.data.width).toBe(20)
        expect(res.data.stored_inline).toBe(true)
      })

      it('rejects a path that is not a content address', async () => {
        const res = await api.get('/admin/media/not-a-sha', admin).catch(fail)
        expect(res.status).toBe(400)
      })
    })

    // ------------------------------------------------------------------ auth
    describe('none of it is reachable without a session', () => {
      it.each([
        ['get', '/admin/inbound-messages'],
        ['get', '/admin/curated-collections'],
        ['get', '/admin/store-reviews'],
        ['get', '/admin/media/orphans'],
      ])('%s %s refuses anonymously', async (method, path) => {
        const res = await (api as any)[method](path).catch(fail)
        expect([401, 403]).toContain(res.status)
      })
    })
  },
})
