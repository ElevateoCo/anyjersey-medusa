import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { adminHeaders, seedWorld, storeHeaders, type World } from './fixtures'
import { CATALOG_MODULE } from '../../src/modules/catalog'
import { __reset as resetRateLimits } from '../../src/rate-limit'
import { ANONYMISED, ANONYMISED_EMAIL } from '../../src/privacy'
import retentionJob from '../../src/jobs/retention'

jest.setTimeout(180 * 1000)

/**
 * Subject access, erasure, and retention — against a real database.
 *
 * The published policy has promised all three since it shipped. What this file asserts is
 * that the promises are now operations rather than sentences: that an export finds a person
 * across every store, that erasure removes what it says and keeps what it must, and that the
 * nightly job actually deletes rows once their period has run.
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

    /** Give one address a presence in several stores at once. */
    const seedSubject = async (email: string) => {
      await api.post('/store/contact', {
        email, name: 'A Person', subject: 'A question',
        body: 'Where is the jersey I asked about last week?',
      }, storeHeaders(w))
      await api.post('/store/jersey-requests', {
        email, raw_request: 'A 1998 shirt nobody stocks any more',
      }, storeHeaders(w))
      await api.post('/store/reviews', {
        product_id: w.productId, rating: 5, author_name: 'A Person',
        body: 'Arrived quickly and fits exactly as described.', email,
      }, storeHeaders(w))
    }

    describe('subject access', () => {
      it('finds one person across every store that can be searched', async () => {
        const email = 'subject@example.com'
        await seedSubject(email)

        const res = await api.get(
          `/admin/privacy/subject?email=${encodeURIComponent(email)}`, admin)

        expect(res.status).toBe(200)
        expect(res.data.subject).toBe(email)
        expect(res.data.record_count).toBeGreaterThanOrEqual(3)

        const rows = (table: string) =>
          res.data.stores.find((s: any) => s.table === table).records
        expect(rows('inbound_message')).toHaveLength(1)
        expect(rows('jersey_request')).toHaveLength(1)
        expect(rows('product_review')).toHaveLength(1)
      })

      it('says why each store is held and for how long', async () => {
        const res = await api.get('/admin/privacy/subject?email=nobody@example.com', admin)
        for (const store of res.data.stores) {
          // Article 15 asks for the purposes and the retention period, not just the data.
          expect(store.lawful_basis).toBeTruthy()
          expect(store.retention).toBeTruthy()
          expect(['delete', 'anonymise', 'retain']).toContain(store.on_erasure)
        }
      })

      it('distinguishes “nothing here” from “we did not look”', async () => {
        const res = await api.get('/admin/privacy/subject?email=nobody@example.com', admin)
        // Imported reviews carry no address and personalisations key to an order. An export
        // that silently omitted them would claim a completeness it does not have.
        expect(res.data.not_searchable_by_email).toContain('store_review')
        expect(res.data.not_searchable_by_email).toContain('line_personalisation')
      })

      it('refuses without a usable address', async () => {
        const res = await api.get('/admin/privacy/subject?email=notanemail', admin)
          .catch(fail)
        expect(res.status).toBe(400)
      })

      it('is not reachable anonymously', async () => {
        const res = await api.get('/admin/privacy/subject?email=a@b.com').catch(fail)
        expect([401, 403]).toContain(res.status)
      })
    })

    describe('erasure', () => {
      it('requires an explicit confirmation', async () => {
        const res = await api.delete('/admin/privacy/subject',
          { ...admin, data: { email: 'x@example.com' } }).catch(fail)
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/confirm/i)
      })

      it('deletes the stores where the row is the person', async () => {
        const email = 'eraseme@example.com'
        await seedSubject(email)

        const res = await api.delete('/admin/privacy/subject',
          { ...admin, data: { email, confirm: true } })

        expect(res.data.deleted.inbound_message).toBe(1)
        expect(res.data.deleted.jersey_request).toBe(1)
        expect(res.data.deleted.product_review).toBe(1)

        // Actually gone, not hidden — a soft delete leaves the address in the table and does
        // not answer the request.
        const left = await catalog().listInboundMessages({ email }, { take: 5 })
        expect(left).toHaveLength(0)

        const after = await api.get(
          `/admin/privacy/subject?email=${encodeURIComponent(email)}`, admin)
        expect(after.data.record_count).toBe(0)
      })

      it('anonymises a return request instead of destroying the decision', async () => {
        const email = 'returner-erase@example.com'
        const [row] = await catalog().createReturnRequests([{
          order_id: 'order_p', email, kind: 'fault', reason: 'faulty',
          status: 'new', comment: 'It arrived torn',
        }])

        const res = await api.delete('/admin/privacy/subject',
          { ...admin, data: { email, confirm: true } })
        expect(res.data.anonymised.return_request).toBe(1)

        const [after] = await catalog().listReturnRequests({ id: row.id }, { take: 1 })
        // The decision and its policy grounds survive — they are the evidence for a refusal.
        expect(after.status).toBe('new')
        expect(after.reason).toBe('faulty')
        // The person does not.
        expect(after.email).toBe(ANONYMISED_EMAIL)
        expect(after.comment).toBeNull()
      })

      it('masks the address in its own audit log line', async () => {
        // Writing the address into a log while deleting it from the database is
        // self-defeating, and the log outlives the erasure.
        const email = 'logged-erase@example.com'
        await seedSubject(email)
        const res = await api.delete('/admin/privacy/subject',
          { ...admin, data: { email, confirm: true } })
        expect(res.data.subject).not.toBe(email)
        expect(res.data.subject).toMatch(/^l\*+@example\.com$/)
      })

      it('reports what it kept, and why', async () => {
        const res = await api.delete('/admin/privacy/subject',
          { ...admin, data: { email: 'nothing@example.com', confirm: true } })
        // An erasure that quietly skipped the orders would be worse than one that refused,
        // because the subject would believe it was complete.
        expect(res.data).toHaveProperty('retained')
        expect(res.data.note).toMatch(/marketplace reviews/i)
      })
    })

    describe('the retention job', () => {
      it('reports without deleting by default', async () => {
        const [old] = await catalog().createJerseyRequests([{
          email: 'ancient@example.com', raw_request: 'A very old request',
          created_at: new Date('2020-01-01'),
        }])

        const result = await retentionJob(getContainer() as never) as any
        expect(result.apply).toBe(false)

        const still = await catalog().listJerseyRequests({ id: old.id }, { take: 1 })
        // The first run against a real database is the one that removes two years of history
        // in a transaction nobody watched. It reports first.
        expect(still).toHaveLength(1)
      })

      it('deletes past-retention rows when told to apply', async () => {
        const [old] = await catalog().createJerseyRequests([{
          email: 'ancient2@example.com', raw_request: 'Another very old request',
          created_at: new Date('2020-01-01'),
        }])
        const [fresh] = await catalog().createJerseyRequests([{
          email: 'recent@example.com', raw_request: 'A request from today',
        }])

        process.env.PRIVACY_RETENTION_APPLY = 'true'
        try {
          const result = await retentionJob(getContainer() as never) as any
          expect(result.apply).toBe(true)
        } finally {
          delete process.env.PRIVACY_RETENTION_APPLY
        }

        expect(await catalog().listJerseyRequests({ id: old.id }, { take: 1 }))
          .toHaveLength(0)
        // And leaves everything inside its period alone, which is the half that would ruin
        // the shop if it were wrong.
        expect(await catalog().listJerseyRequests({ id: fresh.id }, { take: 1 }))
          .toHaveLength(1)
      })

      it('anonymises rather than deletes where a record must survive', async () => {
        const [old] = await catalog().createLinePersonalisations([{
          product_id: w.productId, kind: 'name', value: 'MAHOMES', price: 1499,
          typeface: 'default', placement: 'back', approved_preview: 'data:image/png;base64,AAA',
          created_at: new Date('2020-01-01'),
        }])

        process.env.PRIVACY_RETENTION_APPLY = 'true'
        try {
          await retentionJob(getContainer() as never)
        } finally {
          delete process.env.PRIVACY_RETENTION_APPLY
        }

        const [after] = await catalog().listLinePersonalisations({ id: old.id }, { take: 1 })
        // The row survives: it is part of what was sold. What was printed does not.
        expect(after).toBeTruthy()
        expect(after.value).toBe(ANONYMISED)
        expect(after.approved_preview).toBeNull()
      })
    })
  },
})
