'use client'
import { useEffect, useState } from 'react'
import { gpcSignalled, readConsent, writeConsent, type ConsentState } from '@/lib/consent'

/**
 * The opt-out control the page's own text promises.
 *
 * The live store's version of this page ends with *"please follow the instructions below"*
 * and then has no instructions and no control. Under the twelve state laws that require an
 * opt-out mechanism, a page that describes the right without providing a way to exercise it
 * is the violation rather than the remedy — so the text is theirs and the control is real.
 *
 * Three states, and they are not the same:
 *
 *  - **GPC is set** — already opted out, automatically, and nothing here can override it.
 *    Rendering an enabled toggle would invite a click that has no lawful effect.
 *  - **Opted out by choice** — stored in the consent cookie.
 *  - **Not opted out** — the toggle does something.
 */
export default function PrivacyChoices() {
  const [state, setState] = useState<ConsentState | null>(null)
  const [gpc, setGpc] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setState(readConsent())
    setGpc(gpcSignalled())
  }, [])

  if (!state) {
    // Server render and first paint: no cookie has been read yet. Claiming either state
    // here would be a guess shown as a fact.
    return <p className="note">Checking your current setting…</p>
  }

  if (gpc) {
    return (
      <div className="callout" role="status">
        <strong>You are already opted out.</strong> Your browser is sending a Global Privacy
        Control signal and we have honoured it automatically for this browser and device. You
        do not need to do anything, and nothing on this page can override it.
      </div>
    )
  }

  const optedOut = !state.analytics && !state.marketing

  const choose = (out: boolean) => {
    writeConsent({ analytics: !out, marketing: !out })
    setState({ analytics: !out, marketing: !out, decided: true, reason: 'stored' })
    setSaved(true)
  }

  return (
    <div className="choices">
      <p className="note" role="status">
        {optedOut
          ? 'Right now: opted out. Nothing non-essential is loaded on this browser.'
          : 'Right now: opted in. Analytics runs on this browser.'}
        {saved ? ' Saved.' : ''}
      </p>
      <div className="choicerow">
        <button type="button" className="btn" onClick={() => choose(true)} disabled={optedOut}>
          Opt out of sale or sharing
        </button>
        <button type="button" className="btn ghost dark" onClick={() => choose(false)}
                disabled={!optedOut}>
          Allow it
        </button>
      </div>
      <p className="note">
        This choice is stored in a cookie on this browser, so it applies to this device only —
        which is a limitation of the mechanism the law specifies, not of this shop. Clearing
        your cookies clears the choice.
      </p>
    </div>
  )
}
