/**
 * Consent and Global Privacy Control.
 *
 * research.md §7.4 and §7.7 between them require three distinct things, and they are not
 * the same mechanism:
 *
 *  - **EU/UK (ePrivacy + GDPR):** opt-IN. No non-essential script may fire before a
 *    positive choice. A banner that loads analytics and asks afterwards is the single most
 *    commonly enforced violation.
 *  - **US state laws:** opt-OUT. Collection is allowed by default, with a right to stop
 *    sale or sharing.
 *  - **Global Privacy Control:** twelve states require honouring the GPC signal
 *    **automatically**, with no confirmation step. A banner that ignores GPC is
 *    non-compliance regardless of what the user later clicks.
 *
 * So GPC is checked first and wins outright, and the default posture is the strict one:
 * nothing non-essential runs until we know otherwise.
 */
export type ConsentState = {
  analytics: boolean
  marketing: boolean
  decided: boolean
  reason: 'gpc' | 'stored' | 'default'
}

export const CONSENT_COOKIE = 'aj_consent'

/** Browsers expose GPC as navigator.globalPrivacyControl and a Sec-GPC request header. */
export function gpcSignalled(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean | string }
  return nav.globalPrivacyControl === true || nav.globalPrivacyControl === '1'
}

export function readConsent(): ConsentState {
  // GPC is not a preference to be overridden by a banner click — it is a legal signal.
  if (gpcSignalled()) {
    return { analytics: false, marketing: false, decided: true, reason: 'gpc' }
  }
  if (typeof document !== 'undefined') {
    const raw = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${CONSENT_COOKIE}=`))
      ?.split('=')[1]
    if (raw) {
      try {
        const parsed = JSON.parse(decodeURIComponent(raw))
        return {
          analytics: !!parsed.analytics,
          marketing: !!parsed.marketing,
          decided: true,
          reason: 'stored',
        }
      } catch { /* fall through to the strict default */ }
    }
  }
  // Strict by default. Anything else means the first page view leaks.
  return { analytics: false, marketing: false, decided: false, reason: 'default' }
}

export function writeConsent(next: { analytics: boolean; marketing: boolean }) {
  const value = encodeURIComponent(JSON.stringify({ ...next, at: new Date().toISOString() }))
  // Not httpOnly: the client needs to read it to decide whether to load anything.
  document.cookie =
    `${CONSENT_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`
}
