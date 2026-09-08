import {
  INTEGRATIONS, assertConfigured, integrationStatus, isCritical, mediaBackend,
} from '../integrations'

/**
 * The boot guard, which spent this project's whole life being exported and never called.
 *
 * These tests exist because the failure mode was invisible: two module constructors happen
 * to guard themselves (Stripe's webhook secret, Resend's key), so boot *did* fail without
 * those two and the system looked as though the rule was in force. It was not. What is
 * asserted here is the rule itself — that production refuses to start on a missing critical
 * key, that everything else only warns, and that "critical" tracks the configuration rather
 * than a constant somebody wrote down once.
 */
const CRITICAL_ENV = [
  'STRIPE_API_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY', 'STRIPE_TAX_ENABLED',
  'SHIPPO_API_KEY', 'REDIS_URL', 'TRUST_PROXY', 'INTERNAL_API_SECRET',
]

describe('integration registry', () => {
  const original = { ...process.env }
  const logger = { warn: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('R2_') || CRITICAL_ENV.includes(k)) delete process.env[k]
    }
    delete process.env.MEDIA_BACKEND
    process.env.NODE_ENV = 'test'
  })

  afterAll(() => { process.env = original })

  const satisfyCritical = () => {
    for (const e of CRITICAL_ENV) process.env[e] = 'set'
  }

  it('refuses to start in production when a critical key is missing', () => {
    process.env.NODE_ENV = 'production'
    expect(() => assertConfigured(logger)).toThrow(/Refusing to start/)
  })

  it('names every missing critical integration, not just the first', () => {
    process.env.NODE_ENV = 'production'
    process.env.STRIPE_API_KEY = 'sk_test'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec'
    try {
      assertConfigured(logger)
      throw new Error('should have thrown')
    } catch (e) {
      const m = (e as Error).message
      expect(m).toContain('Resend')
      expect(m).toContain('Shippo')
      expect(m).toContain('Redis')
      // The variable names are in the message because "Shippo is missing" without them
      // sends whoever is on call to a dashboard rather than to an env file.
      expect(m).toContain('SHIPPO_API_KEY')
    }
  })

  it('warns rather than throws outside production', () => {
    assertConfigured(logger)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toContain('not configured')
  })

  it('starts silently in production once every critical key is present', () => {
    process.env.NODE_ENV = 'production'
    satisfyCritical()
    // Optional integrations are still unset, so it warns — and does not throw.
    expect(() => assertConfigured(logger)).not.toThrow()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  describe('R2 criticality follows MEDIA_BACKEND', () => {
    const media = () => INTEGRATIONS.find((i) => i.key === 'media')!

    it('is not critical under the Postgres default', () => {
      expect(mediaBackend()).toBe('postgres')
      expect(isCritical(media())).toBe(false)
    })

    it('is critical once R2 is the selected backend', () => {
      process.env.MEDIA_BACKEND = 'r2'
      expect(mediaBackend()).toBe('r2')
      expect(isCritical(media())).toBe(true)
    })

    it('blocks a production boot when R2 is selected and unconfigured', () => {
      process.env.NODE_ENV = 'production'
      satisfyCritical()
      process.env.MEDIA_BACKEND = 'r2'
      expect(() => assertConfigured(logger)).toThrow(/Cloudflare R2/)
    })

    it('does not block that same boot under the Postgres default', () => {
      process.env.NODE_ENV = 'production'
      satisfyCritical()
      expect(() => assertConfigured(logger)).not.toThrow()
    })
  })

  it('reports criticality to the dashboard as a resolved boolean', () => {
    const row = integrationStatus().find((i) => i.key === 'media')!
    expect(typeof row.criticalInProduction).toBe('boolean')
    expect(row.criticalInProduction).toBe(false)
  })

  it('lists every critical env var it claims to need', () => {
    const declared = INTEGRATIONS.filter(isCritical).flatMap((i) => i.env)
    // Guards against an integration being marked critical with an empty env list, which
    // would make it permanently "configured" and silently exempt from the boot guard.
    for (const i of INTEGRATIONS) {
      if (isCritical(i)) expect(i.env.length).toBeGreaterThan(0)
    }
    expect(declared).toEqual(expect.arrayContaining(CRITICAL_ENV))
  })
})
