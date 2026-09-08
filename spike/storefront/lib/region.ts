import { cookies } from 'next/headers'
import { REGION_ID, getRegions, type Region } from './medusa'

/**
 * Which region this visitor is shopping in.
 *
 * **Server-only** — it reads a cookie, so importing it into a client component pulls
 * `next/headers` into the browser bundle and 500s every page. That has happened twice in
 * this codebase (Steps 17 and 22) and is pinned by `lib/line-groups.test.ts`; this module is
 * on the same side of the boundary as `lib/cart.ts` for the same reason.
 *
 * The chosen id is **validated against the live region list** rather than trusted from the
 * cookie. A stale or hand-edited cookie would otherwise send `region_id` values into every
 * catalog query, where they produce empty listings and a cart that cannot be created — a
 * failure that looks like the backend being down.
 */
export const REGION_COOKIE = 'aj_region'

export async function getRegionId(): Promise<string> {
  const chosen = (await cookies()).get(REGION_COOKIE)?.value
  if (!chosen) return REGION_ID

  const regions = await getRegions()
  // An empty list means the backend is unreachable. Trust the cookie in that case rather
  // than resetting everyone to the default region during an outage.
  if (!regions.length) return chosen
  return regions.some((r) => r.id === chosen) ? chosen : REGION_ID
}

export async function getRegion(): Promise<Region | null> {
  const id = await getRegionId()
  const regions = await getRegions()
  return regions.find((r) => r.id === id) ?? null
}

/**
 * The countries checkout will accept for the current region.
 *
 * Returned as `{code, name}` so the address form can offer a real select. The previous
 * version hardcoded `country_code: 'us'` on every order, which silently mislabelled the
 * destination of any non-US order that got through the API.
 */
export async function getRegionCountries(): Promise<{ code: string; name: string }[]> {
  const region = await getRegion()
  return (region?.countries ?? [])
    .map((c) => ({
      code: c.iso_2,
      name: c.display_name || COUNTRY_NAMES[c.iso_2] || c.iso_2.toUpperCase(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Fallback names, for a region whose countries carry no display name. */
const COUNTRY_NAMES: Record<string, string> = {
  us: 'United States', ca: 'Canada', gb: 'United Kingdom', ie: 'Ireland',
  de: 'Germany', fr: 'France', es: 'Spain', it: 'Italy', nl: 'Netherlands',
  be: 'Belgium', dk: 'Denmark', se: 'Sweden', fi: 'Finland', at: 'Austria',
  pt: 'Portugal', pl: 'Poland', cz: 'Czechia', gr: 'Greece', hu: 'Hungary',
  ro: 'Romania', sk: 'Slovakia', si: 'Slovenia', hr: 'Croatia', bg: 'Bulgaria',
  ee: 'Estonia', lv: 'Latvia', lt: 'Lithuania', lu: 'Luxembourg', mt: 'Malta',
  cy: 'Cyprus', au: 'Australia', nz: 'New Zealand', jp: 'Japan', kr: 'South Korea',
  sg: 'Singapore', hk: 'Hong Kong',
}

/**
 * Whether a region can lawfully be sold to yet.
 *
 * The EU gates in `lib/site.ts` are not engineering work — an IOSS registration, an Article
 * 27 representative and a GPSR responsible person. Until they exist, offering Europe at
 * checkout would place apparel on the EU market unlawfully, so the picker shows the region
 * as unavailable **with the reason** rather than hiding it. A hidden option reads as a bug
 * and generates the email; a stated one answers it.
 */
export function regionBlocked(region: { name: string }, euGatesMissing: number): string | null {
  const EU_REGIONS = ['Europe', 'United Kingdom']
  if (euGatesMissing > 0 && EU_REGIONS.includes(region.name)) {
    return region.name === 'United Kingdom'
      ? 'UK orders need our VAT registration first'
      : 'EU orders need three appointments we have not made yet'
  }
  return null
}
