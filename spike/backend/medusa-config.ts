import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

// Risk #19 in research.md §11. The spike measured this: with STRIPE_WEBHOOK_SECRET unset,
// /hooks/payment/stripe_stripe returns HTTP 200 to unsigned and forged payloads. Relying
// on remembering to set it is not a control, so refuse to boot without it in production.
//
// Note "in production", not "outside development" — the first version used the latter and
// broke the integration suite, which runs as NODE_ENV=test. A guard that blocks CI is a
// guard somebody deletes.
const isProduction = (process.env.NODE_ENV || 'development') === 'production'

type WorkerMode = 'shared' | 'server' | 'worker'

const workerMode: WorkerMode = (() => {
  const value = process.env.MEDUSA_WORKER_MODE ?? 'shared'

  if (value !== 'shared' && value !== 'server' && value !== 'worker') {
    throw new Error(
      `MEDUSA_WORKER_MODE must be shared, server, or worker; received "${value}".`
    )
  }

  return value
})()

if (isProduction && !process.env.STRIPE_WEBHOOK_SECRET) {
  throw new Error(
    'STRIPE_WEBHOOK_SECRET is required outside development: without it the Stripe ' +
    'webhook endpoint accepts unsigned payloads. See research.md §5.2 rule 3.'
  )
}
if (!isProduction && !process.env.STRIPE_WEBHOOK_SECRET) {
  console.warn(
    '\n  \x1b[33m!\x1b[0m STRIPE_WEBHOOK_SECRET is not set — the webhook endpoint will ' +
    'accept unsigned payloads.\n    Fine locally, fatal in production. Run `stripe listen` ' +
    'and paste the whsec_… value into .env.\n'
  )
}

/**
 * Redis, registered as real modules rather than hoped for.
 *
 * `projectConfig.redisUrl` does **not** switch the event bus, workflow engine, cache or
 * lock provider — it configures the session store and little else. Without the four
 * registrations below Medusa installs the local implementations and says so at every boot:
 * "Local Event Bus installed. This is not recommended for production." The consequence is
 * not cosmetic. Subscribers run in-process, so a restart loses whatever was queued —
 * including the order-confirmation email for an order that has already been paid for.
 *
 * Registration is keyed off REDIS_URL rather than being unconditional, so a laptop without
 * Redis still boots. In production the same variable is `criticalInProduction` in
 * src/integrations.ts, so a production container without it now refuses to start instead of
 * quietly running the local bus.
 *
 * **Test is excluded deliberately.** The integration suite runs as NODE_ENV=test with
 * REDIS_URL pointing at the compose instance, and swapping the module topology underneath
 * 177 tests changes what they exercise and leaves ioredis handles open across jest
 * teardown. The suite asserts application behaviour, not transport; production is where
 * this matters and production is where it is on.
 */
const redisUrl = process.env.REDIS_URL
const useRedisModules = !!redisUrl && (process.env.NODE_ENV || 'development') !== 'test'

const redisModules = useRedisModules
  ? [
      { resolve: '@medusajs/medusa/event-bus-redis', options: { redisUrl } },
      { resolve: '@medusajs/medusa/cache-redis', options: { redisUrl } },
      { resolve: '@medusajs/medusa/workflow-engine-redis', options: { redis: { url: redisUrl } } },
      {
        resolve: '@medusajs/medusa/locking',
        options: {
          providers: [
            {
              resolve: '@medusajs/medusa/locking-redis',
              id: 'locking-redis',
              is_default: true,
              options: { redisUrl },
            },
          ],
        },
      },
    ]
  : []

if (isProduction && !redisUrl) {
  throw new Error(
    'REDIS_URL is required in production: without it Medusa installs the local event bus ' +
    'and workflow engine, jobs run in-process, and a restart drops queued work — order ' +
    'confirmation emails included. See src/integrations.ts.'
  )
}

/**
 * Role-based access control.
 *
 * On in production, off in development and test. Medusa resolves the flag as
 * environment > project config > default, so `MEDUSA_FF_RBAC` overrides this in either
 * direction — which is how you rehearse enforcement locally before it matters.
 *
 * Two things have to be true for it to do anything: the module below has to be registered so
 * `rbac_role` exists and is queryable, and the flag has to be on. Without the flag, every
 * `policies` block in src/api/middlewares.ts is inert — the router only wraps a handler with
 * the permission check when the flag is set.
 *
 * **Enabling it without roles locks everybody out**, because the check refuses a user with no
 * roles before it consults a single policy. `scripts/seed-rbac.ts` creates the roles and
 * assigns Owner; `/health/ready` refuses to report ready while RBAC is on and nobody holds an
 * owner role, so a production container in that state never enters rotation.
 */
const rbacEnabled = isProduction

module.exports = defineConfig({
  admin: {
    /**
     * Skip building and serving the admin dashboard.
     *
     * Not a feature flag — a memory one. The admin bundle is a Vite/rollup build, and it
     * was OOM-killed (exit 137) inside a 3.8 GB Docker Desktop default, right after
     * "Compiling frontend source". Capping V8's heap did not help: most of rollup's
     * footprint is native, so the JS heap limit is the wrong lever.
     *
     * So the image can be built in two shapes. `ADMIN_DISABLED=true` gives a server-only
     * image that builds anywhere; the default builds the dashboard in and needs a builder
     * with roughly 6 GB. CI has 16 GB and builds the full one, which is what ships.
     */
    disable: process.env.ADMIN_DISABLED === 'true',
  },
  featureFlags: {
    rbac: rbacEnabled,
  },
  projectConfig: {
    workerMode,
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || 'supersecret',
      cookieSecret: process.env.COOKIE_SECRET || 'supersecret',
    },
  },
  modules: [
    ...redisModules,
    {
      // Roles and policies. Registered unconditionally rather than behind the flag: the
      // tables should exist and migrate on every environment, so that turning enforcement on
      // is a restart rather than a migration.
      resolve: '@medusajs/medusa/rbac',
    },
    {
      resolve: '@medusajs/medusa/notification',
      options: {
        providers: [
          {
            resolve: './src/modules/resend',
            id: 'resend',
            options: {
              channels: ['email'],
              // Placeholders. RESEND_API_KEY is intentionally empty: the provider
              // renders and logs instead of sending, and refuses to boot without it
              // outside development.
              apiKey: process.env.RESEND_API_KEY,
              from: process.env.RESEND_FROM || 'orders@example.invalid',
              replyTo: process.env.RESEND_REPLY_TO || undefined,
              redirectTo: process.env.RESEND_REDIRECT_TO || undefined,
            },
          },
        ],
      },
    },
    {
      // Fulfilment. The rate card is live with no integration (it is our pricing, not a
      // carrier quote); label purchase degrades to a recorded intent without SHIPPO_API_KEY.
      resolve: '@medusajs/medusa/fulfillment',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/fulfillment-manual',
            id: 'manual',
          },
          {
            resolve: './src/modules/fulfillment-shippo',
            id: 'shippo',
            options: {
              apiKey: process.env.SHIPPO_API_KEY,
              itemWeightGrams: Number(process.env.ITEM_WEIGHT_GRAMS || 200),
              from: {
                name: process.env.SHIP_FROM_NAME,
                street1: process.env.SHIP_FROM_STREET,
                city: process.env.SHIP_FROM_CITY,
                state: process.env.SHIP_FROM_STATE,
                zip: process.env.SHIP_FROM_ZIP,
                country: process.env.SHIP_FROM_COUNTRY || 'US',
                phone: process.env.SHIP_FROM_PHONE,
              },
            },
          },
        ],
      },
    },
    {
      // Tax. The provider distinguishes "no nexus here" (correct zero) from "could not
      // calculate" (a defect stamped onto the tax line) — research.md §7.1.
      resolve: '@medusajs/medusa/tax',
      options: {
        providers: [
          {
            resolve: './src/modules/tax-stripe',
            id: 'stripe-tax',
            options: {
              apiKey: process.env.STRIPE_API_KEY,
              // Stripe Tax bills 0.5% of volume, so it stays off until switched on.
              enabled: process.env.STRIPE_TAX_ENABLED === 'true',
              // Economic nexus after Wayfair: typically $100k or 200 transactions into a
              // state. Add states here as thresholds are crossed; §7.1 has the table.
              nexusStates: (process.env.US_NEXUS_STATES || '')
                .split(',').map((s) => s.trim()).filter(Boolean),
              homeState: process.env.US_HOME_STATE || undefined,
            },
          },
        ],
      },
    },
    {
      // Derived taxonomy, regulatory fields and jersey requests. Real indexed columns,
      // because facets cannot be built on metadata (research.md §13.3).
      resolve: './src/modules/catalog',
    },
    {
      // Payments.
      //
      // research.md §5.1 recommended Stripe **Checkout Sessions**, which would have kept the
      // card fields on Stripe's own domain and the assessment at PCI SAQ A. That path is not
      // on offer: Medusa 2.18's provider is PaymentIntents plus Elements, so the fields are
      // an iframe served from our origin and the checkout page is in PCI scope — SAQ A-EP,
      // with requirements 6.4.3 (script inventory and integrity) and 11.6.1 (tamper
      // detection) becoming materially heavier. The CSP is written for A-EP accordingly.
      //
      // The functional argument for Checkout mostly evaporates anyway, because Medusa already
      // owns cart, tax, discounts, shipping and addresses. What is given up is Stripe-hosted
      // conversion tuning, Link, and Adaptive Pricing.
      resolve: '@medusajs/medusa/payment',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/payment-stripe',
            id: 'stripe',
            options: {
              apiKey: process.env.STRIPE_API_KEY,
              // Medusa verifies the Stripe signature against this before acting on any
              // event. Without it the webhook endpoint is unauthenticated — research.md
              // §5.2 rule 3.
              webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
            },
          },
        ],
      },
    },
  ],
})
