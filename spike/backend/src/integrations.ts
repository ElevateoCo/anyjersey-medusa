/**
 * External service configuration, in one place.
 *
 * Every integration here is keyed off an environment variable that is intentionally
 * empty in this spike. The rule is the same for all of them and it matters:
 *
 *   - **Outside production** → the feature degrades visibly. It logs what it would have
 *     done and carries on. Nothing silently no-ops.
 *   - **In production** → `assertConfigured()` throws at boot. A missing key that
 *     silently disables order confirmations, tax calculation or fraud screening is worse
 *     than a container that refuses to start.
 *
 * `assertConfigured()` is called from `instrumentation.ts`, which Medusa invokes at the top
 * of `medusa start`. It spent the first version of this file being called from nowhere, so
 * the rule below was documentation rather than a control: `criticalInProduction: true`
 * changed a number on the admin dashboard and nothing else, and production would have
 * started happily with no Stripe Tax and no Shippo. Two module constructors guarding
 * themselves — Stripe's webhook secret in medusa-config.ts, Resend's key in its own
 * constructor — is what made the gap invisible, because boot *did* fail without those two.
 *
 * The predicate is `NODE_ENV === 'production'`, not `!== 'development'`. The first version
 * checked the latter and broke the integration suite, which runs as NODE_ENV=test — a test
 * environment is not production, and a guard that blocks CI is a guard people delete.
 *
 * research.md §4 lists why each of these was chosen.
 */
export type Integration = {
  key: string
  name: string
  env: string[]
  /**
   * Required before taking real orders in production.
   *
   * A predicate rather than a plain boolean, because one of these is conditional and
   * pretending otherwise is what made the whole registry decorative. Cloudflare R2 was
   * flagged `true` while `MEDIA_BACKEND` defaulted to Postgres and no code read the
   * `R2_*` variables at all — so switching the boot guard on would have refused to start
   * a correctly configured container over four keys nothing wanted. Criticality has to
   * follow the configuration, not a constant written down once.
   */
  criticalInProduction: boolean | (() => boolean)
  purpose: string
  docs: string
}

/**
 * Where product image bytes live. **This is the value R2's criticality reads**, and it is
 * read by `src/media-store.ts` too, so the flag now means something.
 *
 * `postgres` (the default) keeps the WebP originals in the `media_asset` table — measured
 * at ~410 MB for the whole catalogue, content-addressed and served immutable. `r2` moves
 * them to object storage. research.md §13.2 and the header of media-store.ts have the
 * trade; the number that should decide it is restore time, which nobody has measured yet.
 */
export type MediaBackend = 'postgres' | 'r2'
export const mediaBackend = (): MediaBackend =>
  process.env.MEDIA_BACKEND === 'r2' ? 'r2' : 'postgres'

export const INTEGRATIONS: Integration[] = [
  {
    key: 'stripe', name: 'Stripe', env: ['STRIPE_API_KEY', 'STRIPE_WEBHOOK_SECRET'],
    criticalInProduction: true,
    purpose: 'Payments. Without it there is no checkout.',
    docs: 'https://dashboard.stripe.com/apikeys',
  },
  {
    key: 'resend', name: 'Resend', env: ['RESEND_API_KEY'],
    criticalInProduction: true,
    purpose: 'Transactional email — order confirmations, request acknowledgements.',
    docs: 'https://resend.com/api-keys',
  },
  {
    key: 'stripe_tax', name: 'Stripe Tax', env: ['STRIPE_TAX_ENABLED'],
    criticalInProduction: true,
    purpose: 'US nexus and EU/UK import VAT. research.md §7.1, §7.2.',
    docs: 'https://dashboard.stripe.com/tax',
  },
  {
    key: 'shipping', name: 'Shippo', env: ['SHIPPO_API_KEY'],
    criticalInProduction: true,
    purpose: 'Rates, labels, tracking, customs docs. research.md §14.',
    docs: 'https://apps.goshippo.com/settings/api',
  },
  {
    // Not an API in the sense the others are, but it belongs in the same registry for the
    // same reason: without it Medusa installs the *local* event bus, workflow engine, cache
    // and lock provider, announces "not recommended for production" at every boot, and runs
    // jobs in-process — so a restart drops queued work, order confirmation emails included.
    // Setting projectConfig.redisUrl does not switch them; medusa-config.ts registers the
    // modules explicitly off this variable.
    key: 'redis', name: 'Redis', env: ['REDIS_URL'],
    criticalInProduction: true,
    purpose: 'Event bus, workflow engine, cache and distributed locks.',
    docs: 'https://docs.medusajs.com/resources/architectural-modules/event/redis',
  },
  {
    // Not a service either, and here for the same reason Redis is: a question that must be
    // answered before the app faces the internet. `TRUST_PROXY` decides whether
    // `x-forwarded-for` is believed, and getting it wrong in the permissive direction voids
    // every rate limit in the application silently. Either value is fine; not choosing is not.
    key: 'proxy', name: 'Proxy trust', env: ['TRUST_PROXY'],
    criticalInProduction: true,
    purpose: 'Whether x-forwarded-for is trusted for rate limiting. "true" or "false".',
    docs: 'https://expressjs.com/en/guide/behind-proxies.html',
  },
  {
    // The other half of the same question, and the more consequential half.
    //
    // Most of this storefront's backend traffic is made server-side — every cart mutation,
    // the whole of checkout, and every auth call, because the session token is httpOnly and
    // never reaches the browser (storefront lib/account.ts). Those requests all arrive from
    // one address, so without a forwarded identity a limit on login or cart completion is a
    // *global* cap: eleven logins a minute for the entire shop.
    //
    // This secret is what lets the storefront say whose request it is. Missing, the
    // forwarding is ignored and those limits collapse onto the storefront's own address —
    // which is why it blocks a production boot rather than degrading quietly. Generate with
    // `openssl rand -hex 32`; the storefront needs the same value, server-side only.
    key: 'internal', name: 'Internal request signing', env: ['INTERNAL_API_SECRET'],
    criticalInProduction: true,
    purpose:
      'Shared secret letting the storefront forward the end customer\'s IP for rate ' +
      'limiting. Must match the storefront\'s INTERNAL_API_SECRET.',
    docs: 'src/rate-limit.ts',
  },
  {
    key: 'search', name: 'Typesense', env: ['TYPESENSE_HOST', 'TYPESENSE_API_KEY'],
    criticalInProduction: false,
    purpose: 'Product search and native facet counts. Falls back to SQL ILIKE.',
    docs: 'https://cloud.typesense.org',
  },
  {
    key: 'analytics', name: 'PostHog', env: ['POSTHOG_API_KEY', 'POSTHOG_HOST'],
    criticalInProduction: false,
    purpose: 'Funnel and conversion. Revenue reporting is in-admin (§15.4).',
    docs: 'https://posthog.com/docs/api',
  },
  {
    key: 'marketing', name: 'Omnisend', env: ['OMNISEND_API_KEY'],
    criticalInProduction: false,
    purpose: 'Marketing email and abandoned-cart flows beyond the built-in one.',
    docs: 'https://app.omnisend.com/settings/api-keys',
  },
  {
    key: 'errors', name: 'Sentry', env: ['SENTRY_DSN'],
    criticalInProduction: false,
    purpose: 'Error tracking. You are the on-call rotation now (§8).',
    docs: 'https://sentry.io',
  },
  {
    key: 'media', name: 'Cloudflare R2', env: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID',
                                               'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'],
    // Critical only when it is the selected backend. Under the Postgres default the keys
    // are not merely optional, they are unused — so demanding them would be a false
    // requirement, and a boot guard that fails on a false requirement is one somebody
    // switches off. Set MEDIA_BACKEND=r2 and these four become blocking.
    criticalInProduction: () => mediaBackend() === 'r2',
    purpose: 'Product image storage. research.md §13.2.',
    docs: 'https://dash.cloudflare.com',
  },
]

/** Fail closed here and only here. Anything else — dev, test, CI — degrades visibly. */
export const isProduction = () => (process.env.NODE_ENV ?? 'development') === 'production'

export const isConfigured = (key: string): boolean => {
  const i = INTEGRATIONS.find((x) => x.key === key)
  return !!i && i.env.every((e) => !!process.env[e])
}

/** Criticality, with the predicate form resolved against the current environment. */
export const isCritical = (i: Integration): boolean =>
  typeof i.criticalInProduction === 'function'
    ? i.criticalInProduction()
    : i.criticalInProduction

export const missingEnv = (key: string): string[] => {
  const i = INTEGRATIONS.find((x) => x.key === key)
  return i ? i.env.filter((e) => !process.env[e]) : []
}

export function integrationStatus() {
  return INTEGRATIONS.map((i) => ({
    key: i.key,
    name: i.name,
    purpose: i.purpose,
    docs: i.docs,
    criticalInProduction: isCritical(i),
    configured: isConfigured(i.key),
    missing: missingEnv(i.key),
  }))
}

/** Called at boot. Refuses to start in production with a critical key missing. */
export function assertConfigured(logger: { warn: (m: string) => void }) {
  const broken = INTEGRATIONS.filter((i) => !isConfigured(i.key))
  if (!broken.length) return

  if (isProduction()) {
    const critical = broken.filter(isCritical)
    if (critical.length) {
      throw new Error(
        'Missing required configuration: ' +
        critical.map((i) => `${i.name} (${missingEnv(i.key).join(', ')})`).join('; ') +
        '. Refusing to start — a silently disabled integration is worse than a failed boot.'
      )
    }
  }
  logger.warn(
    `  ! ${broken.length} integration(s) not configured: ` +
    broken.map((i) => i.name).join(', ') +
    ' — see /admin/integrations'
  )
}
