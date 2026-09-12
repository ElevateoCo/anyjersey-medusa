import { describe, it, expect } from 'vitest'
import { buildQuery, toggleQuery, valuesFor } from './query'

describe('buildQuery', () => {
  it('adds a filter', () => {
    expect(buildQuery({}, { league: 'NFL' })).toBe('/jerseys?league=NFL')
  })

  it('keeps existing filters', () => {
    expect(buildQuery({ league: 'NFL' }, { colourway: 'white' }))
      .toBe('/jerseys?league=NFL&colourway=white')
  })

  it('removes a filter when passed undefined', () => {
    expect(buildQuery({ league: 'NFL', colourway: 'white' }, { league: undefined }))
      .toBe('/jerseys?colourway=white')
  })

  it('returns the bare path when nothing is left', () => {
    expect(buildQuery({ league: 'NFL' }, { league: undefined })).toBe('/jerseys')
    expect(buildQuery({}, {})).toBe('/jerseys')
  })

  it('resets pagination whenever a filter changes', () => {
    // Otherwise you change the filter and land on an empty page 5 of a 12-result set.
    expect(buildQuery({ league: 'NFL', offset: '96' }, { colourway: 'white' }))
      .not.toContain('offset')
  })

  it('still allows an explicit offset for paging', () => {
    expect(buildQuery({ league: 'NFL' }, { offset: '24' }))
      .toBe('/jerseys?league=NFL&offset=24')
  })

  it('url-encodes multi-word values', () => {
    const url = buildQuery({}, { team: 'Dallas Cowboys' })
    expect(url).toContain('Dallas+Cowboys')
    expect(new URLSearchParams(url.split('?')[1]).get('team')).toBe('Dallas Cowboys')
  })

  /**
   * This test used to assert the opposite — that a repeated key was *dropped* on rebuild.
   * That was defensible while nothing in the storefront produced one. The category bar
   * now does: "Shop by Team" and "Shop & Kits" link to `?garment=shorts&garment=set`, and
   * under the old rule a shopper who then touched a filter or the sort control silently
   * got the whole 4,300-product catalogue back, with the chips still claiming the filter
   * was applied. Preserving the repeat is the contract now.
   */
  it('preserves a repeated key when rebuilding', () => {
    expect(buildQuery({ garment: ['shorts', 'set'], team: undefined }, { colourway: 'red' }))
      .toBe('/jerseys?garment=shorts&garment=set&colourway=red')
  })

  it('still drops undefined and empty values', () => {
    expect(buildQuery({ league: undefined, team: '' }, { colourway: 'red' }))
      .toBe('/jerseys?colourway=red')
  })

  it('replaces a repeated key when that key is the one being changed', () => {
    // Clicking a single garment in the sidebar must not add a third value to the two the
    // nav slot put there.
    expect(buildQuery({ garment: ['shorts', 'set'] }, { garment: 'jersey' }))
      .toBe('/jerseys?garment=jersey')
  })

  it('overwrites rather than appending a repeated key', () => {
    const url = buildQuery({ league: 'NFL' }, { league: 'NBA' })
    expect(url).toBe('/jerseys?league=NBA')
  })

  it('drops empty-string filters', () => {
    expect(buildQuery({ league: '' }, { colourway: 'red' })).toBe('/jerseys?colourway=red')
  })
})

describe('toggleQuery', () => {
  it('adds a value without dropping the one already chosen', () => {
    // The single-select behaviour: picking a second team used to swap it for the first.
    expect(toggleQuery({ team: 'Dallas Cowboys' }, 'team', 'Chicago Bears'))
      .toBe('/jerseys?team=Dallas+Cowboys&team=Chicago+Bears')
  })

  it('removes a value and keeps the rest of that filter', () => {
    expect(toggleQuery({ team: ['Dallas Cowboys', 'Chicago Bears'] }, 'team', 'Dallas Cowboys'))
      .toBe('/jerseys?team=Chicago+Bears')
  })

  it('keeps other filters, including other multi-value ones', () => {
    const url = toggleQuery(
      { garment: ['shorts', 'set'], colourway: 'white' }, 'team', 'Chicago Bears')
    const q = new URLSearchParams(url.split('?')[1])
    expect(q.getAll('garment')).toEqual(['shorts', 'set'])
    expect(q.get('colourway')).toBe('white')
    expect(q.getAll('team')).toEqual(['Chicago Bears'])
  })

  it('resets pagination, like every other filter change', () => {
    expect(toggleQuery({ offset: '96' }, 'team', 'Chicago Bears')).not.toContain('offset')
  })

  it('returns the bare path once the last value is removed', () => {
    expect(toggleQuery({ team: 'Chicago Bears' }, 'team', 'Chicago Bears')).toBe('/jerseys')
  })
})

describe('valuesFor', () => {
  it('reads one value and several the same way', () => {
    expect(valuesFor({ team: 'A' }, 'team')).toEqual(['A'])
    expect(valuesFor({ team: ['A', 'B'] }, 'team')).toEqual(['A', 'B'])
    expect(valuesFor({}, 'team')).toEqual([])
    expect(valuesFor({ team: '' }, 'team')).toEqual([])
  })
})
