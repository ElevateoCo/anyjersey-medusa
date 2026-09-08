'use client'
import { useState } from 'react'

type Order = {
  number: number; placed_at: string; status: string
  shipped_at: string | null; delivered_at: string | null
  tracking_number: string | null; tracking_url: string | null
  currency: string
  items: { title: string; variant: string | null; quantity: number; subtotal: number }[]
  subtotal: number; shipping: number; tax: number; total: number
  ship_to: { name: string; city: string; province: string; postal_code: string; country: string } | null
}

const STEPS = ['processing', 'shipped', 'delivered'] as const

export default function OrderLookup() {
  const [number, setNumber] = useState('')
  const [email, setEmail] = useState('')
  const [order, setOrder] = useState<Order | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  const money = (n: number, cur = order?.currency ?? 'USD') =>
    `$${n.toFixed(2)}${cur !== 'USD' ? ` ${cur}` : ''}`

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('loading'); setMsg(''); setOrder(null)
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_MEDUSA_URL}/store/order-lookup`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-publishable-api-key': process.env.NEXT_PUBLIC_MEDUSA_PK ?? '',
          },
          body: JSON.stringify({ order_number: number, email }),
        }
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body?.message ?? 'Could not find that order.')
      setOrder(body.order); setState('idle')
    } catch (err: unknown) {
      setState('err')
      setMsg(err instanceof Error ? err.message : 'Could not find that order.')
    }
  }

  if (order) {
    const at = STEPS.indexOf(order.status as typeof STEPS[number])
    return (
      <div className="track">
        <p className="eyebrow">Order #{order.number}</p>
        <h1>{order.status === 'delivered' ? 'Delivered'
          : order.status === 'shipped' ? 'On its way' : 'We’re on it'}</h1>

        <ol className="steps-track" aria-label="Order progress">
          {STEPS.map((s, i) => (
            <li key={s} className={i <= at ? 'done' : ''} aria-current={i === at ? 'step' : undefined}>
              {s}
            </li>
          ))}
        </ol>

        {order.tracking_number && (
          <p className="promise">
            <b>Tracking</b>
            {order.tracking_url
              ? <a href={order.tracking_url} target="_blank" rel="noreferrer">
                  {order.tracking_number}
                </a>
              : order.tracking_number}
          </p>
        )}

        <table className="spec">
          <tbody>
            {order.items.map((i, n) => (
              <tr key={n}>
                <th>{i.quantity}× {i.variant ? `${i.variant} — ` : ''}{i.title}</th>
                <td style={{ textAlign: 'right' }}>{money(i.subtotal)}</td>
              </tr>
            ))}
            <tr><th>Shipping</th><td style={{ textAlign: 'right' }}>{money(order.shipping)}</td></tr>
            <tr><th>Tax</th><td style={{ textAlign: 'right' }}>{money(order.tax)}</td></tr>
            <tr>
              <th style={{ color: 'var(--ink)', fontWeight: 600 }}>Total</th>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(order.total)}</td>
            </tr>
          </tbody>
        </table>

        {order.ship_to && (
          <p className="notifynote" style={{ marginTop: '1rem' }}>
            Shipping to {order.ship_to.name}, {order.ship_to.city} {order.ship_to.province}{' '}
            {order.ship_to.postal_code} {order.ship_to.country}
          </p>
        )}

        <p style={{ marginTop: '1.5rem' }}>
          <button className="btn" onClick={() => { setOrder(null); setNumber(''); setEmail('') }}>
            Look up another
          </button>
        </p>
      </div>
    )
  }

  return (
    <form className="cform" onSubmit={submit}>
      <p>
        <label htmlFor="ordernum">Order number</label>
        <input id="ordernum" required value={number} inputMode="numeric"
               placeholder="1042" onChange={(e) => setNumber(e.target.value)} />
      </p>
      <p>
        <label htmlFor="orderemail">Email used to order</label>
        <input id="orderemail" required type="email" value={email}
               autoComplete="email" placeholder="you@example.com"
               onChange={(e) => setEmail(e.target.value)} />
      </p>
      {state === 'err' && <p className="rmsg err" role="alert" style={{ color: '#B3261E' }}>{msg}</p>}
      <button className="btn block" type="submit" disabled={state === 'loading'}>
        {state === 'loading' ? 'Looking…' : 'Find my order'}
      </button>
      <p className="note" style={{ marginTop: '.75rem' }}>
        Both are needed — the order number on its own will not find anything.
      </p>
    </form>
  )
}
