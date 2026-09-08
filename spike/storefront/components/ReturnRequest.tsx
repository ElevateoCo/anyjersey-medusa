'use client'
import { useState } from 'react'

/**
 * Start a return or exchange.
 *
 * Two-step by necessity rather than by design preference: the shop has no accounts
 * requirement, so the customer must first prove the claim to the order (number + email,
 * the same pair `/track` uses), and only then can we say which lines are returnable.
 *
 * **Eligibility is never decided here.** The API returns a verdict and a reason per line,
 * and this renders them. A personalised shirt is refused with an explanation of why rather
 * than being hidden — a missing item reads as a bug and produces a support email, while a
 * stated reason answers the question. The submit endpoint re-decides the same rule, so a
 * crafted request cannot get past what this form offers.
 */
type Item = {
  line_item_id: string
  title: string
  variant: string | null
  quantity: number
  subtotal: number
  eligible: boolean
  reason: string | null
  /** True where the EU/UK statutory right applies and is still inside its window. */
  withdrawal: boolean
}

type Lookup = {
  order: { number: number; placed_at: string; delivered_at: string | null }
  /** The published policy, so this form cannot offer something the API will refuse. */
  stance: 'final-sale' | 'free-exchange'
  window_days: number
  withdrawal_window_days: number
  items: Item[]
  kinds: { key: string; label: string }[]
  reasons: { key: string; label: string; accepted: boolean }[]
}

const BASE = process.env.NEXT_PUBLIC_MEDUSA_URL ?? ''
const PK = process.env.NEXT_PUBLIC_MEDUSA_PK ?? ''

export default function ReturnRequest() {
  const [number, setNumber] = useState('')
  const [email, setEmail] = useState('')
  const [lookup, setLookup] = useState<Lookup | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  const [line, setLine] = useState('')
  const [kind, setKind] = useState('fault')
  const [size, setSize] = useState('')
  const [reason, setReason] = useState('faulty')
  const [comment, setComment] = useState('')
  const [done, setDone] = useState<{ we_pay_postage: boolean } | null>(null)

  async function find(e: React.FormEvent) {
    e.preventDefault()
    setState('loading'); setMsg('')
    try {
      const qs = new URLSearchParams({ email, order_number: number })
      const res = await fetch(`${BASE}/store/return-requests?${qs}`, {
        headers: { 'x-publishable-api-key': PK },
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.message ?? 'Could not find that order.')
      setLookup(body)
      // Preselect the first line we would actually accept, so the common case is one click.
      setLine(body.items.find((i: Item) => i.eligible)?.line_item_id ?? '')
      setState('idle')
    } catch (err: unknown) {
      setState('err')
      setMsg(err instanceof Error ? err.message : 'Could not find that order.')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('loading'); setMsg('')
    try {
      const res = await fetch(`${BASE}/store/return-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-publishable-api-key': PK },
        body: JSON.stringify({
          email, order_number: number, line_item_id: line, kind,
          requested_size: size, reason, comment,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.message ?? 'Could not submit that.')
      setDone({ we_pay_postage: !!body.we_pay_postage })
      setState('idle')
    } catch (err: unknown) {
      setState('err')
      setMsg(err instanceof Error ? err.message : 'Could not submit that.')
    }
  }

  if (done) {
    return (
      <div className="track" role="status">
        <p className="eyebrow">Return requested</p>
        <h3>We have it</h3>
        <p style={{ marginTop: '.75rem' }}>
          A person reads every one of these. We will email you the next step —{' '}
          <strong>please do not post anything back until we do</strong>, so it does not
          arrive without a reference.
        </p>
        <p className="promise" style={{ marginTop: '1rem' }}>
          <b>Postage</b>
          {done.we_pay_postage
            ? 'We pay it. The label is on us.'
            : 'Yours on a change of mind. Any tracked service is fine.'}
        </p>
      </div>
    )
  }

  if (!lookup) {
    return (
      <form className="cform" onSubmit={find}>
        <h3>Which order?</h3>
        <p>
          <label htmlFor="rnum">Order number</label>
          <input id="rnum" required value={number} inputMode="numeric" placeholder="1042"
                 onChange={(e) => setNumber(e.target.value)} />
        </p>
        <p>
          <label htmlFor="remail">Email used to order</label>
          <input id="remail" required type="email" value={email} autoComplete="email"
                 placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
        </p>
        {state === 'err' && (
          <p className="rmsg err" role="alert" style={{ color: '#B3261E' }}>{msg}</p>
        )}
        <button className="btn block" type="submit" disabled={state === 'loading'}>
          {state === 'loading' ? 'Looking…' : 'Continue'}
        </button>
        <p className="note" style={{ marginTop: '.75rem' }}>
          Both are needed. There is no account to sign in to.
        </p>
      </form>
    )
  }

  const eligible = lookup.items.filter((i) => i.eligible)
  const blocked = lookup.items.filter((i) => !i.eligible)
  const selected = lookup.items.find((i) => i.line_item_id === line)

  return (
    <form className="cform" onSubmit={submit}>
      <h3>Order #{lookup.order.number}</h3>

      {eligible.length === 0 ? (
        <p className="callout warn">
          Nothing on this order can be returned through this form. The reasons are below —
          if one of them looks wrong, reply to your order confirmation and a person will
          look at it.
        </p>
      ) : (
        <fieldset className="rfield">
          <legend>Which item?</legend>
          {eligible.map((i) => (
            <label key={i.line_item_id} className="ropt">
              <input type="radio" name="line" value={i.line_item_id}
                     checked={line === i.line_item_id}
                     onChange={() => setLine(i.line_item_id)} />
              <span>
                {i.title}
                {i.variant ? <span className="rvar"> · {i.variant}</span> : null}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {blocked.length > 0 && (
        <div className="rblocked">
          <h3>Not returnable</h3>
          {blocked.map((i) => (
            <p key={i.line_item_id} className="note">
              <strong>{i.title}</strong>
              {i.variant ? ` · ${i.variant}` : ''} — {i.reason}
            </p>
          ))}
        </div>
      )}

      {eligible.length > 0 && (
        <>
          <fieldset className="rfield">
            <legend>What happened?</legend>
            {lookup.kinds
              // The statutory cancellation is offered only where the right exists and is
              // still live. Showing it to a US customer would offer a route we then refuse.
              .filter((k) => k.key !== 'withdrawal' || !!selected?.withdrawal)
              .map((k) => (
                <label key={k.key} className="ropt">
                  <input type="radio" name="kind" value={k.key} checked={kind === k.key}
                         onChange={() => setKind(k.key)} />
                  <span>{k.label}</span>
                </label>
              ))}
          </fieldset>

          <p>
            <label htmlFor="rreason">Reason</label>
            <select id="rreason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {lookup.reasons.map((r) => (
                <option key={r.key} value={r.key}
                        disabled={!r.accepted && !selected?.withdrawal}>
                  {r.label}
                  {!r.accepted && !selected?.withdrawal ? ' — not accepted' : ''}
                </option>
              ))}
            </select>
            {/* Shown, disabled, with the reason — rather than absent. Somebody whose shirt
                does not fit needs to be told that, by a form that recognises the reason. */}
            <span className="note">
              All sales are final except faults. A size that does not fit is not something we
              can take back &mdash; see the <a href="/size-guide">size guide</a>.
            </span>
          </p>

          {kind === 'withdrawal' && (
            <p>
              <label htmlFor="rsize">Anything we should know? (optional)</label>
              <input id="rsize" value={size} placeholder="—"
                     onChange={(e) => setSize(e.target.value)} />
            </p>
          )}

          <p>
            <label htmlFor="rcomment">Anything else? (optional)</label>
            <textarea id="rcomment" rows={3} value={comment} maxLength={1000}
                      onChange={(e) => setComment(e.target.value)} />
          </p>

          {/* Stated before submitting, not after. The customer should know who pays before
              they commit, not discover it in an email. */}
          <p className="promise">
            <b>Postage</b>
            {kind === 'withdrawal'
              ? 'Yours on a statutory cancellation. Any tracked service is fine.'
              : 'Ours — this is our error, so the label is on us.'}
          </p>

          {state === 'err' && (
            <p className="rmsg err" role="alert" style={{ color: '#B3261E' }}>{msg}</p>
          )}

          <button className="btn block" type="submit"
                  disabled={state === 'loading' || !line || !selected?.eligible}>
            {state === 'loading' ? 'Sending…' : 'Request this return'}
          </button>
        </>
      )}

      <p style={{ marginTop: '1rem' }}>
        <button className="btn ghost" type="button"
                onClick={() => { setLookup(null); setState('idle'); setMsg('') }}>
          Different order
        </button>
      </p>
    </form>
  )
}
