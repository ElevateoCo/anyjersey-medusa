import {
  DEFAULT_SIZES, JerseyValidationError, fold, normaliseJersey, searchText, skuStem,
  slugify, toDetailPayload, toProductPayload, type NormalisedJersey,
} from '../jerseys'

/**
 * What an admin form can get wrong.
 *
 * Everything asserted here is reachable by typing into the create screen, which is why it
 * is unit-tested rather than left to the integration suite: the failure modes are about
 * input, and input does not need a database.
 */
const valid = {
  title: 'Dallas Cowboys Dak Prescott White Jersey',
  price: '65.99',
  team: 'Dallas Cowboys',
  player: 'Dak Prescott',
  league: 'nfl',
  colourway: 'White',
  season: '2026',
  sport: 'football',
}

const make = (over: Record<string, unknown> = {}) =>
  normaliseJersey({ ...valid, ...over }) as NormalisedJersey

describe('slugify', () => {
  it('folds accents rather than dropping the word', () => {
    // "Romário" must not become "romrio" — the handle is what the URL and the SKU stem
    // are built from, and a mangled one is permanent.
    expect(slugify('1994 World Cup Romário Team Brazil')).toBe(
      '1994-world-cup-romario-team-brazil')
  })

  it('drops apostrophes instead of turning them into separators', () => {
    expect(slugify("Shaq O'Neal Lakers")).toBe('shaq-oneal-lakers')
  })

  it('never ends in a hyphen, including after truncation', () => {
    const s = slugify('a'.repeat(118) + ' bb')!
    expect(s.endsWith('-')).toBe(false)
  })

  it('returns null when there is nothing to slug', () => {
    expect(slugify('!!!')).toBeNull()
    expect(slugify('   ')).toBeNull()
  })
})

describe('searchText', () => {
  it('matches the importer: folded, in field order', () => {
    expect(searchText({
      team: 'Team Brazil', player: 'Romário', colourway: 'yellow',
      season: '1994', sport: 'soccer', garment: 'jersey',
    })).toBe('team brazil romario yellow 1994 soccer jersey')
  })

  it('omits missing fields rather than leaving gaps', () => {
    expect(searchText({ team: 'Chicago Bulls', garment: 'jersey' }))
      .toBe('chicago bulls jersey')
  })

  it('folds the same way the store query does', () => {
    const t = { player: 'Kylian Mbappé' }
    expect(searchText(t)).toContain(fold('Mbappé'))
  })
})

describe('skuStem', () => {
  it('is stable for a handle', () => {
    expect(skuStem('a-handle')).toBe(skuStem('a-handle'))
  })

  it('differs between handles', () => {
    expect(skuStem('a-handle')).not.toBe(skuStem('b-handle'))
  })

  it('matches the catalogue shape', () => {
    expect(skuStem('anything')).toMatch(/^AJ-[0-9A-F]{5}$/)
  })
})

describe('normaliseJersey', () => {
  it('derives the handle from the title', () => {
    expect(make().handle).toBe('dallas-cowboys-dak-prescott-white-jersey')
  })

  it('requires a title', () => {
    expect(() => normaliseJersey({ price: '10' }))
      .toThrow(JerseyValidationError)
  })

  it('requires a price', () => {
    expect(() => normaliseJersey({ title: 'A jersey' }))
      .toThrow(/price is required/)
  })

  it('rejects a comma decimal rather than truncating it', () => {
    // "65,99" parsed loosely is 65 — a silent 99-cent discount on every sale, and the
    // single most damaging thing this validator prevents.
    expect(() => make({ price: '65,99' })).toThrow(/is not a price/)
  })

  it('accepts a currency symbol and whitespace', () => {
    expect(make({ price: ' $65.99 ' }).price).toBe(65.99)
  })

  it('rejects more than two decimal places', () => {
    expect(() => make({ price: '65.999' })).toThrow(/is not a price/)
  })

  it('rejects zero and negative prices', () => {
    expect(() => make({ price: '0' })).toThrow(/greater than zero/)
    expect(() => make({ price: '-5' })).toThrow(/is not a price/)
  })

  it('defaults to the full size run', () => {
    expect(make().sizes).toEqual([...DEFAULT_SIZES])
  })

  it('accepts a comma-separated size list and upper-cases it', () => {
    expect(make({ sizes: 's, m ,l' }).sizes).toEqual(['S', 'M', 'L'])
  })

  it('refuses a duplicated size', () => {
    // Two variants with the same option value is a product Medusa will create and the
    // storefront cannot render a size picker for.
    expect(() => make({ sizes: ['S', 'M', 'S'] })).toThrow(/listed twice/)
  })

  it('refuses an empty size list', () => {
    expect(() => make({ sizes: [] })).toThrow(/At least one size/)
  })

  it('only accepts images that came from the upload endpoint', () => {
    expect(() => make({ images: ['https://evil.example/x.png'] }))
      .toThrow(/not an uploaded image/)
    expect(() => make({ images: ['/media/nothex.webp'] }))
      .toThrow(/not an uploaded image/)
  })

  it('accepts a content-addressed media URL', () => {
    const url = `/media/${'a'.repeat(64)}.webp`
    expect(make({ images: [url] }).images).toEqual([url])
  })

  it('refuses the same image twice', () => {
    const url = `/media/${'b'.repeat(64)}.webp`
    expect(() => make({ images: [url, url] })).toThrow(/attached twice/)
  })

  it('rejects a handle with characters a URL cannot carry', () => {
    expect(() => make({ handle: 'Not A Handle' })).toThrow(/lowercase letters/)
  })

  it('defaults to draft, not published', () => {
    // A product created by accident must not be live. The default is the safe direction.
    expect(make().status).toBe('draft')
  })

  it('rejects an unknown status', () => {
    expect(() => make({ status: 'archived' })).toThrow(/published.*draft/)
  })

  it('normalises league up and colourway down, matching the catalogue', () => {
    const j = make({ league: 'nfl', colourway: 'White' })
    expect(j.taxonomy.league).toBe('NFL')
    expect(j.taxonomy.colourway).toBe('white')
  })

  it('defaults garment to jersey', () => {
    expect(make({ garment: '' }).taxonomy.garment).toBe('jersey')
  })

  it('derives search_text rather than taking it from the caller', () => {
    expect(make().search_text).toBe('dallas cowboys dak prescott white 2026 football jersey')
  })

  describe('partial updates', () => {
    it('does not demand a title or a price', () => {
      const patch = normaliseJersey({ status: 'published' }, { partial: true })
      expect(patch.status).toBe('published')
      expect(patch.title).toBeUndefined()
      expect(patch.price).toBeUndefined()
    })

    it('still validates what is present', () => {
      expect(() => normaliseJersey({ price: '65,99' }, { partial: true }))
        .toThrow(/is not a price/)
    })
  })
})

describe('toProductPayload', () => {
  const ctx = { shippingProfileId: 'sp_1', salesChannelId: 'sc_1' }

  it('builds one variant per size, never stock tracked', () => {
    const p = toProductPayload(make({ sizes: ['S', 'M'] }), ctx)
    expect(p.variants).toHaveLength(2)
    // The sourcing model: nothing here can ever be out of stock — research.md §12.1.
    expect(p.variants.every((v) => v.manage_inventory === false)).toBe(true)
  })

  it('gives every variant the same price', () => {
    const p = toProductPayload(make({ price: '89.99', sizes: ['S', 'M'] }), ctx)
    expect(p.variants.map((v) => v.prices[0].amount)).toEqual([89.99, 89.99])
  })

  it('uses one Size option, which is what the storefront splits on', () => {
    const p = toProductPayload(make({ sizes: ['S', 'M'] }), ctx)
    expect(p.options).toEqual([{ title: 'Size', values: ['S', 'M'] }])
    expect(p.variants[0].options).toEqual({ Size: 'S' })
  })

  it('makes the first image the thumbnail', () => {
    const a = `/media/${'a'.repeat(64)}.webp`
    const b = `/media/${'b'.repeat(64)}.webp`
    const p = toProductPayload(make({ images: [a, b] }), ctx)
    expect(p.thumbnail).toBe(a)
    expect(p.images).toEqual([{ url: a }, { url: b }])
  })

  it('leaves the thumbnail undefined when there are no images', () => {
    expect(toProductPayload(make(), ctx).thumbnail).toBeUndefined()
  })
})

describe('toDetailPayload', () => {
  it('leaves the regulatory block alone', () => {
    // §13.5: a guessed regulatory value is not a data-quality problem, it is a false
    // statement. The create form does not offer these and must not invent them.
    const d = toDetailPayload(make()) as Record<string, unknown>
    for (const k of ['fibre_composition', 'country_of_origin', 'hs_code',
                     'eu_responsible_person', 'care_instructions']) {
      expect(d[k]).toBeUndefined()
    }
  })

  it('records where the row came from', () => {
    expect(toDetailPayload(make()).source_platform).toBe('admin')
  })
})
