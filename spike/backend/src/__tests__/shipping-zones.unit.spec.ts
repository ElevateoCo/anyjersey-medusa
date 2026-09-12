import { ZONES, anyFreeShipping, zoneForRegionName } from '../shipping-zones'

describe('shipping zone rate card', () => {
  it('covers the US at $4.99', () => {
    const us = zoneForRegionName('United States')!
    expect(us.rate).toBe(4.99)
  })

  it('never flat-rates international at the domestic price', () => {
    // A 1 lb parcel to the EU costs $25–37 (research.md §14.1).
    for (const z of ZONES.filter((x) => x.zone > 1)) {
      expect(z.rate).toBeGreaterThan(15)
    }
  })

  /**
   * Shipping is charged on every order, in every zone.
   *
   * The two tests that stood here checked that thresholds rose with the rate and stayed
   * well above it — the right assertions for a rate card that offers free shipping, and
   * meaningless for one that does not. They are replaced rather than deleted so the file
   * still says something about `freeOver` and a threshold cannot creep back in unnoticed.
   */
  it('charges shipping on every order, in every zone', () => {
    for (const z of ZONES) expect(z.freeOver).toBe(0)
    expect(anyFreeShipping).toBe(false)
  })

  /**
   * The guard the rest of the application relies on. `0` has to mean "no threshold"
   * everywhere — the cart's progress bar, the buybox line, the checkout summary and the
   * provider's own quote all test `freeOver > 0`. A negative or fractional value would
   * satisfy none of them consistently.
   */
  it('expresses "no threshold" as exactly zero', () => {
    for (const z of ZONES) {
      expect(Number.isInteger(z.freeOver)).toBe(true)
      expect(z.freeOver).toBeGreaterThanOrEqual(0)
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
