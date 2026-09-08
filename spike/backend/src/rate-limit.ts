import Redis from 'ioredis'
import { timingSafeEqual } from 'crypto'

/**
 * Rate limiting.
 *
 * The gap this started as was written down and left open: `/store/jersey-requests` is an
 * unauthenticated POST that writes a row, with nothing stopping a script from writing a
 * million of them. It has since grown two harder problems, and both are solved here rather
 * than in the routes.
 *
 * **1. The counter is shared.** The original note said the fix was Redis, deferred because
 * `ICacheService` exposes `get`, `set` and `invalidate` and no atomic increment — a counter
 * built on it is a read-modify-write with a race, and a limiter that undercounts precisely
 * when it is under load is worse than one whose ceiling is honestly stated. The note also
 * said what a correct version wants: `INCR`/`EXPIRE` against ioredis directly. That is what
 * `shared()` below does, in one round trip and one Lua script, so the budget is the budget
 * no matter how many instances are running.
 *
 * The in-process map stays, in two roles that are both deliberate: it is the limiter in
 * development and test, where there is no Redis to talk to, and it is the **fallback** when
 * Redis is unreachable. Falling back to a real local limit is strictly better than the usual
 * choice of failing open, and much better than failing closed — a Redis blip should not close
 * the shop.
 *
 * **2. The key has to be the customer, and usually is not.** See `clientKey`. Most of this
 * storefront's traffic reaches the backend from the Next server rather than from a browser,
 * so the socket address is the storefront's for every customer alike. A per-IP limit on those
 * routes is not a limit on an attacker, it is a global cap on the shop — the failure mode is
 * "checkout stops working for everyone at 11 requests a minute", and it arrives on the first
 * busy day. That is why the identity is forwarded and why the forwarding is authenticated.
 */
export type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** Reaped on write rather than on a timer: no interval to leak in tests. */
const sweep = (now: number) => {
  if (buckets.size < 2048) return
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
}

/**
 * Is there a proxy in front of us that rewrites `x-forwarded-for`?
 *
 * `TRUST_PROXY=true` says yes, and only then is the header believed. The default is **false**,
 * which is the safe direction: reading the socket address behind a proxy rate-limits every
 * customer as one — annoying, visible, and fixed by setting one variable. Believing a forged
 * header when there is no proxy silently voids every limit in the application, and nobody
 * finds out.
 *
 * `TRUST_PROXY` is `criticalInProduction` in src/integrations.ts, so a production container
 * cannot start without somebody having answered the question either way. That is the whole
 * point: the invariant now has to be stated, and stating it wrongly is a deliberate act
 * rather than an omission.
 */
export const trustsProxy = (): boolean => process.env.TRUST_PROXY === 'true'

/**
 * Does this request come from our own storefront, speaking for a named customer?
 *
 * `x-forwarded-for` cannot answer this. A proxy in front of the backend *overwrites* that
 * header — that is what makes it trustworthy — so anything the storefront puts there is gone
 * by the time it arrives. And the backend is directly reachable by browsers regardless: ten
 * `'use client'` components post to it with `NEXT_PUBLIC_MEDUSA_URL`. A header that any
 * caller can set is not an identity.
 *
 * So the storefront states the customer's address in `x-client-ip` and proves its right to do
 * so with `INTERNAL_API_SECRET`. Compared in constant time, and length-checked first, because
 * a byte-at-a-time comparison of a shared secret is exactly the thing timing attacks are for.
 *
 * With no secret configured the header is ignored completely. That degrades to limiting the
 * storefront as one caller — visible, and the same safe direction `TRUST_PROXY` defaults to.
 */
function internalCaller(headers: Record<string, unknown>): boolean {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) return false

  const raw = headers['x-internal-secret']
  const given = Buffer.from(Array.isArray(raw) ? raw[0] ?? '' : typeof raw === 'string' ? raw : '')
  const expected = Buffer.from(secret)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * Who is calling, for rate-limiting purposes.
 *
 * Three cases, in order, and the order is the security argument:
 *
 *  1. **Our storefront, on a customer's behalf.** Only if the shared secret checks out. This
 *     is what makes a limit on login, registration or cart completion mean anything at all —
 *     those calls are made server-side, so without it every customer shares one bucket.
 *  2. **Behind a proxy** (`TRUST_PROXY=true`). The client is the **first** entry in
 *     `x-forwarded-for` — the one the outermost proxy wrote. Later entries are whatever the
 *     client sent and are never trusted, which is why this reads `[0]` and not the last.
 *  3. **Directly exposed.** The socket address, and the headers are ignored entirely.
 */
export function clientKey(req: {
  headers: Record<string, unknown>
  ip?: string
  socket?: { remoteAddress?: string }
}): string {
  const direct = req.ip || req.socket?.remoteAddress || 'unknown'

  if (internalCaller(req.headers)) {
    const raw = req.headers['x-client-ip']
    const claimed = String(Array.isArray(raw) ? raw[0] ?? '' : typeof raw === 'string' ? raw : '')
      .split(',')[0]
      .trim()
    // A storefront that forwards nothing is a storefront serving a request it has no address
    // for — a background revalidation, say. One bucket for those is correct.
    if (claimed) return claimed
  }

  if (!trustsProxy()) return direct

  const fwd = req.headers['x-forwarded-for']
  const first = Array.isArray(fwd) ? fwd[0] : typeof fwd === 'string' ? fwd : ''
  return first.split(',')[0].trim() || direct
}

export type Verdict =
  | { ok: true; remaining: number }
  | { ok: false; retryAfter: number }

/**
 * The in-process counter: development, test, and the fallback when Redis is unreachable.
 *
 * @param key      caller identity, from `clientKey`
 * @param scope    the endpoint, so one limit cannot exhaust another
 * @param max      requests allowed per window
 * @param windowMs window length
 * @param now      injected for tests — never call Date.now() in the signature default,
 *                 because a default argument is evaluated per call and cannot be frozen
 */
export function consume(
  key: string,
  scope: string,
  max: number,
  windowMs: number,
  now: number = Date.now()
): Verdict {
  sweep(now)
  const id = `${scope}:${key}`
  const b = buckets.get(id)

  if (!b || b.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: max - 1 }
  }

  if (b.count >= max) {
    // Seconds, rounded up: `Retry-After: 0` invites an immediate retry that also fails.
    return { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) }
  }

  b.count += 1
  return { ok: true, remaining: max - b.count }
}

/**
 * Increment, set the expiry on first sight, and read the remaining time — atomically.
 *
 * One script rather than three commands because `INCR` then `EXPIRE` has a window in which a
 * crash between them leaves a key with no expiry, and that key then refuses a caller forever.
 * `PTTL` is in the same script so the `Retry-After` describes the window the count belongs to
 * and not a later one.
 *
 * A fixed window, matching `consume` exactly. A sliding window is more accurate at the seam
 * and costs a sorted set per caller; at this shop's volume the seam is not worth the memory,
 * and having the two backends disagree about what a budget means would be worse than either.
 */
const SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}
`

/**
 * Redis, or `null` when there deliberately is none.
 *
 * **Test is excluded on purpose**, mirroring medusa-config.ts: the integration suite runs as
 * NODE_ENV=test with `REDIS_URL` pointing at the compose instance, and a shared counter would
 * make the suites order-dependent — `__reset()` clears a local map, not somebody else's Redis.
 *
 * `enableOfflineQueue: false` is what makes the fallback work. The default queues commands
 * while disconnected and settles them later, so a Redis outage would turn every rate-limited
 * request into a hang rather than an error, and there would be nothing to fall back *from*.
 */
let client: Redis | null | undefined

function redis(): Redis | null {
  if (client !== undefined) return client

  const url = process.env.REDIS_URL
  if (!url || (process.env.NODE_ENV || 'development') === 'test') return (client = null)

  const c = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    // Reconnect, but do not spin: the local fallback is holding the line meanwhile.
    retryStrategy: (times) => Math.min(times * 500, 5_000),
  })
  // ioredis emits 'error' as an EventEmitter event, and an EventEmitter with no error
  // listener throws — an unreachable Redis would take the whole process down, which is a
  // spectacular way to fail at rate limiting.
  c.on('error', () => degrade())
  return (client = c)
}

/** Log the first degradation and then stay quiet: a Redis outage emits per request. */
let degraded = false
function degrade(err?: unknown) {
  if (degraded) return
  degraded = true
  const why = err instanceof Error ? `: ${err.message}` : ''
  console.warn(
    `[rate-limit] Redis unavailable${why} — falling back to per-instance counters. ` +
      `Budgets are now enforced per process, so the effective limit is max × instances.`
  )
}

/**
 * The shared counter, falling back to the local one.
 *
 * Every failure path lands in the same place deliberately. Whether Redis is absent (dev),
 * excluded (test), unreachable, or answering something unexpected, the caller still gets a
 * verdict from a real limiter rather than an exception or an unconditional pass.
 */
export async function consumeShared(
  key: string,
  scope: string,
  max: number,
  windowMs: number
): Promise<Verdict> {
  const c = redis()
  if (!c) return consume(key, scope, max, windowMs)

  try {
    const [count, ttl] = (await c.eval(
      SCRIPT,
      1,
      `rl:${scope}:${key}`,
      String(windowMs)
    )) as [number, number]

    if (degraded) {
      degraded = false
      console.info('[rate-limit] Redis is back — budgets are shared again.')
    }

    if (count > max) {
      // PTTL answers -1 for a key with no expiry and -2 for one that just vanished. Neither
      // should happen given the script, and neither may become `Retry-After: -1`.
      const ms = ttl > 0 ? ttl : windowMs
      return { ok: false, retryAfter: Math.max(1, Math.ceil(ms / 1000)) }
    }
    return { ok: true, remaining: Math.max(0, max - count) }
  } catch (e) {
    degrade(e)
    return consume(key, scope, max, windowMs)
  }
}

/** Test seam. Buckets are module state, so suites would otherwise bleed into each other. */
export const __reset = () => {
  buckets.clear()
  degraded = false
}

/**
 * Apply a limit and answer 429 if it is exceeded. Returns true when the caller should stop.
 *
 * Written as a guard rather than as middleware because the limit is then visible in the route
 * that owns it, and because these budgets differ per endpoint. Routes Medusa owns cannot use
 * a guard — there is no handler of ours to put it in — so those go through `rateLimit()`
 * below instead. The two share every line that matters.
 */
export async function limited(
  req: any,
  res: any,
  scope: string,
  max: number,
  windowMs: number
): Promise<boolean> {
  const verdict = await consumeShared(clientKey(req), scope, max, windowMs)
  if (verdict.ok) {
    res.setHeader('X-RateLimit-Remaining', String(verdict.remaining))
    return false
  }
  res.setHeader('Retry-After', String(verdict.retryAfter))
  res.status(429).json({
    type: 'too_many_requests',
    message: 'Too many requests. Please wait a moment and try again.',
  })
  return true
}

/**
 * The same limit as middleware, for routes whose handler belongs to Medusa.
 *
 * Login, registration, password reset, account creation and cart completion are the five
 * highest-value limits any shop has — credential stuffing and card testing both live there —
 * and not one of them is a route this application wrote. `defineMiddlewares` matches on path
 * patterns, which is the only place a rule can be attached to somebody else's handler.
 */
export function rateLimit(scope: string, max: number, windowMs: number) {
  return async (req: any, res: any, next: (e?: unknown) => void) => {
    try {
      if (await limited(req, res, scope, max, windowMs)) return
    } catch (e) {
      // A limiter that 500s the checkout is worse than the attack it was guarding against.
      degrade(e)
    }
    next()
  }
}
