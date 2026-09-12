'use client'
import { useEffect, useState } from 'react'
import {
  readConsent, writeConsent, gpcSignalled,
  type ConsentState, type ConsentRegime,
} from '@/lib/consent'

/**
 * Consent gate.
 *
 * Three things make this different from the usual banner:
 *
 *  1. **Nothing non-essential has loaded by the time you see it.** There is no analytics
 *     script in the layout waiting to be told to stop — consent is checked before
 *     anything is attached.
 *  2. **If GPC is set, no banner appears at all** and the answer is already no. Twelve
 *     states require honouring that automatically, so asking again would be worse than
 *     not asking: it invites a click that cannot lawfully override the signal.
 *  3. **What it renders depends on where the visitor is**, because the law does. The
 *     regime is decided server-side in `lib/geo.ts` from a CDN edge header and handed down
 *     as a plain string — this component never learns the country, which keeps it out of
 *     the browser bundle and out of anything that could be logged client-side.
 *
 * | Regime | Who | What renders |
 * |---|---|---|
 * | `opt-in` | EU/EEA · UK · Switzerland · Brazil · **California** · Québec | A question. Nothing runs until it is answered |
 * | `opt-out` | The rest of the US · Canada outside Québec · Asia-Pacific | A notice. Measurement is on, and one link turns it off |
 *
 * Serving the opt-out notice into Europe would be an ePrivacy violation on every page
 * view; serving the opt-in question everywhere is the safer error and is what happens when
 * no edge header is present, which is why `regime` defaults to `opt-in` rather than being
 * required.
 *
 * In the question, Reject is as prominent as Accept — EU regulators have repeatedly said
 * that is the difference between consent and a dark pattern.
 */
export default function ConsentBanner({ regime = 'opt-in' }: { regime?: ConsentRegime }) {
  const [state, setState] = useState<ConsentState | null>(null)

  useEffect(() => { setState(readConsent(regime)) }, [regime])

  const decide = (analytics: boolean, marketing: boolean) => {
    writeConsent({ analytics, marketing })
    setState({ analytics, marketing, decided: true, reason: 'stored' })
  }

  if (!state || state.decided) {
    // GPC path: never render, never ask.
    return null
  }

  /**
   * The opt-out notice. A strip, not a dialog, and it does not gate anything — under these
   * laws the obligation is notice at collection plus a working way out, and a modal that
   * blocks a shop in a jurisdiction that never asked for one is friction bought for
   * nothing. "Turn measurement off" is one click, and `/privacy-choices` stays in the
   * footer of every page afterwards.
   */
  if (regime === 'opt-out') {
    return (
      <div className="consent notice" role="region" aria-label="Privacy notice">
        <div className="consent-inner">
          <p>
            We use cookies to run the shop and to measure how it is used. We do not sell or
            share personal information.
          </p>
          <div className="consent-actions">
            <button className="btn" onClick={() => decide(true, false)}>OK</button>
            <button className="consent-link" onClick={() => decide(false, false)}>
              Turn measurement off
            </button>
            <a className="consent-link" href="/privacy-choices">Your privacy choices</a>
          </div>
        </div>
      </div>
    )
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
