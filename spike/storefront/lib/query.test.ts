import { describe, it, expect } from 'vitest'
import { buildQuery } from './query'

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

  it('survives array and undefined values in the incoming search params', () => {
    expect(buildQuery({ league: ['NFL', 'NBA'], team: undefined }, { colourway: 'red' }))
      .toBe('/jerseys?colourway=red')
  })

  it('overwrites rather than appending a repeated key', () => {
    const url = buildQuery({ league: 'NFL' }, { league: 'NBA' })
    expect(url).toBe('/jerseys?league=NBA')
  })

  it('drops empty-string filters', () => {
    expect(buildQuery({ league: '' }, { colourway: 'red' })).toBe('/jerseys?colourway=red')
  })
})
