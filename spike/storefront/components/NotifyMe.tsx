'use client'
import { useState } from 'react'

/**
 * One-click demand signal on the product page.
 *
 * The request block already captures demand, but it asks for a sentence. This asks for an
 * email and nothing else — the product, team, player and selected size are already known,
 * so the customer types one field instead of describing what they are looking at.
 *
 * It feeds the same queue as the request form (§12.1), which is the point: the sourcing
 * team sees one list.
 */
export default function NotifyMe({ team, player, colourway, size, productId, title }:
  { team?: string | null; player?: string | null; colourway?: string | null
    size?: string | null; productId: string; title: string }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  const what = [size ? `size ${size}` : null, player, team, colourway]
    .filter(Boolean).join(' · ')

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
          body: JSON.stringify({
            email,
            raw_request: `Notify about: ${title}${size ? ` (size ${size})` : ''}`,
            team, player, colourway, size_code: size,
            source: 'product',
            source_product_id: productId,
          }),
        }
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body?.message ?? 'Something went wrong.')
      setState('ok')
      setMsg('Done — we’ll email you as soon as we have it.')
    } catch (err: unknown) {
      setState('err')
      setMsg(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  if (state === 'ok') {
    return <p className="notify done" role="status">{msg}</p>
  }

  return (
    <div className="notify">
      {!open ? (
        <button className="notifybtn" onClick={() => setOpen(true)}>
          Can’t get this one? <strong>Ask us to source it</strong>
        </button>
      ) : (
        <form onSubmit={submit}>
          <p className="notifywhat">
            We’ll look for <strong>{what || title}</strong>
          </p>
          <div className="notifyrow">
            <label htmlFor="notify-email" className="visually-hidden">Your email</label>
            <input id="notify-email" type="email" required value={email}
                   placeholder="you@example.com"
                   onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" disabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Notify me'}
            </button>
          </div>
          {state === 'err' && <p className="rmsg err" role="alert">{msg}</p>}
          <p className="notifynote">One email when we find it. No charge until you order.</p>
        </form>
      )}
    </div>
  )
}
