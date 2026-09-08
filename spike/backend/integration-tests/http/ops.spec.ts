import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
jest.setTimeout(120 * 1000)

/**
 * Operational endpoints and the global middleware.
 *
 * The middleware tests exist because of a self-inflicted outage: the error handler was
 * first registered as a route middleware, Medusa called the four-argument function with
 * three, and every single endpoint returned 500 while the unit tests stayed green. So
 * "ordinary requests still succeed" is now an assertion, not an assumption.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api }) => {
    describe('the global middleware does not break ordinary requests', () => {
      it('answers liveness', async () => {
        expect((await api.get('/health')).status).toBe(200)
      })

      it('answers a normal store request', async () => {
        // The regression that mattered: an error handler in the wrong slot turns every
        // 200 into a 500.
        const res = await api.get('/store/products?limit=1', { validateStatus: () => true })
        expect(res.status).toBeLessThan(500)
      })
    })

    describe('request id', () => {
      // Asserted on /health/ready rather than /health: user middleware runs after the
      // publishable-key and auth gates and is not attached to the framework's own
      // liveness route, so /health is outside its reach by design.
      it('is attached to responses from our own routes', async () => {
        const res = await api.get('/health/ready', { validateStatus: () => true })
        expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
      })

      it('is different per request, so two reports cannot be conflated', async () => {
        const a = await api.get('/health/ready', { validateStatus: () => true })
        const b = await api.get('/health/ready', { validateStatus: () => true })
        expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id'])
      })

      it('honours an upstream id, so a trace survives the proxy hop', async () => {
        const res = await api.get('/health/ready', {
          headers: { 'x-request-id': 'trace-from-lb' },
          validateStatus: () => true,
        })
        expect(res.headers['x-request-id']).toBe('trace-from-lb')
      })

      it('is absent when a gate rejects the request, which is the documented limit', () => {
        // Pinned deliberately. If a future Medusa version moves user middleware ahead of
        // the gates, this fails and the comment in middlewares.ts gets revisited rather
        // than quietly becoming untrue.
        return api.get('/store/products?limit=1', { validateStatus: () => true }).then((res) => {
          expect(res.status).toBe(400)
          expect(res.headers['x-request-id']).toBeUndefined()
        })
      })
    })

    describe('error responses keep their shape', () => {
      it('answers a missing publishable key with 400 JSON, not a 500 stack trace', async () => {
        // Setting config.errorHandler *replaces* Medusa's handler. The first version then
        // called next(err), which fell through to Express's default handler and turned
        // this 400 into a 500 HTML page with a full stack trace — a regression and a
        // disclosure at once.
        const res = await api.get('/store/products?limit=1', { validateStatus: () => true })
        expect(res.status).toBe(400)
        expect(String(res.headers['content-type'])).toContain('application/json')
        expect(res.data.type).toBe('not_allowed')
        expect(JSON.stringify(res.data)).not.toMatch(/at .*\.ts:\d+/)
      })
    })

    describe('readiness is not liveness', () => {
      it('reports each dependency separately', async () => {
        const res = await api.get('/health/ready', { validateStatus: () => true })
        expect([200, 503]).toContain(res.status)
        // The value of a readiness probe is knowing *which* dependency is down.
        expect(Object.keys(res.data.checks).sort()).toEqual(['catalog', 'database', 'media'])
        for (const c of Object.values<any>(res.data.checks)) {
          expect(typeof c.ok).toBe('boolean')
          expect(typeof c.ms).toBe('number')
        }
      })

      it('answers 503 rather than 500 when not ready', async () => {
        // A fresh test database has no products, so this instance is legitimately not
        // ready — which makes it the ideal place to assert the not-ready shape.
        const res = await api.get('/health/ready', { validateStatus: () => true })
        if (!res.data.ready) {
          // 503 is a state a load balancer waits out; 500 is one it reports as a bug.
          expect(res.status).toBe(503)
          expect(Object.values<any>(res.data.checks).some((c) => !c.ok)).toBe(true)
        } else {
          expect(res.status).toBe(200)
        }
      })

      it('reports the release, so a rollback can be confirmed', async () => {
        const res = await api.get('/health/ready', { validateStatus: () => true })
        expect(res.data).toHaveProperty('release')
        expect(res.data.uptime_s).toBeGreaterThanOrEqual(0)
      })

      it('database connectivity is the check that must pass', async () => {
        const res = await api.get('/health/ready', { validateStatus: () => true })
        // The suite could not have reached this point otherwise.
        expect(res.data.checks.database.ok).toBe(true)
      })
    })
  },
})
