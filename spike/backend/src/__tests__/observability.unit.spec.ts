import { parseDsn, scrub, fingerprint, reportError, __resetSeen } from '../observability'

const logger = { error: jest.fn(), warn: jest.fn() }

beforeEach(() => { jest.clearAllMocks(); __resetSeen(); delete process.env.SENTRY_DSN })

describe('parseDsn', () => {
  it('pulls the pieces out of a real DSN', () => {
    expect(parseDsn('https://abc123@o42.ingest.sentry.io/4507')).toEqual({
      protocol: 'https', publicKey: 'abc123', host: 'o42.ingest.sentry.io', projectId: '4507',
    })
  })

  it('returns null for absent or malformed input rather than throwing', () => {
    for (const v of [undefined, '', 'not-a-dsn', 'https://no-key.example.com/1']) {
      expect(parseDsn(v as any)).toBeNull()
    }
  })
})

describe('scrub', () => {
  it('redacts by key name', () => {
    const out = scrub({ apiKey: 'sk_live_x', password: 'hunter2', title: 'Brazil jersey' }) as any
    expect(out.apiKey).toBe('[redacted]')
    expect(out.password).toBe('[redacted]')
    expect(out.title).toBe('Brazil jersey')
  })

  it('redacts by value shape, for keys that look innocent', () => {
    // The case key-name scrubbing misses: a secret pasted into a free-text field.
    const out = scrub({ note: 'failed with sk_live_51H8xQrABCDEFghij using whsec_abcdefghij' }) as any
    expect(out.note).not.toMatch(/sk_live_51H8/)
    expect(out.note).not.toMatch(/whsec_abcdef/)
  })

  it('redacts a connection string with its credentials', () => {
    const out = scrub('knex: postgres://aj:hunter2@db:5432/aj_store timed out') as string
    expect(out).not.toContain('hunter2')
    expect(out).toContain('[redacted]')
  })

  it('redacts customer email and anything card-shaped', () => {
    const out = scrub({ msg: 'order for buyer@example.com card 4242424242424242' }) as any
    expect(out.msg).not.toContain('buyer@example.com')
    expect(out.msg).not.toContain('4242424242424242')
  })

  it('recurses into nested objects and arrays', () => {
    const out = scrub({ a: [{ b: { stripeSecret: 'x' } }] }) as any
    expect(out.a[0].b.stripeSecret).toBe('[redacted]')
  })

  it('terminates on a cyclic structure', () => {
    const a: any = { name: 'a' }
    a.self = a
    expect(() => scrub(a)).not.toThrow()
  })
})

describe('fingerprint', () => {
  it('groups the same bug across different ids', () => {
    // Full-length Medusa ULIDs...
    expect(fingerprint(new Error('Cart cart_01M0JSWR5E1ANEFKDDSXW55Z2B not found')))
      .toBe(fingerprint(new Error('Cart cart_01K7ZZQ4B8MXPQRSTUVWXY9Z10 not found')))
    // ...and shorter ids, which an earlier pattern was too strict to catch.
    expect(fingerprint(new Error('Cart cart_01AAAA not found')))
      .toBe(fingerprint(new Error('Cart cart_01BBBB not found')))
  })

  it('groups across differing numbers and quoted strings', () => {
    expect(fingerprint(new Error("Variant 'M' is out of stock (3 left)")))
      .toBe(fingerprint(new Error("Variant 'XL' is out of stock (17 left)")))
  })

  it('keeps genuinely different bugs apart', () => {
    expect(fingerprint(new Error('Cart not found')))
      .not.toBe(fingerprint(new Error('Payment declined')))
  })

  it('distinguishes error types with the same message', () => {
    const a = new TypeError('boom'); const b = new RangeError('boom')
    expect(fingerprint(a)).not.toBe(fingerprint(b))
  })
})

describe('reportError with no DSN', () => {
  it('still logs, grouped and counted', async () => {
    await reportError(new Error('Cart cart_01AAAA not found'), { route: '/store/carts' }, logger)
    await reportError(new Error('Cart cart_01BBBB not found'), { route: '/store/carts' }, logger)
    const lines = logger.error.mock.calls.map((c) => c[0]).filter((l) => l.startsWith('[error]'))
    expect(lines[0]).toMatch(/x1/)
    expect(lines[1]).toMatch(/x2/)
  })

  it('logs the stack once per group, not once per occurrence', async () => {
    for (let i = 0; i < 4; i++) await reportError(new Error('same failure'), {}, logger)
    const stacks = logger.error.mock.calls.filter((c) => String(c[0]).includes('at '))
    expect(stacks).toHaveLength(1)
  })

  it('does not make a network call', async () => {
    const spy = jest.spyOn(global, 'fetch' as any)
    await reportError(new Error('x'), {}, logger)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('reportError with a DSN', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  beforeEach(() => {
    process.env.SENTRY_DSN = 'https://pub123@o1.ingest.sentry.io/999'
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as any
  })

  it('posts an envelope to the address the DSN describes', async () => {
    await reportError(new Error('boom'), { route: '/store/carts', method: 'POST' }, logger)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://o1.ingest.sentry.io/api/999/envelope/')
    expect(init.headers['X-Sentry-Auth']).toContain('sentry_key=pub123')
    const [header, itemHeader, event] = String(init.body).trim().split('\n').map((l: string) => JSON.parse(l))
    expect(header.event_id).toHaveLength(32)
    expect(itemHeader.type).toBe('event')
    expect(event.transaction).toBe('/store/carts')
    expect(event.fingerprint).toHaveLength(1)
  })

  it('scrubs the payload it sends, not just what it logs', async () => {
    await reportError(
      new Error('stripe call failed for buyer@example.com'),
      { extra: { apiKey: 'sk_live_abcdefghijkl' } },
      logger
    )
    const body = String((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body).not.toContain('buyer@example.com')
    expect(body).not.toContain('sk_live_abcdefghijkl')
  })

  it('swallows an ingest failure instead of turning one error into two', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ENOTFOUND')) as any
    await expect(reportError(new Error('boom'), {}, logger)).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('kept locally'))
  })

  it('reports a non-2xx ingest response without throwing', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 }) as any
    await reportError(new Error('boom'), {}, logger)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('429'))
  })

  it('gives up after 3 seconds rather than delaying the response', async () => {
    await reportError(new Error('boom'), {}, logger)
    expect((global.fetch as jest.Mock).mock.calls[0][1].signal).toBeDefined()
  })
})
