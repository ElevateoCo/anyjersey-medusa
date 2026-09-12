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
 *    sale or sharing. **California is the exception and is treated as opt-in** — not
 *    because of the CCPA, which is an ordinary opt-out law, but because of CIPA. See
 *    `lib/geo.ts`.
 *  - **Global Privacy Control:** twelve states require honouring the GPC signal
 *    **automatically**, with no confirmation step. A banner that ignores GPC is
 *    non-compliance regardless of what the user later clicks.
 *
 * So GPC is checked first and wins outright, and the default posture is the strict one:
 * nothing non-essential runs until we know otherwise.
 */
/**
 * Which regime the visitor is under. Decided server-side from an edge header in
 * `lib/geo.ts`, and declared **here** rather than there because this module is the one a
 * client component may import — `lib/geo.ts` reads request headers and would take
 * `next/headers` into the browser bundle with it.
 */
export type ConsentRegime = 'opt-in' | 'opt-out'

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

/**
 * @param regime what the visitor's location requires. Defaults to the strict answer, so a
 *   caller that forgets to pass it fails safe rather than silently opting somebody in.
 */
export function readConsent(regime: ConsentRegime = 'opt-in'): ConsentState {
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
  /**
   * No stored choice yet, so the regime decides the starting posture.
   *
   * **opt-in** — nothing. Under ePrivacy the first page view may not set a measurement
   * cookie, and a banner that loads analytics and asks afterwards is the single most
   * commonly enforced violation.
   *
   * **opt-out** — measurement on, marketing off. Twenty US states, Canada outside Québec
   * and most of Asia-Pacific permit collection with notice and a right to stop. Marketing
   * is still off: the opt-out right exists specifically for sale and sharing for targeted
   * advertising, and defaulting that on in a shop with no ad pixel would be risk bought
   * for nothing.
   *
   * `decided` is false either way — the visitor has been told, not asked, and the notice
   * stays until they dismiss it.
   */
  const analytics = regime === 'opt-out'
  return { analytics, marketing: false, decided: false, reason: 'default' }
}

export function writeConsent(next: { analytics: boolean; marketing: boolean }) {
  const value = encodeURIComponent(JSON.stringify({ ...next, at: new Date().toISOString() }))
  // Not httpOnly: the client needs to read it to decide whether to load anything.
  document.cookie =
    `${CONSENT_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`
}
