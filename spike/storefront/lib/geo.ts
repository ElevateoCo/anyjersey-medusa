import { headers } from 'next/headers'
import type { ConsentRegime } from './consent'

/**
 * Where the visitor is, and which consent regime that puts them under.
 *
 * **Server-only** — it reads request headers, so importing it into a client component pulls
 * `next/headers` into the browser bundle and 500s every page. Same side of the boundary as
 * `lib/region.ts` and `lib/cart.ts`, and for the same reason: this codebase has crossed it
 * twice (Steps 17 and 22).
 *
 * ---
 *
 * **Why this is not the shipping region.** `lib/region.ts` knows where the customer is
 * shipping *to*, which they chose. This is about where they *are*, which decides what the
 * law requires of us before a script runs. A German on holiday in Texas buying a shirt for
 * a US address is still a German under GDPR when the page loads. The two must not be
 * conflated, and nothing here reads the region cookie.
 *
 * **Where the country comes from.** A CDN edge header. Every host that matters sets one,
 * and none of them can be spoofed into existence by a client because the edge overwrites
 * whatever arrived. We do not geolocate an IP ourselves: it would mean shipping an IP to a
 * third-party lookup on the first page view, which is the processing we are trying to gate.
 *
 * **When there is no header — local development, a direct origin hit, a CDN not yet
 * configured — the answer is `opt-in`.** The strict regime is the safe default in both
 * directions: showing an EU-style banner to a Texan is a minor annoyance, and showing a
 * US-style notice to a Berliner is an ePrivacy violation on every page view.
 */

/** EU and EEA, plus the UK and Switzerland, which are separate regimes with the same answer. */
const OPT_IN_COUNTRIES = new Set([
  // EU 27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // EEA
  'IS', 'LI', 'NO',
  // UK — UK GDPR + PECR. Same answer, different statute.
  'GB',
  // Switzerland — revFADP. Not identical to GDPR, but not an opt-out regime either.
  'CH',
  /**
   * Brazil (LGPD) and, below, Québec (Law 25) are the two non-European jurisdictions that
   * land on opt-in rather than opt-out. They are in this list because the regime is what
   * matters here, not the continent.
   */
  'BR',
])

/**
 * Subdivisions that take the strict regime even though their country does not.
 *
 * **California is here because of CIPA, not CCPA.** California's own privacy statute is an
 * opt-out law like every other US state's. The California Invasion of Privacy Act is a 1967
 * wiretapping statute, and since 2024 plaintiffs have used its pen-register provision
 * against ordinary web trackers: by July 2026 there were close to four thousand filings in
 * California, at $5,000 of statutory damages per violation. The cases that defendants win
 * are the ones where nothing fired before an affirmative opt-in; the ones they lose are the
 * ones where a banner appeared after the pixel had already sent data. So California gets
 * asked, not merely told.
 *
 * Québec (Law 25) requires opt-in for tracking technologies where the rest of Canada,
 * under PIPEDA, does not.
 */
const OPT_IN_SUBDIVISIONS = new Set(['US-CA', 'CA-QC'])

export type { ConsentRegime }

export type VisitorGeo = {
  /** ISO 3166-1 alpha-2, upper-case, or null when no edge header was present. */
  country: string | null
  /** ISO 3166-2 subdivision code, or null. */
  region: string | null
  regime: ConsentRegime
}

/**
 * The headers, in the order they are trusted.
 *
 * Vercel, Cloudflare, Fastly, AWS CloudFront and Akamai in turn. `x-country-code` last
 * because it is the generic one a reverse proxy is most likely to be told to set by hand.
 */
const COUNTRY_HEADERS = [
  'x-vercel-ip-country',
  'cf-ipcountry',
  'fastly-client-country',
  'cloudfront-viewer-country',
  'x-akamai-edgescape-country',
  'x-country-code',
]

const REGION_HEADERS = [
  'x-vercel-ip-country-region',
  'cf-region-code',
  'cloudfront-viewer-country-region',
]

export function regimeFor(country: string | null, region: string | null): ConsentRegime {
  // No signal is not a licence to assume the permissive answer.
  if (!country) return 'opt-in'
  const c = country.toUpperCase()
  if (OPT_IN_COUNTRIES.has(c)) return 'opt-in'
  if (region && OPT_IN_SUBDIVISIONS.has(`${c}-${region.toUpperCase()}`)) return 'opt-in'
  return 'opt-out'
}

export async function getVisitorGeo(): Promise<VisitorGeo> {
  const h = await headers()
  const first = (names: string[]) => {
    for (const n of names) {
      const v = h.get(n)
      // Cloudflare sends "XX" for an address it cannot place, and "T1" for Tor.
      if (v && v !== 'XX' && v !== 'T1') return v.toUpperCase()
    }
    return null
  }
  const country = first(COUNTRY_HEADERS)
  const region = first(REGION_HEADERS)
  return { country, region, regime: regimeFor(country, region) }
}
