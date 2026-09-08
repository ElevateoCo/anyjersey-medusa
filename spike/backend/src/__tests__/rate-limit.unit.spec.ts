import { __reset, clientKey, consume, consumeShared, limited, rateLimit } from '../rate-limit'

beforeEach(__reset)

const T0 = Date.parse('2026-08-28T12:00:00Z')

describe('consume', () => {
  it('allows up to the budget and then refuses', () => {
    for (let i = 0; i < 3; i++) {
      expect(consume('1.2.3.4', 's', 3, 60_000, T0).ok).toBe(true)
    }
    const v = consume('1.2.3.4', 's', 3, 60_000, T0)
    expect(v.ok).toBe(false)
  })

  it('reports remaining, counting the current request', () => {
    const v = consume('1.2.3.4', 's', 3, 60_000, T0)
    expect(v.ok && v.remaining).toBe(2)
  })

  it('resets when the window has passed', () => {
    for (let i = 0; i < 3; i++) consume('1.2.3.4', 's', 3, 60_000, T0)
    expect(consume('1.2.3.4', 's', 3, 60_000, T0 + 60_001).ok).toBe(true)
  })

  it('keeps scopes independent, so one endpoint cannot exhaust another', () => {
    for (let i = 0; i < 3; i++) consume('1.2.3.4', 'writes', 3, 60_000, T0)
    expect(consume('1.2.3.4', 'reads', 3, 60_000, T0).ok).toBe(true)
  })

  it('keeps callers independent', () => {
    for (let i = 0; i < 3; i++) consume('1.2.3.4', 's', 3, 60_000, T0)
    expect(consume('5.6.7.8', 's', 3, 60_000, T0).ok).toBe(true)
  })

  it('never returns retryAfter of 0', () => {
    // Retry-After: 0 invites an immediate retry that also fails, which is a busy loop
    // rather than a rate limit.
    for (let i = 0; i < 2; i++) consume('1.2.3.4', 's', 2, 60_000, T0)
    const v = consume('1.2.3.4', 's', 2, 60_000, T0 + 59_999)
    expect(v.ok).toBe(false)
    expect(!v.ok && v.retryAfter).toBeGreaterThanOrEqual(1)
  })
})

describe('clientKey', () => {
  const original = process.env.TRUST_PROXY
  afterEach(() => {
    if (original === undefined) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = original
  })

  describe('behind a proxy (TRUST_PROXY=true)', () => {
    beforeEach(() => { process.env.TRUST_PROXY = 'true' })

    it('prefers the first x-forwarded-for hop', () => {
      // The socket address is the proxy's, so limiting on it would treat every customer as
      // one caller. The *first* entry is the one the outermost proxy wrote; anything after
      // it is whatever the client sent.
      expect(clientKey({ headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } })).toBe('9.9.9.9')
    })

    it('handles the header arriving as an array', () => {
      expect(clientKey({ headers: { 'x-forwarded-for': ['9.9.9.9'] } })).toBe('9.9.9.9')
    })

    it('falls back to the socket address when the header is empty', () => {
      expect(clientKey({
        headers: { 'x-forwarded-for': '  ' }, socket: { remoteAddress: '127.0.0.1' },
      })).toBe('127.0.0.1')
    })
  })

  describe('exposed directly (the default)', () => {
    beforeEach(() => { delete process.env.TRUST_PROXY })

    it('ignores x-forwarded-for entirely', () => {
      // The attack the default exists to stop: one forged header per request gives every
      // request its own bucket, which voids every limit in the application silently.
      expect(clientKey({
        headers: { 'x-forwarded-for': '1.2.3.4' },
        socket: { remoteAddress: '203.0.113.9' },
      })).toBe('203.0.113.9')
    })

    it('is not fooled by the header arriving as an array either', () => {
      expect(clientKey({
        headers: { 'x-forwarded-for': ['1.2.3.4', '5.6.7.8'] },
        socket: { remoteAddress: '203.0.113.9' },
      })).toBe('203.0.113.9')
    })

    it('does not treat "false" as truthy', () => {
      process.env.TRUST_PROXY = 'false'
      expect(clientKey({
        headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '203.0.113.9' },
      })).toBe('203.0.113.9')
    })
  })

  /**
   * The case that makes limits on login and checkout mean anything.
   *
   * Those routes are called from the Next server, not the browser, so without a forwarded
   * identity every customer shares one bucket and the limit becomes a cap on the shop.
   */
  describe('forwarded from our own storefront', () => {
    const originalSecret = process.env.INTERNAL_API_SECRET
    beforeEach(() => { process.env.INTERNAL_API_SECRET = 'shh' })
    afterEach(() => {
      if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET
      else process.env.INTERNAL_API_SECRET = originalSecret
    })

    it('believes x-client-ip when the secret checks out', () => {
      expect(clientKey({
        headers: { 'x-internal-secret': 'shh', 'x-client-ip': '198.51.100.7' },
        socket: { remoteAddress: '10.0.0.5' },
      })).toBe('198.51.100.7')
    })

    it('ignores it without the secret — otherwise anyone could claim any address', () => {
      expect(clientKey({
        headers: { 'x-client-ip': '198.51.100.7' },
        socket: { remoteAddress: '10.0.0.5' },
      })).toBe('10.0.0.5')
    })

    it('ignores it when the secret is wrong', () => {
      expect(clientKey({
        headers: { 'x-internal-secret': 'wrong', 'x-client-ip': '198.51.100.7' },
        socket: { remoteAddress: '10.0.0.5' },
      })).toBe('10.0.0.5')
    })

    it('is not fooled by a prefix of the secret', () => {
      // timingSafeEqual throws on a length mismatch, so the length check has to come first.
      expect(() => clientKey({
        headers: { 'x-internal-secret': 's', 'x-client-ip': '198.51.100.7' },
        socket: { remoteAddress: '10.0.0.5' },
      })).not.toThrow()
      expect(clientKey({
        headers: { 'x-internal-secret': 's', 'x-client-ip': '1.1.1.1' },
        socket: { remoteAddress: '10.0.0.5' },
      })).toBe('10.0.0.5')
    })

    it('takes the first entry, so a client cannot append its own', () => {
      expect(clientKey({
        headers: { 'x-internal-secret': 'shh', 'x-client-ip': '198.51.100.7, 1.2.3.4' },
      })).toBe('198.51.100.7')
    })

    it('falls back when the storefront has no address to forward', () => {
      // A background revalidation has no customer. One bucket for those is correct.
      expect(clientKey({
        headers: { 'x-internal-secret': 'shh' }, socket: { remoteAddress: '10.0.0.5' },
      })).toBe('10.0.0.5')
    })

    it('wins over x-forwarded-for, which the proxy in front of us controls', () => {
      process.env.TRUST_PROXY = 'true'
      expect(clientKey({
        headers: {
          'x-internal-secret': 'shh',
          'x-client-ip': '198.51.100.7',
          'x-forwarded-for': '10.0.0.5',
        },
      })).toBe('198.51.100.7')
    })
  })

  describe('with no internal secret configured', () => {
    const originalSecret = process.env.INTERNAL_API_SECRET
    beforeEach(() => { delete process.env.INTERNAL_API_SECRET })
    afterEach(() => {
      if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET
      else process.env.INTERNAL_API_SECRET = originalSecret
    })

    it('ignores the forwarding entirely', () => {
      expect(clientKey({
        headers: { 'x-internal-secret': '', 'x-client-ip': '198.51.100.7' },
        socket: { remoteAddress: '10.0.0.5' },
      })).toBe('10.0.0.5')
    })
  })

  it('falls back to the socket address', () => {
    expect(clientKey({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1')
  })

  it('never returns empty, which would make every caller one bucket', () => {
    expect(clientKey({ headers: {} })).toBe('unknown')
  })
})

describe('limited', () => {
  const mkRes = () => {
    const headers: Record<string, string> = {}
    const out: any = {
      status: 0, body: null as unknown,
      setHeader: (k: string, v: string) => { headers[k] = v },
      headers,
    }
    out.status = (code: number) => { out.code = code; return out }
    out.json = (b: unknown) => { out.body = b; return out }
    return out
  }

  it('passes the request through and sets the remaining header', async () => {
    const res = mkRes()
    expect(await limited({ headers: {} }, res, 's', 2, 60_000)).toBe(false)
    expect(res.headers['X-RateLimit-Remaining']).toBe('1')
  })

  it('answers 429 with Retry-After once the budget is gone', async () => {
    const req = { headers: { 'x-forwarded-for': '1.1.1.1' } }
    const first = mkRes()
    await limited(req, first, 's', 1, 60_000)
    const second = mkRes()
    expect(await limited(req, second, 's', 1, 60_000)).toBe(true)
    expect(second.code).toBe(429)
    expect(Number(second.headers['Retry-After'])).toBeGreaterThanOrEqual(1)
  })
})

/**
 * The shared counter, under test, is the local one.
 *
 * NODE_ENV=test excludes Redis deliberately — see `redis()` in src/rate-limit.ts, and the
 * same exclusion in medusa-config.ts. A shared counter would make these suites
 * order-dependent, because `__reset()` clears a local map and not somebody else's Redis.
 * What is worth asserting here is that the exclusion *degrades* rather than disables: the
 * caller still gets a verdict from a real limiter.
 */
describe('consumeShared', () => {
  it('still enforces a budget with no Redis to talk to', async () => {
    expect((await consumeShared('1.2.3.4', 'shared', 2, 60_000)).ok).toBe(true)
    expect((await consumeShared('1.2.3.4', 'shared', 2, 60_000)).ok).toBe(true)
    expect((await consumeShared('1.2.3.4', 'shared', 2, 60_000)).ok).toBe(false)
  })

  it('keeps callers apart, so the fallback is a limit and not a global cap', async () => {
    await consumeShared('a', 'shared', 1, 60_000)
    expect((await consumeShared('b', 'shared', 1, 60_000)).ok).toBe(true)
  })
})

describe('rateLimit middleware', () => {
  const mkRes = () => {
    const headers: Record<string, string> = {}
    const out: any = { headers, setHeader: (k: string, v: string) => { headers[k] = v } }
    out.status = (code: number) => { out.code = code; return out }
    out.json = (b: unknown) => { out.body = b; return out }
    return out
  }

  it('calls next while the budget lasts', async () => {
    const next = jest.fn()
    await rateLimit('mw', 2, 60_000)({ headers: {} }, mkRes(), next)
    expect(next).toHaveBeenCalled()
  })

  it('answers 429 and does NOT call next once the budget is gone', async () => {
    const req = { headers: {}, socket: { remoteAddress: '5.5.5.5' } }
    await rateLimit('mw2', 1, 60_000)(req, mkRes(), jest.fn())

    const next = jest.fn()
    const res = mkRes()
    await rateLimit('mw2', 1, 60_000)(req, res, next)

    expect(res.code).toBe(429)
    // The whole point of a middleware: the handler behind it must not run.
    expect(next).not.toHaveBeenCalled()
  })

  it('lets the request through if the limiter itself fails', async () => {
    // A limiter that 500s the checkout is worse than the attack it was guarding against.
    const next = jest.fn()
    const res = mkRes()
    res.setHeader = () => { throw new Error('boom') }
    await rateLimit('mw3', 5, 60_000)({ headers: {} }, res, next)
    expect(next).toHaveBeenCalled()
  })
})
