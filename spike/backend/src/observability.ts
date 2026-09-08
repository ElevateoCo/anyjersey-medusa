import { createHash, randomUUID } from 'crypto'

/**
 * Error reporting, without a dependency.
 *
 * Sentry's ingest API takes a newline-delimited envelope over plain HTTP, and the DSN
 * carries everything needed to address it. So this is a `fetch`, not `@sentry/node` — which
 * matters for three reasons:
 *
 *   - the SDK monkey-patches http, async_hooks and the module loader at import time, and
 *     Medusa's worker/server split plus its own OTel hooks are exactly where that goes
 *     wrong;
 *   - `SENTRY_DSN` is a placeholder, so a hard dependency would be dead weight until an
 *     account exists;
 *   - with no DSN this still does the useful half — structured, deduplicated error logging
 *     — instead of nothing.
 *
 * What it deliberately does not do is capture breadcrumbs, profiles or traces. If those are
 * wanted later, that is the point to take the SDK and its constraints on purpose.
 */
type Dsn = { host: string; projectId: string; publicKey: string; protocol: string }

export function parseDsn(dsn?: string): Dsn | null {
  if (!dsn) return null
  // https://<publicKey>@<host>/<projectId>
  const m = dsn.match(/^(https?):\/\/([^@]+)@([^/]+)\/(.+)$/)
  if (!m) return null
  return { protocol: m[1], publicKey: m[2], host: m[3], projectId: m[4] }
}

/**
 * Values that must never leave the process.
 *
 * An error's context is where secrets leak: a failed Stripe call carries the key in its
 * request config, a failed database call carries the connection string. Scrubbing is by
 * key name and by value shape, because either alone misses cases — a key called `token`
 * with a redacted value, and a key called `note` containing an `sk_live_…`.
 */
const SECRET_KEYS = /pass|secret|token|key|auth|cookie|session|card|cvc|dsn/i
const SECRET_VALUES = [
  /\bsk_(live|test)_[A-Za-z0-9]{10,}/g,     // Stripe secret keys
  /\bwhsec_[A-Za-z0-9]{10,}/g,             // Stripe webhook secrets
  /\bre_[A-Za-z0-9]{10,}/g,                // Resend
  /\bshippo_(live|test)_[A-Za-z0-9]{10,}/g,
  /postgres(ql)?:\/\/[^\s"']+/g,           // connection strings, credentials and all
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // customer email — GDPR §7.4
  /\b\d{13,19}\b/g,                        // anything card-shaped; PCI 3.4
]

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]'
  if (typeof value === 'string') {
    return SECRET_VALUES.reduce((s, re) => s.replace(re, '[redacted]'), value)
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? '[redacted]' : scrub(v, depth + 1)
    }
    return out
  }
  return value
}

/**
 * Group key for an error.
 *
 * Sentry groups by stack trace, which means one bad deploy can open thousands of issues for
 * one bug. Fingerprinting on the message with volatile parts removed — ids, numbers, quoted
 * strings — collapses those into one, and is also what makes the no-DSN path readable.
 */
export function fingerprint(err: Error): string {
  const shape = `${err.name}:${err.message}`
    // Medusa ids are prefix_ULID (26 chars), but ids elsewhere are shorter, and requiring
    // 20+ meant two occurrences of the same bug landed in different groups.
    .replace(/\b[a-z]{2,12}_[0-9A-Za-z]{6,}\b/g, '<id>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<uuid>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/'[^']*'|"[^"]*"/g, '<str>')
  return createHash('sha1').update(shape).digest('hex').slice(0, 12)
}

const seen = new Map<string, number>()

export type ReportContext = {
  route?: string
  method?: string
  requestId?: string
  extra?: Record<string, unknown>
}

/**
 * Report an error. Never throws, never blocks the response.
 *
 * A reporter that can fail the request it is reporting on turns one error into two, so
 * every failure path here ends in a log line and nothing more.
 */
export async function reportError(
  err: Error,
  ctx: ReportContext = {},
  logger?: { error: (m: string) => void; warn: (m: string) => void }
): Promise<void> {
  const fp = fingerprint(err)
  const count = (seen.get(fp) ?? 0) + 1
  seen.set(fp, count)
  if (seen.size > 1000) seen.clear() // bounded; this is a counter, not a store

  const dsn = parseDsn(process.env.SENTRY_DSN)
  const line =
    `[error] ${fp} x${count} ${err.name}: ${err.message}` +
    (ctx.route ? ` (${ctx.method ?? 'GET'} ${ctx.route})` : '')

  if (!dsn) {
    // The useful half, with no account: grouped, counted, scrubbed.
    logger?.error(line)
    if (count === 1 && err.stack) logger?.error(String(scrub(err.stack)))
    return
  }

  const event = {
    event_id: randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: 'error',
    logger: 'medusa',
    environment: process.env.NODE_ENV || 'development',
    release: process.env.GIT_SHA || undefined,
    server_name: process.env.HOSTNAME || undefined,
    fingerprint: [fp],
    transaction: ctx.route,
    exception: {
      values: [{
        type: err.name,
        value: String(scrub(err.message)),
        stacktrace: err.stack ? { frames: [] } : undefined,
      }],
    },
    // The raw stack goes in extra rather than being parsed into frames: parsing stacks
        // correctly is the SDK's job, and a wrong parse loses the stack entirely.
    extra: scrub({ stack: err.stack, ...ctx.extra }) as Record<string, unknown>,
    tags: { route: ctx.route, method: ctx.method, request_id: ctx.requestId },
  }

  const envelope =
    `${JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() })}\n` +
    `${JSON.stringify({ type: 'event' })}\n` +
    `${JSON.stringify(event)}\n`

  try {
    const res = await fetch(
      `${dsn.protocol}://${dsn.host}/api/${dsn.projectId}/envelope/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth':
            `Sentry sentry_version=7, sentry_client=anyjersey/1.0, sentry_key=${dsn.publicKey}`,
        },
        body: envelope,
        // Reporting must not outlive the request it describes.
        signal: AbortSignal.timeout(3000),
      }
    )
    if (!res.ok) logger?.warn(`[error] sentry ingest ${res.status}; kept locally: ${line}`)
  } catch (e) {
    logger?.warn(`[error] sentry unreachable (${(e as Error).message}); kept locally: ${line}`)
  }
}

/** Test seam. */
export const __resetSeen = () => seen.clear()
