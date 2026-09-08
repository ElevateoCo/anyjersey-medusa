import { describe, it, expect } from 'vitest'
import { jsonLdString, productSchema, breadcrumbs, organisation, website } from './seo'

/**
 * Structured data is a public claim. research.md §7.10: the FTC rule is $51,744 per
 * violation and Google's own policy treats a fabricated rating as spam, so the assertions
 * here are about what the markup must *not* say as much as what it must.
 */
const base = {
  handle: 'buffalo-bills-josh-allen-blue-jersey',
  title: 'Buffalo Bills Josh Allen Blue Jersey',
  price: 64.99,
  currency: 'usd',
  sizes: ['S', 'M', 'L'],
}

describe('jsonLdString', () => {
  it('escapes < and > so a title cannot close the script element', () => {
    // Catalog data, not a hypothetical: a product title is user-supplied text as far as
    // this function is concerned.
    const out = jsonLdString({ name: '</script><script>alert(1)</script>' })
    expect(out).not.toContain('</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('\\u003c')
  })

  it('escapes the closing sequence however it is cased or spaced', () => {
    for (const attempt of ['</SCRIPT>', '</ScRiPt >', '</script\n>']) {
      expect(jsonLdString({ name: attempt })).not.toMatch(/<\/script/i)
    }
  })

  it('escapes U+2028 and U+2029, which are legal JSON and illegal JS', () => {
    // Written as escapes, not literals: these characters are invisible in an editor,
    // so a tidy-up would silently remove them and leave a test passing for the
    // wrong reason.
    const out = jsonLdString({ name: 'a\u2028b\u2029c' })
    expect(out).toContain('\\u2028')
    expect(out).toContain('\\u2029')
    expect(out).not.toContain('\u2028')
    expect(out).not.toContain('\u2029')
  })

  it('still produces parseable JSON after escaping', () => {
    const out = jsonLdString({ name: 'A <b>bold</b> jersey' })
    // The escapes are JSON unicode escapes, so a parser restores the original string.
    expect(JSON.parse(out).name).toBe('A <b>bold</b> jersey')
  })
})

describe('productSchema', () => {
  it('prices as a two-decimal string, never a float', () => {
    // A float here reintroduces exactly the rounding problem §6.2 is about.
    const node: any = productSchema({ ...base, price: 64.9 })
    expect(node.offers.price).toBe('64.90')
    expect(typeof node.offers.price).toBe('string')
  })

  it('says BackOrder, because nothing in this catalog is stock-tracked', () => {
    const node: any = productSchema(base)
    expect(node.offers.availability).toBe('https://schema.org/BackOrder')
  })

  it('omits offers entirely when the price is unknown', () => {
    // An offer with no price, or a price of 0, would both be false statements.
    const node: any = productSchema({ ...base, price: null })
    expect(node.offers).toBeUndefined()
  })

  it('omits aggregateRating when there are no reviews', () => {
    const node: any = productSchema({ ...base, reviews: null })
    expect(node.aggregateRating).toBeUndefined()
  })

  it('omits aggregateRating for a zero count rather than emitting an empty one', () => {
    const node: any = productSchema({ ...base, reviews: { count: 0, average: 0 } })
    expect(node.aggregateRating).toBeUndefined()
  })

  it('emits aggregateRating when there are real reviews', () => {
    const node: any = productSchema({ ...base, reviews: { count: 8, average: 4.875 } })
    expect(node.aggregateRating.reviewCount).toBe(8)
    expect(node.aggregateRating.ratingValue).toBe('4.9')
    expect(node.aggregateRating.bestRating).toBe(5)
  })

  it('emits no priceValidUntil, because we do not honour one', () => {
    const node: any = productSchema(base)
    expect(JSON.stringify(node)).not.toContain('priceValidUntil')
  })

  it('never invents a gtin, mpn or sku', () => {
    const json = JSON.stringify(productSchema(base))
    for (const field of ['gtin', 'mpn', 'sku', 'isbn']) {
      expect(json).not.toContain(field)
    }
  })

  it('omits brand when the team is unknown rather than guessing one', () => {
    const node: any = productSchema({ ...base, brand: null })
    expect(node.brand).toBeUndefined()
  })

  it('uppercases the currency, as schema.org requires', () => {
    const node: any = productSchema({ ...base, currency: 'usd' })
    expect(node.offers.priceCurrency).toBe('USD')
  })

  it('uses an absolute url for the product and its offer', () => {
    const node: any = productSchema(base)
    expect(node.url).toMatch(/^https?:\/\//)
    expect(node.offers.url).toBe(node.url)
  })
})

describe('breadcrumbs', () => {
  it('numbers positions from 1 and makes every item absolute', () => {
    const node: any = breadcrumbs([
      { name: 'Home', path: '/' },
      { name: 'Jerseys', path: '/jerseys' },
    ])
    expect(node.itemListElement.map((i: any) => i.position)).toEqual([1, 2])
    for (const i of node.itemListElement) {
      expect(i.item).toMatch(/^https?:\/\//)
    }
  })
})

describe('the site nodes', () => {
  it('gives the store and the site stable ids that reference each other', () => {
    const org: any = organisation()
    const site: any = website()
    expect(site.publisher['@id']).toBe(org['@id'])
  })

  it('declares a search action pointing at the real listing url', () => {
    const site: any = website()
    expect(site.potentialAction.target.urlTemplate).toContain('/jerseys?q={query}')
  })

  it('claims no logo or social profile it does not have', () => {
    const json = JSON.stringify(organisation())
    for (const field of ['logo', 'sameAs', 'telephone']) {
      expect(json).not.toContain(field)
    }
  })
})
