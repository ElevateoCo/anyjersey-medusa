'use client'

import { useState } from 'react'

/**
 * Share, or copy the link.
 *
 * The live store has this and it earns its place on a catalogue like ours: a shopper who
 * has found a shirt nobody else stocks wants to send it to somebody, and the alternative is
 * selecting a URL on a phone.
 *
 * `navigator.share` where it exists — that is the native sheet on iOS and Android, which is
 * where this actually gets used. Everywhere else it degrades to the clipboard, and if the
 * clipboard is unavailable too (it needs a secure context, and permissions can refuse) the
 * button says so rather than appearing to have worked. A share control that silently does
 * nothing is worse than no share control.
 *
 * A user gesture is required for both APIs, which is why this is a button and not something
 * that fires on mount.
 */
export default function ShareLink({ title }: { title: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const share = async () => {
    const url = window.location.href

    if (navigator.share) {
      try {
        await navigator.share({ title, url })
        return
      } catch (e) {
        // AbortError is the customer dismissing the sheet — not a failure, and it must not
        // fall through to the clipboard, which would copy a link they chose not to send.
        if ((e as Error).name === 'AbortError') return
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
      setTimeout(() => setState('idle'), 2500)
    } catch {
      setState('failed')
    }
  }

  return (
    <p className="sharerow">
      <button type="button" className="sharebtn" onClick={share}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M11.5 5.5a2.5 2.5 0 1 0-2.34-3.3L5.9 3.86a2.5 2.5 0 1 0 0 4.28l3.26 1.66a2.5 2.5 0 1 0 .55-1.1L6.45 7.05a2.5 2.5 0 0 0 0-2.1l3.26-1.66a2.5 2.5 0 0 0 1.79.21Z"
                fill="currentColor" />
        </svg>
        Share this jersey
      </button>
      {/* Announced, not just shown: the button label does not change, so a screen reader
          user gets no feedback from the button itself. */}
      <span role="status" aria-live="polite" className="sharemsg">
        {state === 'copied' ? 'Link copied' : null}
        {state === 'failed' ? 'Could not copy — select the address bar instead' : null}
      </span>
    </p>
  )
}
