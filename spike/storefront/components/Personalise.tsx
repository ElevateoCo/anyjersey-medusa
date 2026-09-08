'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import JerseyBack from './JerseyBack'

/**
 * The personalisation control.
 *
 * personalisation-spec.md §4. The shape follows that spec closely because each point in it
 * is a decision with a cost attached:
 *
 *  1. **Off by default**, one line of copy with the real "from" price — the decision we want
 *     is *which*, not *whether* (research.md §12.4).
 *  2. **Validation is the server's.** The blocklist is not shipped to the browser: putting
 *     it in the bundle publishes exactly what to work around. The client debounces and asks.
 *  3. **Price updates in place**, never a surprise at checkout, and the bundle is applied
 *     automatically — there is no "bundle" option to miss.
 *  4. **The non-returnable notice sits next to the control**, before it is used. That
 *     placement is what makes the exclusion enforceable (spec §7); buried in a policy page
 *     it is not.
 *  5. **Errors are announced**, fields have real labels, and the preview carries a text
 *     alternative that changes with the parameters (§7.9, WCAG 2.1 AA).
 */
export type Offer = {
  eligible: boolean
  reason: string | null
  prices: Record<string, number>
  from: number
  /** True on a custom jersey, where the printing is already in the shirt's price. */
  included?: boolean
  typeface: string
  patches: string[]
  notice: { non_returnable: string; lead_time: string }
}
type Check = {
  ok: boolean
  errors: { field: string; message: string }[]
  normalised: { name: string | null; number: string | null; patch: string | null }
  lines: { kind: string; label: string; price: number }[]
  total: number
  typeface: string
}

export type Selection = {
  name: string | null
  number: string | null
  patch: string | null
  total: number
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

export default function Personalise({
  productId, colour, offer, onChange,
}: {
  productId: string
  colour?: string | null
  /**
   * Fetched by the page on the server and passed in, rather than fetched here on mount.
   *
   * Fetching it client-side meant the control was absent from the server HTML entirely:
   * invisible to crawlers, invisible to the static accessibility audit, and arriving as a
   * layout shift after paint. For the block the spec calls the substitute for the missing
   * back photograph, being absent from the initial render is the wrong default.
   */
  offer: Offer | null
  onChange?: (sel: Selection | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [patch, setPatch] = useState('')
  const [check, setCheck] = useState<Check | null>(null)
  const [checking, setChecking] = useState(false)
  const seq = useRef(0)

  // Debounced, and sequence-guarded: without the guard a slow response for "ALLE" can land
  // after the fast one for "ALLEN" and repaint the older answer.
  useEffect(() => {
    if (!open) return
    if (!name && !number && !patch) { setCheck(null); onChange?.(null); return }
    const mine = ++seq.current
    setChecking(true)
    const t = setTimeout(() => {
      api('/store/personalisation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, name, number, patch }),
      })
        .then((c: Check) => {
          if (mine !== seq.current) return
          setCheck(c)
          /**
           * Gate on whether anything was *accepted*, not on whether it costs money.
           *
           * `c.total > 0` was the old test, and on a custom jersey every accepted selection
           * totals zero — so a customer could type a name, watch the preview update, add to
           * bag, and receive a blank shirt with nothing recorded. Validation failures still
           * yield null because `normalised` returns only the fields that passed.
           */
          const accepted = !!(c.normalised.name || c.normalised.number || c.normalised.patch)
          onChange?.(accepted ? { ...c.normalised, total: c.total } : null)
        })
        .catch(() => { if (mine === seq.current) setCheck(null) })
        .finally(() => { if (mine === seq.current) setChecking(false) })
    }, 300)
    return () => clearTimeout(t)
  }, [name, number, patch, open, productId])

  const errorFor = (field: string) =>
    check?.errors.find((e) => e.field === field)?.message

  const preview = useMemo(
    () => ({
      name: check?.normalised.name ?? (name ? name.toUpperCase() : null),
      number: check?.normalised.number ?? (/^\d{1,2}$/.test(number) ? number : null),
    }),
    [check, name, number]
  )

  if (!offer) return null

  if (!offer.eligible) {
    // Silent for the ordinary case (a hat cannot be personalised), explicit for the
    // fixable one — 262 products are excluded only because their taxonomy is unreviewed,
    // and an unexplained missing control never gets fixed.
    return offer.reason?.includes('unreviewed') ? (
      <p className="pers-unavailable">
        Personalisation isn’t available on this shirt yet.
      </p>
    ) : null
  }

  return (
    <section className="pers" aria-labelledby="pers-h">
      {!open ? (
        <button type="button" className="pers-open" onClick={() => setOpen(true)}
                aria-expanded={false} aria-controls="pers-panel">
          <span>
            <strong id="pers-h">
              {offer.included ? 'Add your name and number' : 'Add your name and number'}
            </strong>
            {/* "from $9.99" is a price. On a custom jersey there is nothing to quote, and
                quoting one for something already paid for is the §7.10 problem in
                miniature — so the word is "included", not "from $0.00". */}
            <small>{offer.included ? 'Included — no extra charge' : `from ${money(offer.from)}`}</small>
          </span>
          <span aria-hidden="true" className="pers-chev">+</span>
        </button>
      ) : (
        <div className="pers-panel" id="pers-panel">
          <div className="pers-head">
            <h3 id="pers-h">Personalise this shirt</h3>
            <button type="button" className="pers-close" onClick={() => {
              setOpen(false); setName(''); setNumber(''); setPatch('')
              setCheck(null); onChange?.(null)
            }}>
              Remove
            </button>
          </div>

          <div className="pers-grid">
            <div className="pers-preview">
              <JerseyBack
                name={preview.name}
                number={preview.number}
                colour={colour ?? undefined}
                typeface={check?.typeface ?? offer.typeface}
              />
              <p className="pers-preview-note">
                Preview only — printing is centred and sized to the shirt.
              </p>
            </div>

            <div className="pers-fields">
              <div className="pers-field">
                <label htmlFor="pers-name">
                  Name <span>{offer.included ? 'Included' : money(offer.prices.name)}</span>
                </label>
                <input
                  id="pers-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={14}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ALLEN"
                  aria-describedby="pers-name-help"
                  aria-invalid={!!errorFor('name')}
                />
                <p id="pers-name-help" className={errorFor('name') ? 'pers-err' : 'pers-help'}>
                  {/* Explained in words, never as a regex — a regex gets abandoned. */}
                  {errorFor('name') ?? 'Up to 14 letters. Spaces, apostrophes and hyphens are fine.'}
                </p>
              </div>

              <div className="pers-field">
                <label htmlFor="pers-number">
                  Number <span>{offer.included ? 'Included' : money(offer.prices.number)}</span>
                </label>
                <input
                  id="pers-number"
                  value={number}
                  onChange={(e) => setNumber(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="17"
                  aria-describedby="pers-number-help"
                  aria-invalid={!!errorFor('number')}
                />
                <p id="pers-number-help" className={errorFor('number') ? 'pers-err' : 'pers-help'}>
                  {errorFor('number') ?? '0 to 99.'}
                </p>
              </div>

              {offer.patches.length > 0 && (
                <div className="pers-field">
                  <label htmlFor="pers-patch">
                    Patch <span>{money(offer.prices.patch)}</span>
                  </label>
                  <select id="pers-patch" value={patch} onChange={(e) => setPatch(e.target.value)}>
                    <option value="">No patch</option>
                    {offer.patches.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {errorFor('patch') && <p className="pers-err">{errorFor('patch')}</p>}
                </div>
              )}

              {/* Announced, so a screen reader hears the price change and the errors. */}
              <div className="pers-total" role="status" aria-live="polite">
                {checking ? (
                  <span className="pers-help">Checking…</span>
                ) : check && check.lines.length > 0 ? (
                  <>
                    <ul>
                      {check.lines.map((l) => (
                        <li key={l.kind}>
                          <span>{l.label}</span>
                          <b>{l.price === 0 ? 'Included' : money(l.price)}</b>
                        </li>
                      ))}
                    </ul>
                    {/* The bundle saving is a real number on a paid add-on and a nonsense
                        one when every line is zero ("$0.00 less than adding them
                        separately"), so it is shown only where it means something. */}
                    {!offer.included && check.lines.some((l) => l.kind === 'bundle') && (
                      <p className="pers-saving">
                        Bundled — {money(offer.prices.name + offer.prices.number - offer.prices.bundle)} less
                        than adding them separately.
                      </p>
                    )}
                  </>
                ) : (
                  <span className="pers-help">
                    {offer.included
                      ? 'Add a name or number, or leave both blank for a plain shirt.'
                      : 'Add a name or number to see the price.'}
                  </span>
                )}
              </div>
            </div>
          </div>

          <p className="pers-notice">
            <strong>Made to order.</strong> {offer.notice.non_returnable} {offer.notice.lead_time}
          </p>
        </div>
      )}
    </section>
  )
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_MEDUSA_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      'x-publishable-api-key': process.env.NEXT_PUBLIC_MEDUSA_PK ?? '',
    },
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json()
}
