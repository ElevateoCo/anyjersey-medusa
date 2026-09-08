import { cookies } from 'next/headers'
import { forwardedIdentity } from './internal'

/**
 * Customer accounts.
 *
 * **Server-only.** The session token lives in an httpOnly cookie and never reaches the
 * browser, which is the whole point: a JWT in `localStorage` is readable by any script that
 * gets onto the page, and with Stripe Elements on our own domain we are in PCI SAQ A-EP
 * (research.md §7.5) — script-borne token theft is exactly the risk 6.4.3 and 11.6.1 are
 * about. So every authenticated call is made from the server and the cookie is the session.
 *
 * Accounts are **optional, and stay optional.** The shop's proposition is that there is
 * nothing to remember (§12.1), guest checkout is the default path, and `/track` works
 * without a login. An account adds order history and saved addresses; it is not a gate.
 *
 * Medusa's auth is two calls, not one, and the order matters:
 *
 *   1. `POST /auth/customer/emailpass/register` creates the auth identity and returns a JWT
 *   2. `POST /store/customers` **with that JWT** creates the customer record
 *
 * A registration that does step 1 and fails step 2 leaves an auth identity with no customer
 * behind it — the account exists, can log in, and has nothing to show. That case is handled
 * explicitly below rather than left to chance.
 */
const BASE = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
const PK = process.env.NEXT_PUBLIC_MEDUSA_PK ?? ''

export const TOKEN_COOKIE = 'aj_session'

export type Customer = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  addresses?: Address[]
}

export type Address = {
  id: string
  first_name?: string | null
  last_name?: string | null
  address_1?: string | null
  city?: string | null
  province?: string | null
  postal_code?: string | null
  country_code?: string | null
}

export type OrderSummary = {
  id: string
  display_id: number
  created_at: string
  total: number
  currency_code: string
  items: { title: string; variant_title: string | null; quantity: number; thumbnail: string | null }[]
  fulfillment_status?: string | null
}

async function call<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  // Every call through here is request-scoped and `no-store`, which is what makes it
  // safe to name the customer: the header never becomes part of a shared cache key.
  const identity = await forwardedIdentity()
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PK,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...identity,
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
  const body = await res.text()
  if (!res.ok) {
    let message = `${res.status}`
    try { message = JSON.parse(body)?.message ?? message } catch { /* keep the status */ }
    throw new AuthError(message, res.status)
  }
  return (body ? JSON.parse(body) : {}) as T
}

export class AuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/* ------------------------------------------------------------------ session */

export async function getToken(): Promise<string | null> {
  return (await cookies()).get(TOKEN_COOKIE)?.value ?? null
}

async function setToken(token: string) {
  ;(await cookies()).set(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Secure in production only: a Secure cookie is dropped over plain http, which would
    // make login silently fail in local development with no error anywhere.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
}

export async function clearSession() {
  ;(await cookies()).delete(TOKEN_COOKIE)
}

/**
 * The signed-in customer, or null.
 *
 * A rejected token clears the cookie. Leaving a dead session cookie in place means every
 * page load makes a doomed request and the customer sees a signed-in header over signed-out
 * data — worse than being logged out.
 */
export async function getCustomer(): Promise<Customer | null> {
  const token = await getToken()
  if (!token) return null
  try {
    const { customer } = await call<{ customer: Customer }>(
      '/store/customers/me?fields=*addresses', undefined, token
    )
    return customer
  } catch (e) {
    if (e instanceof AuthError && (e.status === 401 || e.status === 403)) {
      await clearSession()
    }
    return null
  }
}

/* --------------------------------------------------------------- login/join */

export async function login(email: string, password: string): Promise<void> {
  const { token } = await call<{ token: string }>('/auth/customer/emailpass', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  })
  if (!token) throw new AuthError('Sign-in failed.', 401)
  await setToken(token)
}

export async function register(input: {
  email: string
  password: string
  first_name?: string
  last_name?: string
}): Promise<void> {
  const email = input.email.trim().toLowerCase()

  // Step 1 — auth identity. A duplicate email fails here with 401 and the message
  // "Identity with email already exists", which is a real answer, not an error to swallow.
  const { token } = await call<{ token: string }>('/auth/customer/emailpass/register', {
    method: 'POST',
    body: JSON.stringify({ email, password: input.password }),
  })
  if (!token) throw new AuthError('Could not create that account.', 400)

  // Step 2 — the customer record, authenticated with the token from step 1.
  try {
    await call(
      '/store/customers',
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          first_name: input.first_name || null,
          last_name: input.last_name || null,
        }),
      },
      token
    )
  } catch (e) {
    // The identity now exists with no customer behind it. Do not sign them in: an account
    // that can log in and shows nothing is the confusing failure. The identity is reusable,
    // so asking them to sign in resolves it on the next attempt.
    throw new AuthError(
      'Your sign-in was created but your profile was not. Please try signing in — if that ' +
      'fails, contact us and we will finish it by hand.',
      (e as AuthError).status ?? 500
    )
  }

  await setToken(token)
}

/* ------------------------------------------------------------------ orders */

/**
 * This customer's orders.
 *
 * Only orders placed while signed in appear here. Guest orders are not retroactively claimed
 * by registering with the same address — that would let anyone see the order history of any
 * email they can type. `/track` is the deliberate route to a guest order, and it requires
 * the order number as well as the email.
 */
export async function getOrders(): Promise<OrderSummary[]> {
  const token = await getToken()
  if (!token) return []
  try {
    const { orders } = await call<{ orders: OrderSummary[] }>(
      '/store/orders?fields=id,display_id,created_at,total,currency_code,*items&order=-created_at',
      undefined,
      token
    )
    return orders ?? []
  } catch {
    return []
  }
}

/* --------------------------------------------------------- password reset */

/**
 * Ask for a reset link.
 *
 * Always resolves, whatever happened. A reset endpoint that reports "no such account" is an
 * account-enumeration oracle, and this shop's customer list is its own email list. The page
 * says the same thing either way.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await call('/auth/customer/emailpass/reset-password', {
    method: 'POST',
    body: JSON.stringify({ identifier: email.trim().toLowerCase() }),
  }).catch(() => {})
}

/** Set a new password using the token from the emailed link. */
export async function completePasswordReset(
  token: string,
  email: string,
  password: string
): Promise<void> {
  await call(
    '/auth/customer/emailpass/update',
    { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), password }) },
    token
  )
}

/* ------------------------------------------------------------------ addresses
 *
 * Medusa has held an address book at `/store/customers/me/addresses` since the account
 * routes shipped, and nothing in this storefront ever called it — so a returning customer
 * retyped their address on every order, on a shop whose repeat purchase is another shirt for
 * the same person.
 */

export async function getAddresses(): Promise<Address[]> {
  const token = await getToken()
  if (!token) return []
  const res = await call<{ customer?: { addresses?: Address[] } }>(
    '/store/customers/me?fields=*addresses', undefined, token
  ).catch(() => null)
  return res?.customer?.addresses ?? []
}

export type AddressInput = {
  first_name?: string
  last_name?: string
  address_1?: string
  city?: string
  province?: string
  postal_code?: string
  country_code?: string
  phone?: string
}

export async function addAddress(input: AddressInput): Promise<void> {
  const token = await getToken()
  if (!token) throw new AuthError('Not signed in', 401)
  await call('/store/customers/me/addresses', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      // Lower-cased because Medusa matches region country codes in lower case, and an
      // address stored as "US" silently fails to match a region defined as "us".
      country_code: (input.country_code ?? 'us').toLowerCase(),
    }),
  }, token)
}

export async function deleteAddress(id: string): Promise<void> {
  const token = await getToken()
  if (!token) throw new AuthError('Not signed in', 401)
  await call(`/store/customers/me/addresses/${id}`, { method: 'DELETE' }, token)
}

/* -------------------------------------------------------------- claiming an order
 *
 * A guest order never joined an account, and the code said so. Medusa's transfer flow is the
 * safe way to change that: the requester must be signed in, and the confirmation goes to the
 * address **on the order** rather than to the account asking — so knowing an order number is
 * not enough to pull somebody else's order into your account.
 */

/**
 * Ask for a guest order to be added to this account.
 *
 * One authenticated call that looks the order up and starts the transfer server-side. The
 * order id never reaches the browser — `/store/order-lookup` deliberately returns no internal
 * ids, and adding one there to make this work would have undone that decision for every
 * caller.
 */
export async function requestOrderClaim(
  email: string, orderNumber: string
): Promise<{ requested: boolean; message: string }> {
  const token = await getToken()
  if (!token) throw new AuthError('Not signed in', 401)
  return call<{ requested: boolean; message: string }>('/store/order-claims', {
    method: 'POST',
    body: JSON.stringify({ email, order_number: orderNumber }),
  }, token)
}

export async function acceptOrderClaim(orderId: string, claimToken: string): Promise<void> {
  const token = await getToken()
  if (!token) throw new AuthError('Not signed in', 401)
  await call(`/store/orders/${orderId}/transfer/accept`, {
    method: 'POST',
    body: JSON.stringify({ token: claimToken }),
  }, token)
}
