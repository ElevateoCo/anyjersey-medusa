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
  freeOver: number
  countries: string[]
  leadTime: string
}

export const ZONES: Zone[] = [
  { zone: 1, name: 'United States', rate: 4.99, freeOver: 75, countries: ['us'],
    leadTime: 'Tracked, 3–5 business days.' },
  { zone: 2, name: 'Canada', rate: 19.99, freeOver: 150, countries: ['ca'],
    leadTime: 'Tracked, 6–12 business days. Duties and taxes collected at checkout.' },
  { zone: 3, name: 'United Kingdom', rate: 24.99, freeOver: 175, countries: ['gb'],
    leadTime: 'Tracked, 8–16 business days. VAT collected at checkout.' },
  { zone: 3, name: 'Europe', rate: 24.99, freeOver: 175,
    countries: ['de', 'fr', 'es', 'it', 'nl', 'be', 'dk', 'se', 'fi', 'ie', 'at', 'pt',
                'pl', 'cz', 'gr', 'hu', 'ro', 'sk', 'si', 'hr', 'bg', 'ee', 'lv', 'lt',
                'lu', 'mt', 'cy'],
    leadTime: 'Tracked, 8–16 business days. VAT and customs duty collected at checkout.' },
  { zone: 4, name: 'Asia Pacific', rate: 29.99, freeOver: 200,
    countries: ['au', 'nz', 'jp', 'kr', 'sg', 'hk'],
    leadTime: 'Tracked, 10–18 business days. Duties and taxes collected at checkout.' },
]

export const zoneForRegionName = (name?: string | null) =>
  ZONES.find((z) => z.name === name)
