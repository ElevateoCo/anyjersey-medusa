import { describe, it, expect } from 'vitest'
import { regimeFor } from './geo'

/**
 * Which consent regime a visitor falls under.
 *
 * The mapping is the whole compliance decision, so it is pinned rather than trusted: get it
 * wrong towards `opt-out` and every page view into Europe is an ePrivacy violation; get it
 * wrong towards `opt-in` and a Texan sees a banner they did not need.
 */
describe('regimeFor', () => {
  it('asks in the EU and the EEA', () => {
    for (const c of ['DE', 'FR', 'IE', 'PL', 'NO', 'IS', 'LI']) {
      expect(regimeFor(c, null)).toBe('opt-in')
    }
  })

  it('asks in the UK and Switzerland, which are their own regimes', () => {
    expect(regimeFor('GB', null)).toBe('opt-in')
    expect(regimeFor('CH', null)).toBe('opt-in')
  })

  it('asks in Brazil, which is opt-in and not in Europe', () => {
    expect(regimeFor('BR', null)).toBe('opt-in')
  })

  it('only tells, in most of the US', () => {
    for (const c of ['US']) expect(regimeFor(c, 'TX')).toBe('opt-out')
    expect(regimeFor('US', 'NY')).toBe('opt-out')
  })

  /**
   * The assertion that costs the most to get wrong. California's own privacy law is an
   * opt-out law; CIPA is a wiretapping statute, and the cases defendants win are the ones
   * where nothing fired before an affirmative opt-in.
   */
  it('asks in California, because of CIPA rather than the CCPA', () => {
    expect(regimeFor('US', 'CA')).toBe('opt-in')
    expect(regimeFor('us', 'ca')).toBe('opt-in')
  })

  it('asks in Québec and only tells in the rest of Canada', () => {
    expect(regimeFor('CA', 'QC')).toBe('opt-in')
    expect(regimeFor('CA', 'ON')).toBe('opt-out')
  })

  /**
   * The subdivision codes collide across countries — `CA` is both Canada and California —
   * so the key has to carry the country. Canada must not become opt-in because someone
   * read `CA` as the state.
   */
  it('does not confuse Canada with California', () => {
    expect(regimeFor('CA', null)).toBe('opt-out')
    expect(regimeFor('US', 'CA')).toBe('opt-in')
  })

  /**
   * No edge header: local development, a direct origin hit, a CDN not yet configured. The
   * strict answer is the safe error in both directions.
   */
  it('asks when it does not know where the visitor is', () => {
    expect(regimeFor(null, null)).toBe('opt-in')
    expect(regimeFor(null, 'CA')).toBe('opt-in')
  })

  it('only tells in Asia-Pacific, where the shop already ships', () => {
    for (const c of ['AU', 'NZ', 'JP', 'SG', 'HK', 'KR']) {
      expect(regimeFor(c, null)).toBe('opt-out')
    }
  })
})
