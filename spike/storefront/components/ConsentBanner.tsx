'use client'
import { useEffect, useState } from 'react'
import { readConsent, writeConsent, gpcSignalled, type ConsentState } from '@/lib/consent'

/**
 * Consent gate.
 *
 * Two things make this different from the usual banner:
 *
 *  1. **Nothing non-essential has loaded by the time you see it.** There is no analytics
 *     script in the layout waiting to be told to stop — consent is checked before
 *     anything is attached.
 *  2. **If GPC is set, no banner appears at all** and the answer is already no. Twelve
 *     states require honouring that automatically, so asking again would be worse than
 *     not asking: it invites a click that cannot lawfully override the signal.
 *
 * Reject is as prominent as Accept, which the EU regulators have repeatedly said is the
 * difference between consent and a dark pattern.
 */
export default function ConsentBanner() {
  const [state, setState] = useState<ConsentState | null>(null)

  useEffect(() => { setState(readConsent()) }, [])

  const decide = (analytics: boolean, marketing: boolean) => {
    writeConsent({ analytics, marketing })
    setState({ analytics, marketing, decided: true, reason: 'stored' })
  }

  if (!state || state.decided) {
    // GPC path: never render, never ask.
    return null
  }

  return (
    <div className="consent" role="dialog" aria-modal="false"
         aria-label="Cookie and tracking choices">
      <div className="consent-inner">
        <p>
          We use essential cookies to run the shop. We would also like to measure how the
          site is used. <strong>Nothing optional runs until you choose.</strong>
        </p>
        <div className="consent-actions">
          <button className="btn" onClick={() => decide(true, true)}>Accept all</button>
          <button className="btn ghost dark" onClick={() => decide(false, false)}>
            Essential only
          </button>
          <button className="consent-link" onClick={() => decide(true, false)}>
            Measurement only
          </button>
        </div>
        {gpcSignalled() && (
          <p className="consent-note">
            Your browser sends Global Privacy Control, so optional tracking is already off.
          </p>
        )}
      </div>
    </div>
  )
}
