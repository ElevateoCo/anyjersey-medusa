/**
 * Single source of truth for the zone rate card — research.md §14.3.
 *
 * Imported by both the seed script and the store API so the storefront can never show a
 * rate or threshold that disagrees with what checkout actually charges. Previously the
 * cart page hardcoded $4.99 and a $75 threshold, which was wrong for every zone except
 * the US.
 */
export type Zone = {
  zone: number
  name: string
  rate: number
  /**
   * Order value above which shipping is free. **`0` means there is no such threshold**, and
   * every consumer treats it that way — the cart's progress bar, the buybox line, the
   * checkout summary and the rate the fulfilment provider quotes all guard on `> 0`.
   *
   * It is currently `0` for every zone: shipping is charged on every order, at the zone's
   * rate. The field stays rather than being deleted because a free-shipping threshold is a
   * merchandising lever this shop may well want back — `research.md` §9.1 argues for it
   * over percentage discount codes — and removing the mechanic to express "off" would mean
   * rebuilding it to turn it on.
   */
  freeOver: number
  countries: string[]
  leadTime: string
}

/**
 * The rate card.
 *
 * One rate per zone, charged on every order. The US is flat $4.99; everywhere else is the
 * zone's own rate, which is what "calculated depending on the country" means here — the
 * country picks the zone and the zone carries the price.
 */
export const ZONES: Zone[] = [
  { zone: 1, name: 'United States', rate: 4.99, freeOver: 0, countries: ['us'],
    leadTime: 'Tracked, 3–5 business days.' },
  { zone: 2, name: 'Canada', rate: 19.99, freeOver: 0, countries: ['ca'],
    leadTime: 'Tracked, 6–12 business days. Duties and taxes collected at checkout.' },
  { zone: 3, name: 'United Kingdom', rate: 24.99, freeOver: 0, countries: ['gb'],
    leadTime: 'Tracked, 8–16 business days. VAT collected at checkout.' },
  { zone: 3, name: 'Europe', rate: 24.99, freeOver: 0,
    countries: ['de', 'fr', 'es', 'it', 'nl', 'be', 'dk', 'se', 'fi', 'ie', 'at', 'pt',
                'pl', 'cz', 'gr', 'hu', 'ro', 'sk', 'si', 'hr', 'bg', 'ee', 'lv', 'lt',
                'lu', 'mt', 'cy'],
    leadTime: 'Tracked, 8–16 business days. VAT and customs duty collected at checkout.' },
  { zone: 4, name: 'Asia Pacific', rate: 29.99, freeOver: 0,
    countries: ['au', 'nz', 'jp', 'kr', 'sg', 'hk'],
    leadTime: 'Tracked, 10–18 business days. Duties and taxes collected at checkout.' },
]

/** True when any zone still offers free shipping, so the UI can drop the column entirely. */
export const anyFreeShipping = ZONES.some((z) => z.freeOver > 0)

export const zoneForRegionName = (name?: string | null) =>
  ZONES.find((z) => z.name === name)
