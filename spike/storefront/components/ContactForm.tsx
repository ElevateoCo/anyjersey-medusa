'use client'
import { useState } from 'react'

/**
 * The contact form.
 *
 * Fields match the live store's — Name, Email (required), Phone number, Comment — because
 * that is the shape customers there are already used to, and because every extra field on a
 * contact form is a reason not to send it.
 *
 * Posts to `/store/contact`, which writes the row before it sends the email. The success
 * state stays on the page rather than redirecting: somebody who has just typed a paragraph
 * should be able to see that it went.
 */
const BASE = process.env.NEXT_PUBLIC_MEDUSA_URL ?? ''
const PK = process.env.NEXT_PUBLIC_MEDUSA_PK ?? ''

export default function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', body: '' })
  const [state, setState] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm({ ...form, [k]: e.target.value })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('sending'); setMsg('')
    try {
      const res = await fetch(`${BASE}/store/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': PK },
        body: JSON.stringify({ ...form, source: 'contact' }),
      })
      const b = await res.json()
      if (!res.ok) throw new Error(b?.message ?? 'Could not send that.')
      setState('ok')
    } catch (err: unknown) {
      setState('err')
      setMsg(err instanceof Error ? err.message : 'Could not send that.')
    }
  }

  if (state === 'ok') {
    return (
      <div className="track" role="status">
        <h3>Message sent</h3>
        <p style={{ marginTop: '.75rem' }}>
          A person reads every one of these and will reply to{' '}
          <strong>{form.email}</strong>. We have emailed you a copy of what you wrote.
        </p>
      </div>
    )
  }

  return (
    <form className="cform" onSubmit={submit}>
      <p>
        <label htmlFor="c-name">Name</label>
        <input id="c-name" value={form.name} onChange={set('name')} autoComplete="name" />
      </p>
      <p>
        <label htmlFor="c-email">Email</label>
        <input id="c-email" type="email" required value={form.email} onChange={set('email')}
               autoComplete="email" placeholder="you@example.com" />
      </p>
      <p>
        <label htmlFor="c-phone">Phone number</label>
        <input id="c-phone" type="tel" value={form.phone} onChange={set('phone')}
               autoComplete="tel" />
      </p>
      <p>
        <label htmlFor="c-body">Comment</label>
        <textarea id="c-body" rows={5} required value={form.body} onChange={set('body')}
                  maxLength={4000} />
      </p>
      {state === 'err' && (
        <p className="rmsg err" role="alert" style={{ color: '#B3261E' }}>{msg}</p>
      )}
      <button className="btn block" type="submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Send'}
      </button>
    </form>
  )
}
