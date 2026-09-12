'use client'
import { useState } from 'react'

/**
 * The request mechanic — research.md §12.1. Not a contact form: it posts to
 * /store/jersey-requests, which parses and queues it as a demand signal.
 */
export default function RequestForm({ source = 'homepage', prefill = '' }:
  { source?: string; prefill?: string }) {
  const [email, setEmail] = useState('')
  const [what, setWhat] = useState(prefill)
  const [state, setState] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('sending')
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_MEDUSA_URL}/store/jersey-requests`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-publishable-api-key': process.env.NEXT_PUBLIC_MEDUSA_PK ?? '',
          },
          body: JSON.stringify({ email, raw_request: what, source }),
        }
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body?.message ?? 'Something went wrong.')
      setState('ok')
      setMsg('Got it. We’ll email you when we’ve sourced it.')
      setWhat('')
    } catch (err: unknown) {
      setState('err')
      setMsg(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  return (
    <form className="rform" onSubmit={submit} aria-label="Request a jersey">
      <input required type="text" value={what} onChange={(e) => setWhat(e.target.value)}
             placeholder="Which jersey? e.g. 1998 Vikings Randy Moss, XL"
             aria-label="Which jersey are you looking for" />
      <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
             placeholder="you@example.com" aria-label="Your email" />
      <button className="btn" type="submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Submit request'}
      </button>
      {msg && <p className={`rmsg ${state === 'ok' ? 'ok' : 'err'}`} role="status">{msg}</p>}
    </form>
  )
}
