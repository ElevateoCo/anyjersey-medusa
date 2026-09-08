import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { seedWorld, storeHeaders, type World } from './fixtures'
import { __reset as resetRateLimits } from '../../src/rate-limit'

jest.setTimeout(180 * 1000)

/**
 * Contact form and newsletter sign-up.
 *
 * Both are unauthenticated public POSTs that write rows, so both carry the same guards as
 * `/store/jersey-requests`. The newsletter carries two more, because it is marketing consent
 * rather than a mailing list:
 *
 *  - **The answer is identical whether or not the address is already subscribed**, or the
 *    footer form becomes a way to test which addresses have shopped here.
 *  - **Unsubscribe suppresses rather than deletes**, because the defensible record is when
 *    consent was given and withdrawn — a deleted row cannot show that an address was
 *    suppressed rather than never collected.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let w: World

    beforeAll(async () => {
      w = await seedWorld(getContainer())
    })

    beforeEach(() => resetRateLimits())

    describe('POST /store/contact', () => {
      const message = (over: Record<string, unknown> = {}) => ({
        email: 'sam@example.com',
        name: 'Sam',
        phone: '555 0100',
        body: 'Where is order 1042?',
        ...over,
      })

      it('accepts a message and stores it', async () => {
        const res = await api.post('/store/contact', message(), storeHeaders(w))
        expect(res.status).toBe(201)
        expect(res.data.status).toBe('new')
        expect(res.data.id).toBeTruthy()
      })

      it('requires a valid email', async () => {
        const res = await api.post('/store/contact', message({ email: 'not-an-email' }),
          storeHeaders(w)).catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })

      it('requires something to actually say', async () => {
        const res = await api.post('/store/contact', message({ body: '' }),
          storeHeaders(w)).catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })

      it('accepts a message with no name or phone', async () => {
        // Every extra required field on a contact form is a reason not to send it.
        const res = await api.post('/store/contact',
          { email: 'x@example.com', body: 'A question' }, storeHeaders(w))
        expect(res.status).toBe(201)
      })

      it('is rate limited', async () => {
        const attempts = await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            api.post('/store/contact', message({ email: `f${i}@example.com` }),
              storeHeaders(w)).then((r: any) => r.status, (e: any) => e.response?.status ?? 0)
          )
        )
        expect(attempts).toContain(429)
      })
    })

    describe('POST /store/newsletter', () => {
      it('subscribes an address', async () => {
        const res = await api.post('/store/newsletter',
          { email: 'fan@example.com' }, storeHeaders(w))
        expect(res.status).toBe(201)
        expect(res.data.ok).toBe(true)
      })

      it('answers identically for an address already on the list', async () => {
        // Otherwise the footer form enumerates customers.
        const first = await api.post('/store/newsletter',
          { email: 'twice@example.com' }, storeHeaders(w))
        const second = await api.post('/store/newsletter',
          { email: 'twice@example.com' }, storeHeaders(w))
        expect(second.status).toBe(first.status)
        expect(second.data).toEqual(first.data)
      })

      it('rejects a malformed address', async () => {
        const res = await api.post('/store/newsletter', { email: 'nope' },
          storeHeaders(w)).catch((e: any) => e.response)
        expect(res.status).toBe(400)
      })

      it('unsubscribes, and says the same thing for an unknown address', async () => {
        await api.post('/store/newsletter', { email: 'bye@example.com' }, storeHeaders(w))
        const known = await api.delete(
          '/store/newsletter?email=bye@example.com', storeHeaders(w)
        )
        const unknown = await api.delete(
          '/store/newsletter?email=never@example.com', storeHeaders(w)
        )
        expect(known.data).toEqual(unknown.data)
      })

      it('re-subscribing after an unsubscribe works', async () => {
        await api.post('/store/newsletter', { email: 'back@example.com' }, storeHeaders(w))
        await api.delete('/store/newsletter?email=back@example.com', storeHeaders(w))
        const again = await api.post('/store/newsletter',
          { email: 'back@example.com' }, storeHeaders(w))
        expect(again.status).toBe(201)
      })

      it('is rate limited', async () => {
        const attempts = await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            api.post('/store/newsletter', { email: `n${i}@example.com` }, storeHeaders(w))
              .then((r: any) => r.status, (e: any) => e.response?.status ?? 0)
          )
        )
        expect(attempts).toContain(429)
      })
    })
  },
})
