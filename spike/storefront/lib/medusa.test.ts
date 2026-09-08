import { describe, it, expect } from 'vitest'
import { sortSizes, money, SIZE_ORDER } from './medusa'

describe('sortSizes', () => {
  it('orders sizes as a human would, not alphabetically', () => {
    // The API returns variants unordered — this was a real defect, not a hypothetical.
    const got = sortSizes([{ title: 'XL' }, { title: 'L' }, { title: 'S' },
                           { title: 'M' }, { title: '2XL' }, { title: '3XL' }])
    expect(got.map((v) => v.title)).toEqual(['S', 'M', 'L', 'XL', '2XL', '3XL'])
  })

  it('does not mutate the input', () => {
    const input = [{ title: 'XL' }, { title: 'S' }]
    const copy = [...input]
    sortSizes(input)
    expect(input).toEqual(copy)
  })

  it('handles the fit suffix', () => {
    const got = sortSizes([{ title: 'XL / Youth' }, { title: 'S / Unisex' },
                           { title: 'M / Unisex' }])
    expect(got[0].title).toBe('S / Unisex')
    expect(got[2].title).toBe('XL / Youth')
  })

  it('puts youth sizes after adult ones', () => {
    const got = sortSizes([{ title: 'YS' }, { title: 'L' }, { title: 'YXL' }, { title: 'S' }])
    expect(got.map((v) => v.title)).toEqual(['S', 'L', 'YS', 'YXL'])
  })

  it('sends unknown sizes to the end rather than dropping them', () => {
    const got = sortSizes([{ title: 'WEIRD' }, { title: 'L' }, { title: 'S' }])
    expect(got.map((v) => v.title)).toEqual(['S', 'L', 'WEIRD'])
    expect(got).toHaveLength(3)
  })

  it('is stable for equal ranks', () => {
    const got = sortSizes([{ title: 'ZZZ' }, { title: 'AAA' }])
    expect(got.map((v) => v.title)).toEqual(['AAA', 'ZZZ'])
  })

  it('is case-insensitive', () => {
    expect(sortSizes([{ title: 'xl' }, { title: 's' }]).map((v) => v.title))
      .toEqual(['s', 'xl'])
  })

  it('handles an empty list', () => {
    expect(sortSizes([])).toEqual([])
  })

  it('covers every size the pipeline can emit', () => {
    for (const s of ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL',
                     'YS', 'YM', 'YL', 'YXL', 'Y2XL', 'ONE']) {
      expect(SIZE_ORDER).toContain(s)
    }
  })
})

describe('money', () => {
  it('always shows two decimal places', () => {
    expect(money(64.99)).toBe('$64.99')
    expect(money(5)).toBe('$5.00')
    expect(money(0)).toBe('$0.00')
  })

  it('renders an em dash for an unknown price rather than $0.00', () => {
    // Showing $0.00 for "we do not know" would be a pricing bug on the page.
    expect(money(null)).toBe('—')
    expect(money(undefined)).toBe('—')
  })

  it('rounds to the cent', () => {
    expect(money(69.985)).toBe('$69.99')
    expect(money(0.005)).toBe('$0.01')
  })

  it('handles a large total', () => {
    expect(money(1234.5)).toBe('$1234.50')
  })
})
