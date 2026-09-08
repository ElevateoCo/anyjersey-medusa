import { createHmac, timingSafeEqual } from 'crypto'
import type { MedusaContainer } from '@medusajs/framework/types'
import { CATALOG_MODULE } from './modules/catalog'

/**
 * Marketing suppression: who must never receive a commercial email.
 *
 * Exactly one message this shop sends is commercial — the cart-recovery email. Everything else
 * is transactional: a receipt, an acknowledgement, a password reset. That distinction is the
 * whole of this file, because the rules differ completely. A receipt needs no consent and no
 * unsubscribe; a "you left something in your basket" needs both.
 *
 * **The basis is soft opt-in, not the newsletter.** The address was given during a checkout —
 * negotiations for a sale of a similar product — which is what PECR reg. 22(3) and the
 * CAN-SPAM existing-business-relationship carve-out both turn on. What that basis *requires* is
 * a simple means of refusing, offered in every message. So the link is not a nicety here; it is
 * the condition the legitimacy rests on.
 *
 * Suppression is therefore **marketing-wide**, not per-list. Somebody who unsubscribed from the
 * newsletter has refused marketing, and sending them a basket reminder because it came from a
 * different code path would be the sort of distinction only the sender can see.
 */

/** Any row for this address carrying an unsubscribe, whatever kind it is. */
export async function isSuppressed(
  container: MedusaContainer,
  email: string
): Promise<boolean> {
  const address = email.trim().toLowerCase()
  if (!address) return true

  try {
    const catalog: any = container.resolve(CATALOG_MODULE)
    const rows = await catalog.listInboundMessages({ email: address }, { take: 50 })
    return (rows as any[]).some((r) => !!r.unsubscribed_at)
  } catch {
    /**
     * **Fails closed**, and this is the one place in the codebase that does.
     *
     * Everywhere else an unreachable database means "send it anyway", because not sending a
     * receipt is worse than sending one. Here the failure modes are the other way round: not
     * sending a marketing email costs a basket, and sending one to somebody who opted out is
     * a regulatory breach and a complaint. When in doubt, do not market.
     */
    return true
  }
}

/** Record a refusal. Idempotent — clicking unsubscribe twice is not an error. */
export async function suppress(
  container: MedusaContainer,
  email: string,
  source: string
): Promise<void> {
  const address = email.trim().toLowerCase()
  const catalog: any = container.resolve(CATALOG_MODULE)

  const existing = await catalog.listInboundMessages({ email: address }, { take: 50 })
    .catch(() => [])

  // Stamp every list this address is on, so one click covers all of them rather than leaving
  // the person to discover a second list later.
  const live = (existing as any[]).filter((r) => !r.unsubscribed_at)
  if (live.length) {
    await catalog.updateInboundMessages(
      live.map((r) => ({ id: r.id, unsubscribed_at: new Date() }))
    )
  }

  // And leave a standalone record when there was nothing to stamp — the common case, since
  // most people who click this never signed up for anything.
  if (!(existing as any[]).some((r) => r.kind === 'suppression')) {
    await catalog.createInboundMessages([{
      kind: 'suppression',
      email: address,
      source,
      unsubscribed_at: new Date(),
      status: 'closed',
    }])
  }
}

/**
 * A token that proves the link came from us, without a database row.
 *
 * HMAC over the address, so the link in an email works with one click and cannot be edited to
 * unsubscribe somebody else. No expiry: an unsubscribe link found in a two-year-old email
 * should still work, and there is no harm it can do — the worst outcome is that somebody stops
 * receiving marketing they were going to be entitled to refuse anyway.
 *
 * The secret is the cookie secret, which already has to be set and rotated as a secret. A
 * dedicated one would be a fourth thing to configure for no additional protection.
 */
const secret = () =>
  process.env.UNSUBSCRIBE_SECRET || process.env.COOKIE_SECRET || 'insecure-dev-secret'

const sign = (address: string) =>
  createHmac('sha256', secret()).update(address).digest('base64url')

export const unsubscribeToken = (email: string): string => {
  const address = email.trim().toLowerCase()
  return `${Buffer.from(address).toString('base64url')}.${sign(address)}`
}

/** The address a token vouches for, or null. */
export const addressFromToken = (token: string): string | null => {
  const [encoded, signature] = String(token ?? '').split('.')
  if (!encoded || !signature) return null

  let address: string
  try {
    address = Buffer.from(encoded, 'base64url').toString('utf8')
  } catch {
    return null
  }
  if (!address.includes('@')) return null

  const expected = Buffer.from(sign(address))
  const given = Buffer.from(signature)
  // Constant-time, so the comparison cannot be used to discover a valid signature one
  // character at a time.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  return address
}

/** The link that goes in a commercial email. */
export const unsubscribeUrl = (email: string): string | null => {
  const base = process.env.STOREFRONT_URL
  if (!base) return null
  return `${base.replace(/\/$/, '')}/unsubscribe?token=${unsubscribeToken(email)}`
}
