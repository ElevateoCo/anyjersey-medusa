'use client'
import { useEffect } from 'react'
import { readConsent } from '@/lib/consent'

/**
 * Analytics loader.
 *
 * The point of this component is what it does *not* do: there is no script tag in the
 * layout. Nothing is fetched, and no identifier is set, until consent has been read and
 * found positive — which is the difference between a compliant banner and a decorative
 * one.
 *
 * POSTHOG_API_KEY is a placeholder. Without it this logs the events it would have sent, so
 * the wiring is testable before an account exists.
 */
export default function Analytics() {
  useEffect(() => {
    const consent = readConsent()
    if (!consent.analytics) return

    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'

    if (!key) {
      // eslint-disable-next-line no-console
      console.info(
        '[analytics] consent granted, no NEXT_PUBLIC_POSTHOG_KEY — would have loaded',
        host
      )
      return
    }

    // Loaded dynamically and only now, so the script never appears for a visitor who
    // declined or who sends GPC.
    const s = document.createElement('script')
    s.src = `${host}/static/array.js`
    s.async = true
    s.crossOrigin = 'anonymous'
    document.head.appendChild(s)
    return () => { s.remove() }
  }, [])

  return null
}
