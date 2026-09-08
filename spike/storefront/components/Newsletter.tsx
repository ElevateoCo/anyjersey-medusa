'use client'
import { useState } from 'react'

/**
 * Newsletter sign-up, in the footer.
 *
 * Heading is the live store's: "Sign up for exclusive offers & discounts".
 *
 * Two things it does that the live one does not, both because this is marketing consent
 * rather than a mailing list:
 *
 *  - **The answer is identical whether or not the address is already subscribed.** Saying
 *    "you are already on the list" turns a public footer form into a way to test which
 *    addresses have shopped here.
 *  - **It says what it will be used for before the click**, not in a policy two pages away.
 *
 * Nothing is sent yet: no marketing provider is configured. The list is collected because a
 * subscriber acquired today cannot be acquired retrospectively.
 */
const BASE = process.env.NEXT_PUBLIC_MEDUSA_URL ?? ''
const PK = process.env.NEXT_PUBLIC_MEDUSA_PK ?? ''

export default function Newsletter() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('sending'); setMsg('')
    try {
      const res = await fetch(`${BASE}/store/newsletter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': PK },
        body: JSON.stringify({ email, source: 'footer' }),
      })
      const b = await res.json()
      if (!res.ok) throw new Error(b?.message ?? 'Could not sign you up.')
      setState('ok'); setMsg(b.message ?? 'Thanks — you are on the list.')
    } catch (err: unknown) {
      setState('err')
      setMsg(err instanceof Error ? err.message : 'Could not sign you up.')
    }
  }

  return (
    <div className="newsletter">
      <h2 className="display">Sign up for exclusive offers &amp; discounts</h2>
      {state === 'ok' ? (
        <p className="note" role="status">{msg}</p>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="nl-email">Email</label>
          <div className="nlrow">
            <input id="nl-email" type="email" required value={email}
                   onChange={(e) => setEmail(e.target.value)} autoComplete="email"
                   placeholder="you@example.com" />
            <button className="btn" type="submit" disabled={state === 'sending'}>
              {state === 'sending' ? '…' : 'Sign up'}
            </button>
          </div>
          {state === 'err' && (
            <p className="rmsg err" role="alert" style={{ color: '#B3261E' }}>{msg}</p>
          )}
          <p className="note">
            Offers and new arrivals. Unsubscribe from any email, or{' '}
            <a href="/privacy-choices">manage your privacy choices</a>. We never sell your
            address.
          </p>
        </form>
      )}
    </div>
  )
}
