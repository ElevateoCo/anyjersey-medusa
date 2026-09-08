import { ZONES, zoneForRegionName } from '../shipping-zones'

describe('shipping zone rate card', () => {
  it('covers the US at $4.99', () => {
    const us = zoneForRegionName('United States')!
    expect(us.rate).toBe(4.99)
    expect(us.freeOver).toBe(75)
  })

  it('never flat-rates international at the domestic price', () => {
    // A 1 lb parcel to the EU costs $25–37 (research.md §14.1).
    for (const z of ZONES.filter((x) => x.zone > 1)) {
      expect(z.rate).toBeGreaterThan(15)
    }
  })

  it('raises the free-shipping threshold with the rate', () => {
    // A $75 threshold makes sense at $5 shipping and gives away the order at $25.
    const sorted = [...ZONES].sort((a, b) => a.rate - b.rate)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].freeOver).toBeGreaterThanOrEqual(sorted[i - 1].freeOver)
    }
  })

  it('keeps every threshold well above the rate it offsets', () => {
    for (const z of ZONES) {
      expect(z.freeOver).toBeGreaterThan(z.rate * 3)
    }
  })

  it('assigns no country to two zones', () => {
    const seen = new Set<string>()
    for (const z of ZONES) {
      for (const c of z.countries) {
        expect(seen.has(c)).toBe(false)
        seen.add(c)
      }
    }
  })

  it('uses lowercase two-letter country codes', () => {
    for (const z of ZONES) {
      for (const c of z.countries) expect(c).toMatch(/^[a-z]{2}$/)
    }
  })

  it('covers the whole EU in one zone', () => {
    const eu = ZONES.find((z) => z.name === 'Europe')!
    expect(eu.countries.length).toBeGreaterThanOrEqual(27)
    for (const c of ['de', 'fr', 'es', 'it', 'nl', 'dk', 'ie', 'pl']) {
      expect(eu.countries).toContain(c)
    }
  })

  it('separates the UK from the EU', () => {
    // Post-Brexit the UK is its own VAT regime — £135 rather than IOSS (§7.3).
    const eu = ZONES.find((z) => z.name === 'Europe')!
    expect(eu.countries).not.toContain('gb')
    expect(zoneForRegionName('United Kingdom')).toBeDefined()
  })

  it('tells international customers that duties are collected at checkout', () => {
    // DDP, not DAP: a surprise bill on delivery produces refusals (§14.3).
    for (const z of ZONES.filter((x) => x.zone > 1)) {
      expect(z.leadTime.toLowerCase()).toMatch(/vat|duties|taxes/)
    }
  })

  it('gives every zone a lead time', () => {
    for (const z of ZONES) expect(z.leadTime.length).toBeGreaterThan(10)
  })

  it('returns undefined for an unknown region rather than guessing', () => {
    expect(zoneForRegionName('Atlantis')).toBeUndefined()
    expect(zoneForRegionName(null)).toBeUndefined()
    expect(zoneForRegionName(undefined)).toBeUndefined()
  })
})
