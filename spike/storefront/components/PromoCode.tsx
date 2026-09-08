'use client'
import { useState, useTransition } from 'react'
import { applyPromoAction, removePromoAction } from '@/app/actions'

/**
 * Discount code entry.
 *
 * The code is sent to the server and the total comes back from Medusa's promotion engine.
 * Nothing here computes a discount — same rule as line prices (research.md §5.2 rule 1): a
 * client that can name a discount can name 100%.
 *
 * Collapsed by default. An open, empty "promo code" field is a well-documented conversion
 * leak: it tells every customer that a better price exists and sends them off to look for
 * it. research.md §9.1 argues against percentage codes for this shop anyway — the fixed
 * $0.30 does not shrink, so a 20% code raises the effective card rate on top of what it gives
 * away — which is why the free-shipping progress bar is the prominent mechanic and this is
 * one line of text.
 */
export default function PromoCode({
  applied,
}: {
  applied: { code: string }[]
}) {
  const [open, setOpen] = useState(applied.length > 0)
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [pending, start] = useTransition()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setMsg('')
    start(async () => {
      const res = await applyPromoAction(code)
      if (res.ok) setCode('')
      else setMsg(res.message)
    })
  }

  return (
    <div className="promo">
      {applied.length > 0 && (
        <ul className="promolist">
          {applied.map((p) => (
            <li key={p.code}>
              <span className="promotag">{p.code}</span>
              <button type="button" disabled={pending}
                      onClick={() => start(async () => { await removePromoAction(p.code) })}>
                Remove<span className="visually-hidden"> code {p.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <button type="button" className="promotoggle" onClick={() => setOpen(true)}>
          Have a discount code?
        </button>
      ) : (
        <form onSubmit={submit} className="promoform">
          <label htmlFor="promo">Discount code</label>
          <div className="promorow">
            <input id="promo" value={code} autoComplete="off" spellCheck={false}
                   onChange={(e) => setCode(e.target.value)} />
            <button className="btn" type="submit" disabled={pending || !code.trim()}>
              {pending ? 'Checking…' : 'Apply'}
            </button>
          </div>
          {msg && <p className="rmsg err" role="alert">{msg}</p>}
        </form>
      )}
    </div>
  )
}
