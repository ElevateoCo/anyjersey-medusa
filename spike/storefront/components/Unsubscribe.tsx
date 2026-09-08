'use client'

import { useEffect, useState } from 'react'

/**
 * The page an unsubscribe link lands on.
 *
 * **Two steps, deliberately.** A corporate mail gateway follows every URL in an incoming
 * message to check it for malware, so a link that unsubscribes on `GET` unsubscribes people
 * who never opened the email. The click confirms the token; the button performs it.
 *
 * Providers that support RFC 8058 one-click never reach this page at all — they `POST` to the
 * same endpoint directly from the `List-Unsubscribe-Post` header, which is why that path
 * exists server-side.
 */
type State =
  | { step: 'checking' }
  | { step: 'invalid'; message: string }
  | { step: 'confirm'; email: string; already: boolean }
  | { step: 'done' }

export default function Unsubscribe({ token }: { token: string }) {
  const [state, setState] = useState<State>({ step: 'checking' })
  const [busy, setBusy] = useState(false)

  const api = process.env.NEXT_PUBLIC_MEDUSA_URL ?? ''
  const key = process.env.NEXT_PUBLIC_MEDUSA_PK ?? ''

  useEffect(() => {
    if (!token) {
      setState({ step: 'invalid', message: 'That link is missing its token.' })
      return
    }
    fetch(`${api}/store/unsubscribe?token=${encodeURIComponent(token)}`, {
      headers: { 'x-publishable-api-key': key },
    })
      .then(async (r) => {
        const json = await r.json().catch(() => ({}))
        if (!r.ok || !json.valid) {
          setState({ step: 'invalid', message: json.message ?? 'That link is not valid.' })
          return
        }
        setState({ step: 'confirm', email: json.email, already: !!json.already })
      })
      .catch(() => setState({
        step: 'invalid',
        message: 'We could not check that link. Try again in a moment.',
      }))
  }, [token, api, key])

  const confirm = async () => {
    setBusy(true)
    try {
      const res = await fetch(`${api}/store/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': key },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) throw new Error()
      setState({ step: 'done' })
    } catch {
      setState({
        step: 'invalid',
        message: 'That did not go through. Try again, or reply to any of our emails and we ' +
                 'will do it by hand.',
      })
    } finally {
      setBusy(false)
    }
  }

  if (state.step === 'checking') {
    return <p role="status" aria-live="polite">Checking that link&hellip;</p>
  }

  if (state.step === 'invalid') {
    return (
      <div role="status" aria-live="polite">
        <p><strong>{state.message}</strong></p>
        <p style={{ marginTop: '.75rem' }}>
          Reply to any email from us and we will unsubscribe you by hand.
        </p>
      </div>
    )
  }

  if (state.step === 'done') {
    return (
      <div role="status" aria-live="polite">
        <p><strong>Done.</strong> You will not receive marketing email from us.</p>
        <p style={{ marginTop: '.75rem' }}>
          You will still get receipts and replies about orders you place, which are not
          marketing and cannot be switched off.
        </p>
        <p style={{ marginTop: '1.25rem' }}>
          <a className="btn" href="/">Back to the shop</a>
        </p>
      </div>
    )
  }

  return (
    <div>
      <p>
        Unsubscribe <strong>{state.email}</strong> from marketing email?
      </p>
      {state.already && (
        <p style={{ marginTop: '.5rem', color: 'var(--ink-3)' }}>
          This address has already opted out. Confirming again changes nothing.
        </p>
      )}
      <p style={{ marginTop: '1.25rem' }}>
        <button className="btn" type="button" onClick={confirm} disabled={busy}>
          {busy ? 'Unsubscribing…' : 'Unsubscribe'}
        </button>{' '}
        <a className="btn ghost" href="/">Keep receiving them</a>
      </p>
    </div>
  )
}
