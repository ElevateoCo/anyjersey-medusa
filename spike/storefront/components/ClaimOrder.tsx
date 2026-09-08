'use client'

import { useEffect, useState } from 'react'
import { acceptClaimAction, requestClaimAction } from '@/app/account/actions'

/**
 * Attaching a guest order to the account you are signed in to.
 *
 * Two states, because there are two ways to arrive: from the account, asking; or from the
 * confirmation email, with a token.
 *
 * The confirmation is what makes it safe, and the copy says so plainly — the email goes to
 * the address on the order, not to the account requesting it, so knowing an order number
 * gets nobody anywhere.
 */
export default function ClaimOrder(
  { orderId, token, email }: { orderId: string; token: string; email: string }
) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const [number, setNumber] = useState('')

  // Arriving from the email: accept straight away rather than asking somebody who has already
  // clicked "yes, that is me" to click again.
  useEffect(() => {
    if (!orderId || !token) return
    setState('sending')
    acceptClaimAction(orderId, token)
      .then(() => setState('done'))
      .catch((e: Error) => {
        setState('error')
        setMsg(e.message || 'That confirmation link did not work. It may already have been used.')
      })
  }, [orderId, token])

  if (state === 'done') {
    return (
      <div role="status" aria-live="polite">
        <p><strong>Added.</strong> That order is now in your history.</p>
        <p style={{ marginTop: '1.25rem' }}>
          <a className="btn" href="/account">See your orders</a>
        </p>
      </div>
    )
  }

  if (state === 'sent') {
    return (
      <div role="status" aria-live="polite">
        <p><strong>Check the inbox for that order.</strong></p>
        <p style={{ marginTop: '.75rem', maxWidth: '56ch' }}>
          We have emailed the address the order was placed with. Click the link in it and the
          order joins this account. We deliberately do not send it to {email} &mdash; that is
          what stops somebody adding an order that is not theirs.
        </p>
      </div>
    )
  }

  return (
    <form
      className="checkout-form"
      action={async (formData: FormData) => {
        setState('sending')
        setMsg('')
        try {
          await requestClaimAction(formData)
          setState('sent')
        } catch (e) {
          setState('error')
          setMsg((e as Error).message || 'We could not find that order.')
        }
      }}
    >
      <div className="row2">
        <div>
          <label htmlFor="order_number">Order number</label>
          <input id="order_number" name="order_number" inputMode="numeric" required
                 value={number} onChange={(e) => setNumber(e.target.value)}
                 placeholder="1042" />
        </div>
        <div>
          <label htmlFor="email">Email on the order</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
        </div>
      </div>
      <p style={{ marginTop: '1rem' }}>
        <button className="btn" type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Checking…' : 'Find that order'}
        </button>
      </p>
      {state === 'error' && (
        <p role="status" aria-live="polite" className="rmsg err">{msg}</p>
      )}
    </form>
  )
}
