/**
 * Boot hook.
 *
 * Medusa imports this file and calls `register()` once, at the top of `medusa start`,
 * before the HTTP server is created (`@medusajs/medusa/dist/commands/start.js`, in
 * `internalStart`). The call is awaited and not wrapped in a try/catch, so anything thrown
 * here aborts the boot — which is exactly the property the fail-closed rule needs.
 *
 * Two things happen, in this order:
 *
 *  1. **`assertConfigured()` runs.** This is the wiring that was missing. The function has
 *     always existed in `src/integrations.ts`, documented at length and tested around, and
 *     was called from nowhere — so `criticalInProduction: true` changed one number on the
 *     admin dashboard and nothing else. A production container would start with no Stripe
 *     Tax and no Shippo and begin taking orders with tax uncalculated and no way to buy a
 *     label. It now refuses.
 *
 *  2. **OpenTelemetry is registered, if an endpoint is configured.** Optional, and silent
 *     when it is not.
 *
 * Why here rather than in `medusa-config.ts`, which is where the existing
 * STRIPE_WEBHOOK_SECRET guard lives: the config file is evaluated by `medusa build`, by
 * `medusa db:migrate` and by every other CLI command. A guard there would mean migrations
 * could not be run against production without every runtime key present, which is both
 * wrong and the kind of friction that gets a guard deleted. `register()` runs on server
 * start and nowhere else.
 *
 * Note this is compiled into the build output alongside `src/`, so the relative import
 * below resolves in `.medusa/server` exactly as it does in development.
 */
import { assertConfigured } from './src/integrations'

/**
 * `assertConfigured` wants somewhere to put the non-fatal warning. There is no container
 * at this point in boot — Medusa builds one for its own logger and does not hand it over —
 * so this writes to stderr in the same shape the rest of the boot output uses.
 */
const bootLogger = {
  warn: (m: string) => console.warn(`\x1b[33m${m}\x1b[0m`),
}

export function register() {
  assertConfigured(bootLogger)
  registerOtel()
}

/**
 * OpenTelemetry, when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
 *
 * The exporter and SDK packages are **not** dependencies of `@medusajs/medusa` — its own
 * docs say to install them into the application — so they are absent from the production
 * image unless somebody adds them:
 *
 *   npm i @opentelemetry/sdk-node @opentelemetry/resources @opentelemetry/sdk-trace-node \
 *         @opentelemetry/instrumentation @opentelemetry/instrumentation-pg \
 *         @opentelemetry/exporter-trace-otlp-http
 *
 * That is why this is a guarded `require` rather than a top-level `import`. Tracing is a
 * diagnostic, and a missing diagnostic must not be able to stop a container that is
 * otherwise correctly configured — the opposite call from the one made about Stripe above,
 * and for the opposite reason. It says so on the way past rather than failing quietly.
 */
function registerOtel() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) return

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerOtel: register } = require('@medusajs/medusa')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http')

    register({
      serviceName: process.env.OTEL_SERVICE_NAME || 'findanyjersey-backend',
      exporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
      instrument: { http: true, workflows: true, query: true, db: true, cache: true },
    })
  } catch (e) {
    console.warn(
      `  ! OTEL_EXPORTER_OTLP_ENDPOINT is set but tracing could not start: ` +
      `${(e as Error).message}. Install the OpenTelemetry packages listed in ` +
      `instrumentation.ts, or unset the variable.`
    )
  }
}
