'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import * as account from '@/lib/account'

/**
 * Account server actions.
 *
 * All of them return `{ ok, message }` rather than throwing, because every failure here is
 * an expected one — a wrong password, an email already taken, a mismatched confirmation —
 * and the form has to redisplay with the reason. Throwing would replace the form with an
 * error page and lose what was typed.
 *
 * `redirect()` is the exception: it throws by design in Next, so it is called *after* the
 * work succeeds and never inside a try block, where its control-flow exception would be
 * caught and reported as a failure.
 */
export type Result = { ok: boolean; message?: string }

/**
 * Signatures are `(prevState, formData)` because these are consumed through
 * `useActionState`, which passes the previous state as the first argument. The previous
 * state is deliberately unused: none of these forms accumulates state across submissions,
 * and reading a stale one is how a form starts showing yesterday's error.
 */

const MIN_PASSWORD = 8

/** One message for both cases. Distinguishing them tells an attacker which emails exist. */
const BAD_CREDENTIALS = 'That email and password do not match an account.'

export async function loginAction(
  _prev: Result | null,
  form: FormData
): Promise<Result> {
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  if (!email || !password) return { ok: false, message: 'Email and password are required.' }

  try {
    await account.login(email, password)
  } catch {
    return { ok: false, message: BAD_CREDENTIALS }
  }
  revalidatePath('/', 'layout')
  redirect('/account')
}

export async function registerAction(
  _prev: Result | null,
  form: FormData
): Promise<Result> {
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  const confirm = String(form.get('confirm') ?? '')

  if (!email || !password) return { ok: false, message: 'Email and password are required.' }
  if (password.length < MIN_PASSWORD) {
    return { ok: false, message: `Use at least ${MIN_PASSWORD} characters.` }
  }
  if (password !== confirm) return { ok: false, message: 'The two passwords do not match.' }

  try {
    await account.register({
      email,
      password,
      first_name: String(form.get('first_name') ?? ''),
      last_name: String(form.get('last_name') ?? ''),
    })
  } catch (e) {
    const raw = e instanceof Error ? e.message : ''
    // Registration is the one place an "already exists" message is not an enumeration leak:
    // whoever is typing is trying to create that account, and hiding it produces a silent
    // failure they cannot act on. Sign-in stays deliberately vague.
    return {
      ok: false,
      message: /already exists/i.test(raw)
        ? 'There is already an account with that email. Try signing in instead.'
        : raw || 'Could not create that account.',
    }
  }
  revalidatePath('/', 'layout')
  redirect('/account')
}

export async function logoutAction(): Promise<void> {
  await account.clearSession()
  revalidatePath('/', 'layout')
  redirect('/')
}

/**
 * Request a reset link.
 *
 * Reports success unconditionally. A reset endpoint that says "no such account" is an
 * account-enumeration oracle, and for this shop the customer list *is* the email list.
 */
export async function requestResetAction(
  _prev: Result | null,
  form: FormData
): Promise<Result> {
  const email = String(form.get('email') ?? '')
  if (!email) return { ok: false, message: 'Enter your email address.' }
  await account.requestPasswordReset(email)
  return {
    ok: true,
    message:
      'If there is an account with that address, a reset link is on its way. It expires in ' +
      '15 minutes.',
  }
}

export async function completeResetAction(
  _prev: Result | null,
  form: FormData
): Promise<Result> {
  const token = String(form.get('token') ?? '')
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  const confirm = String(form.get('confirm') ?? '')

  if (!token || !email) {
    return { ok: false, message: 'This link is incomplete. Please request a new one.' }
  }
  if (password.length < MIN_PASSWORD) {
    return { ok: false, message: `Use at least ${MIN_PASSWORD} characters.` }
  }
  if (password !== confirm) return { ok: false, message: 'The two passwords do not match.' }

  try {
    await account.completePasswordReset(token, email, password)
  } catch {
    // A used or expired token is the common case, not an outage.
    return {
      ok: false,
      message: 'That link has expired or has already been used. Please request a new one.',
    }
  }
  redirect('/account/login?reset=done')
}

/* ------------------------------------------------------------------ addresses
 *
 * These throw rather than returning `{ ok, message }`, unlike the auth actions above. The
 * difference is what the caller does with a failure: a wrong password has to redisplay the
 * form with the reason, while a failed address save is caught by the component and shown in
 * a live region without losing anything. Same information, less ceremony.
 */

export async function addAddressAction(formData: FormData): Promise<void> {
  await account.addAddress({
    first_name: String(formData.get('first_name') ?? '').trim(),
    last_name: String(formData.get('last_name') ?? '').trim(),
    address_1: String(formData.get('address_1') ?? '').trim(),
    city: String(formData.get('city') ?? '').trim(),
    province: String(formData.get('province') ?? '').trim(),
    postal_code: String(formData.get('postal_code') ?? '').trim(),
    country_code: String(formData.get('country_code') ?? 'us').trim(),
  })
  revalidatePath('/account/addresses')
}

export async function deleteAddressAction(id: string): Promise<void> {
  await account.deleteAddress(id)
  revalidatePath('/account/addresses')
}

/* -------------------------------------------------------------- claiming an order
 *
 * The lookup and the transfer request happen together, server-side, in one authenticated
 * call — so the order id never reaches the browser. Somebody guessing order numbers learns
 * nothing: every failure answers the same way after the same delay, and the confirmation
 * only ever goes to the address on the order.
 */

export async function requestClaimAction(formData: FormData): Promise<string> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const orderNumber = String(formData.get('order_number') ?? '').trim()

  const result = await account.requestOrderClaim(email, orderNumber)
  revalidatePath('/account')
  return result.message
}

export async function acceptClaimAction(orderId: string, token: string): Promise<void> {
  await account.acceptOrderClaim(orderId, token)
  revalidatePath('/account')
}
