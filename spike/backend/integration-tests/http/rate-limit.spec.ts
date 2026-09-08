import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { seedWorld, storeHeaders, type World } from './fixtures'
import { __reset as resetRateLimits } from '../../src/rate-limit'

jest.setTimeout(180 * 1000)

/**
 * Rate limits on routes this application does not own, and on the identity they are keyed by.
 *
 * Two things are being proved here, and neither is provable by a unit test:
 *
 *  1. **The middleware actually runs.** Every limit before this was a guard inside one of our
 *     own handlers, which is easy to verify by reading. A `defineMiddlewares` matcher against
 *     a Medusa route is not: a pattern that matches nothing looks exactly like a pattern that
 *     works, right up until somebody points a credential-stuffing script at the login.
 *
 *  2. **The forwarded identity is the whole feature.** Login, registration and checkout are
 *     all called from the Next server, so before `INTERNAL_API_SECRET` a limit on them would
 *     have capped the shop rather than an attacker. These tests assert the split happens with
 *     the secret and does *not* happen without it, which is the part an attacker would try.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let w: World

    beforeAll(async () => { w = await seedWorld(getContainer()) })
    beforeEach(() => resetRateLimits())

    const fail = (e: any) => e.response

    /** Matches `.env.test`. The storefront holds the same value. */
    const SECRET = 'test-internal-secret'
    const asCustomer = (ip: string) => ({
      headers: { 'x-internal-secret': SECRET, 'x-client-ip': ip },
    })

    const login = (headers: any = {}) =>
      api.post('/auth/customer/emailpass',
        { email: 'nobody@example.com', password: 'wrong-password' }, headers).catch(fail)

    // ------------------------------------------------------- Medusa's own routes
    describe('login', () => {
      it('refuses after ten attempts a minute', async () => {
        const who = asCustomer('198.51.100.1')

        // Ten wrong passwords is already generous for a person; the eleventh in the same
        // minute is a script. Each of these is a 401 — the limit runs before the handler,
        // which is the point: a failed login must still cost the caller its budget.
        for (let i = 0; i < 10; i++) {
          const res = await login(who)
          expect(res.status).toBe(401)
        }

        const blocked = await login(who)
        expect(blocked.status).toBe(429)
        expect(blocked.data.type).toBe('too_many_requests')
        expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1)
      })

      it('is a limit on one customer, not on the shop', async () => {
        const attacker = asCustomer('198.51.100.2')
        for (let i = 0; i < 10; i++) await login(attacker)
        expect((await login(attacker)).status).toBe(429)

        // The failure this exists to prevent: everybody else locked out because one address
        // hammered the login through the same storefront.
        const someoneElse = await login(asCustomer('198.51.100.3'))
        expect(someoneElse.status).toBe(401)
      })

      it('cannot be evaded by claiming an address without the secret', async () => {
        // Exhaust the bucket the socket address falls into — no forwarding headers at all.
        for (let i = 0; i < 10; i++) await login()
        expect((await login()).status).toBe(429)

        // Now try to buy a fresh bucket with a made-up address and no secret. If this
        // returned 401, every limit in the application would be one header away from void.
        const forged = await login({
          headers: { 'x-client-ip': '203.0.113.77' },
        })
        expect(forged.status).toBe(429)

        // And with a *wrong* secret, which is the same claim with more confidence.
        const wrongSecret = await login({
          headers: { 'x-internal-secret': 'not-the-secret', 'x-client-ip': '203.0.113.78' },
        })
        expect(wrongSecret.status).toBe(429)
      })
    })

    describe('registration and password paths', () => {
      const register = (headers: any) =>
        api.post('/auth/customer/emailpass/register',
          { email: `x${Math.random().toString(36).slice(2, 9)}@example.com`, password: 'sw0rdfish!' },
          headers).catch(fail)

      it('is tighter than login, because reset sends mail to an address the caller chose',
        async () => {
          const who = asCustomer('198.51.100.4')
          for (let i = 0; i < 5; i++) {
            expect((await register(who)).status).toBeLessThan(400)
          }
          expect((await register(who)).status).toBe(429)
        })

      it('shares its budget with reset-password, which is the same abuse', async () => {
        const who = asCustomer('198.51.100.5')
        for (let i = 0; i < 5; i++) await register(who)

        const reset = await api.post('/auth/customer/emailpass/reset-password',
          { identifier: 'someone@example.com' }, who).catch(fail)
        expect(reset.status).toBe(429)
      })

      it('leaves login alone — one endpoint cannot exhaust another', async () => {
        const who = asCustomer('198.51.100.6')
        for (let i = 0; i < 6; i++) await register(who)
        expect((await login(who)).status).toBe(401)
      })
    })

    describe('cart creation', () => {
      /**
       * A `/store` route rather than an `/auth` one, and a static matcher guarding a static
       * route — the case that the `/auth/:actor/:provider` version got wrong. Worth a test
       * of its own precisely because it *looks* identical to the version that did nothing.
       */
      it('refuses after thirty a minute', async () => {
        const who = {
          headers: {
            ...storeHeaders(w).headers,
            'x-internal-secret': SECRET,
            'x-client-ip': '198.51.100.9',
          },
        }
        const create = () => api.post('/store/carts', { region_id: w.regionId }, who).catch(fail)

        for (let i = 0; i < 30; i++) expect((await create()).status).toBe(200)
        expect((await create()).status).toBe(429)
      })
    })

    // ------------------------------------------------------------ our own routes
    describe('expensive reads', () => {
      /**
       * Merged into `storeHeaders`, not spread beside it.
       *
       * `{ ...storeHeaders(w), headers: mine }` replaces the whole `headers` object and
       * takes the publishable key with it, and the route then answers 400 for a reason
       * that has nothing to do with what is being tested.
       */
      const asStore = (ip: string) => ({
        headers: {
          ...storeHeaders(w).headers,
          'x-internal-secret': SECRET,
          'x-client-ip': ip,
        },
      })
      const sitemap = (cfg: any) => api.get('/store/sitemap', cfg).catch(fail)

      it('caps the whole-catalogue query at ten a minute', async () => {
        // The storefront asks once an hour and caches the answer, so this budget is
        // unreachable in normal use. It is here to stop a loop.
        const who = asStore('198.51.100.7')
        for (let i = 0; i < 10; i++) {
          expect((await sitemap(who)).status).toBe(200)
        }
        const blocked = await sitemap(who)
        expect(blocked.status).toBe(429)
        expect(blocked.data.message).toMatch(/wait a moment/i)
      })

      it('does not spend the suggest budget', async () => {
        const who = asStore('198.51.100.8')
        for (let i = 0; i < 11; i++) await sitemap(who)

        const suggest = await api.get('/store/suggest?q=jer', who).catch(fail)
        expect(suggest.status).toBe(200)
      })
    })
  },
})
