import {
  PRICES, NAME_MAX, eligibility, typefaceFor, normaliseName, validate, blocked,
  priceSelection, cheapestAddOn, toRecords,
} from '../personalisation'

describe('eligibility', () => {
  const ok = { garment: 'jersey', team: 'Brazil', needs_review: false }

  it('allows a reviewed jersey with a known team', () => {
    expect(eligibility(ok).eligible).toBe(true)
    expect(eligibility({ ...ok, garment: 'longsleeve-jersey' }).eligible).toBe(true)
  })

  it('excludes garments with nothing to print on', () => {
    for (const garment of ['shorts', 'hat', 'jacket', 'combo-set', '']) {
      expect(eligibility({ ...ok, garment }).eligible).toBe(false)
    }
  })

  it('excludes the unreviewed products rather than trusting their taxonomy', () => {
    const r = eligibility({ ...ok, needs_review: true })
    expect(r.eligible).toBe(false)
    expect(r.reason).toMatch(/unreviewed/)
  })

  it('excludes a product with no team, because the typeface comes from the team', () => {
    const r = eligibility({ ...ok, team: null })
    expect(r.eligible).toBe(false)
    expect(r.reason).toMatch(/typeface/)
  })

  it('is false, not a crash, when there is no detail row at all', () => {
    // 436 orphaned detail rows once existed; the inverse — a product with none — must
    // degrade to "not personalisable" rather than throw inside a product page.
    expect(eligibility(null).eligible).toBe(false)
    expect(eligibility(undefined).eligible).toBe(false)
  })

  it('always gives a reason when it says no', () => {
    for (const d of [null, { garment: 'hat' }, { garment: 'jersey', needs_review: true }]) {
      const r = eligibility(d as any)
      expect(r.eligible).toBe(false)
      expect(r.reason).toBeTruthy()
    }
  })
})

describe('names', () => {
  it('uppercases and collapses whitespace', () => {
    expect(normaliseName('  van   der  sar ')).toBe('VAN DER SAR')
  })

  it('folds accents instead of rejecting them', () => {
    // A customer typing their own name correctly must not be told it is invalid.
    expect(normaliseName('Mbappé')).toBe('MBAPPE')
    expect(normaliseName('Özil')).toBe('OZIL')
    expect(normaliseName('Müller')).toBe('MULLER')
    expect(validate({ name: 'Mbappé' }).ok).toBe(true)
  })

  it('accepts the punctuation real surnames contain', () => {
    for (const n of ["O'Neill", 'Vande Velde', 'Jr.', 'Smith-Jones', "D'Angelo"]) {
      expect(validate({ name: n })).toMatchObject({ ok: true })
    }
  })

  it(`rejects longer than ${NAME_MAX} characters, in words`, () => {
    const r = validate({ name: 'A'.repeat(NAME_MAX + 1) })
    expect(r.ok).toBe(false)
    // Reads NAME_MAX rather than repeating it: the limit moved from 12 to 14 to match the
    // live store, and a hardcoded number here is a test that fails for the right reason
    // once and then gets edited to whatever makes it pass.
    expect(r.errors[0].message).toMatch(new RegExp(`up to ${NAME_MAX} characters`))
    expect(r.errors[0].message).not.toMatch(/[\^$\[\]]/) // never a regex
  })

  it('accepts exactly the maximum length', () => {
    expect(validate({ name: 'A'.repeat(NAME_MAX) }).ok).toBe(true)
  })

  it('rejects digits, symbols and emoji in a name', () => {
    for (const n of ['ALLEN7', 'ALLEN!', 'ALLEN 🏈', 'A@B', 'ALLEN_X']) {
      expect(validate({ name: n }).ok).toBe(false)
    }
  })

  it('rejects punctuation with no letters', () => {
    // "..." and "---" pass a charset check and print as punctuation on a shirt.
    for (const n of ['...', "'''", '---', ' . - ']) {
      const r = validate({ name: n })
      expect(r.ok).toBe(false)
      expect(r.errors[0].message).toMatch(/at least one letter/)
    }
  })

  it('treats an empty or whitespace-only name as "not chosen", not invalid', () => {
    for (const n of ['', '   ', null, undefined]) {
      const r = validate({ name: n as any })
      expect(r.ok).toBe(true)
      expect(r.name).toBeUndefined()
    }
  })
})

describe('blocklist', () => {
  it('catches profanity as a whole word', () => {
    expect(blocked('FUCK')).toBe(true)
    expect(blocked('SMITH FUCK')).toBe(true)
  })

  it('catches slurs written with spacing or punctuation to evade a word check', () => {
    for (const n of ['N I G G A', 'N.I.G.G.A', "N-I-G-G-E-R", 'F A G G O T']) {
      expect(blocked(normaliseName(n))).toBe(true)
    }
  })

  it('catches a blocked name whether or not it is spaced', () => {
    expect(blocked('BIN LADEN')).toBe(true)
    expect(blocked('BINLADEN')).toBe(true)
    expect(blocked('HITLER')).toBe(true)
  })

  it('does not block ordinary surnames that contain an unlucky substring', () => {
    // The reason the squashed list is short and separate: squashing 'Cassis' gives
    // 'cassis', which contains 'assis'. Over-blocking a real customer's name is a
    // support ticket and an insult.
    for (const n of ['CASSIS', 'SCUNTHORPE', 'DICKINSON', 'BASSETT', 'SHITSUKA']) {
      expect(blocked(n)).toBe(false)
    }
  })

  it('does not return — or price — a name it refused', () => {
    // The bug this pins: the endpoint answered ok:false and total:1499 for a blocked
    // name, so the page showed a price for something it had just declined to print.
    const r = validate({ name: 'HITLER' })
    expect(r.ok).toBe(false)
    expect(r.name).toBeUndefined()
    expect(priceSelection({ name: r.name }).total).toBe(0)
  })

  it('still prices the valid part of a mixed selection', () => {
    // Name refused, number fine: charge for the number only, not for both and not for
    // neither.
    const r = validate({ name: 'FUCK', number: '17' })
    expect(r.ok).toBe(false)
    expect(r.name).toBeUndefined()
    expect(r.number).toBe('17')
    expect(priceSelection({ name: r.name, number: r.number }).total).toBe(PRICES.number)
  })

  it('reports a refusal without quoting the word back', () => {
    const r = validate({ name: 'FUCK' })
    expect(r.ok).toBe(false)
    expect(r.errors[0].message).not.toMatch(/fuck/i)
    // Nor does it explain the rule, which would just invite probing.
    expect(r.errors[0].message).toMatch(/can’t print that name/)
  })
})

describe('numbers', () => {
  it('accepts 0 through 99', () => {
    for (const n of ['0', '7', '10', '99']) {
      expect(validate({ number: n })).toMatchObject({ ok: true, number: n })
    }
  })

  it('rejects a leading zero, which suppliers print literally', () => {
    const r = validate({ number: '07' })
    expect(r.ok).toBe(false)
    expect(r.errors[0].message).toMatch(/Use 7 rather than 07/)
  })

  it('rejects three digits, negatives and non-digits', () => {
    for (const n of ['100', '-1', '7.5', 'XI', '1 0']) {
      expect(validate({ number: n }).ok).toBe(false)
    }
  })

  it('accepts a numeric 0 rather than treating it as absent', () => {
    // The `Number(x) || fallback` bug, in a new place: 0 is a real shirt number.
    expect(validate({ number: 0 })).toMatchObject({ ok: true, number: '0' })
  })

  it('treats an empty number as not chosen', () => {
    expect(validate({ number: '' })).toMatchObject({ ok: true, number: undefined })
  })
})

describe('patches', () => {
  it('accepts one from the offered set', () => {
    expect(validate({ patch: 'captain', availablePatches: ['captain', 'champions'] }))
      .toMatchObject({ ok: true, patch: 'captain' })
  })

  it('rejects anything not offered, so there is no free upload path', () => {
    const r = validate({ patch: 'my-own-logo', availablePatches: ['captain'] })
    expect(r.ok).toBe(false)
    expect(r.patch).toBeUndefined()
  })

  it('rejects any patch when the shirt offers none', () => {
    expect(validate({ patch: 'captain' }).ok).toBe(false)
  })
})

describe('validation collects every problem at once', () => {
  it('reports name, number and patch together', () => {
    // Inline validation (spec §4.5) means showing all three, not the first.
    const r = validate({ name: 'A'.repeat(20), number: '100', patch: 'x', availablePatches: [] })
    expect(r.ok).toBe(false)
    expect(r.errors.map((e) => e.field).sort()).toEqual(['name', 'number', 'patch'])
  })
})

describe('pricing', () => {
  it('charges the bundle automatically when both are chosen', () => {
    const { lines, total } = priceSelection({ name: 'ALLEN', number: '17' })
    expect(lines).toHaveLength(1)
    expect(lines[0].kind).toBe('bundle')
    // Never PRICES.name + PRICES.number. Charging $24.98 because the customer did not
    // notice a bundle radio button is a refund request.
    expect(total).toBe(PRICES.bundle)
    expect(total).toBeLessThan(PRICES.name + PRICES.number)
  })

  it('prices a name alone and a number alone', () => {
    expect(priceSelection({ name: 'ALLEN' }).total).toBe(PRICES.name)
    expect(priceSelection({ number: '17' }).total).toBe(PRICES.number)
  })

  it('adds a patch on top of any tier', () => {
    expect(priceSelection({ patch: 'captain' }).total).toBe(PRICES.patch)
    expect(priceSelection({ name: 'ALLEN', number: '17', patch: 'captain' }).total)
      .toBe(PRICES.bundle + PRICES.patch)
  })

  it('is zero for an empty selection', () => {
    expect(priceSelection({})).toEqual({ lines: [], total: 0 })
  })

  it('is stated in cents throughout', () => {
    for (const p of Object.values(PRICES)) expect(Number.isInteger(p)).toBe(true)
    expect(priceSelection({ name: 'A', number: '1' }).total).toBe(1999)
  })

  it('quotes "from" over what is actually offered', () => {
    // The bug this pins: with no patch list configured, the page advertised "from $7.99"
    // — the patch price — for an option the customer could not select.
    expect(cheapestAddOn()).toBe(PRICES.number)
    expect(cheapestAddOn({ patches: [] })).toBe(PRICES.number)
    expect(cheapestAddOn({ patches: ['captain'] })).toBe(PRICES.patch)
  })

  it('never quotes a "from" price above the cheapest real option', () => {
    for (const patches of [[], ['captain']]) {
      const from = cheapestAddOn({ patches })
      const real = [
        priceSelection({ name: 'A' }).total,
        priceSelection({ number: '1' }).total,
        ...(patches.length ? [priceSelection({ patch: patches[0] }).total] : []),
      ]
      expect(from).toBe(Math.min(...real))
    }
  })

  it('the full-house order comes to $93.97 on a $65.99 shirt', () => {
    // personalisation-spec.md §1 said $94.97, which does not follow from its own table:
    // $19.99 bundle + $7.99 patch is $27.98, not $29.98. The spec has been corrected to
    // match the prices; this pins the arithmetic so the two cannot drift again.
    const base = 6599
    expect(base + priceSelection({ name: 'ALLEN', number: '17', patch: 'captain' }).total)
      .toBe(9397)
  })
})

describe('typeface', () => {
  it('resolves per league', () => {
    expect(typefaceFor('NFL')).toBe('nfl-block')
    expect(typefaceFor('nba')).toBe('nba-block')
  })

  it('falls back rather than returning undefined', () => {
    expect(typefaceFor(null)).toBeTruthy()
    expect(typefaceFor('KABADDI')).toBeTruthy()
  })
})

describe('records for production', () => {
  it('expands a bundle into the two things that actually get printed', () => {
    const recs = toRecords({ name: 'ALLEN', number: '17' }, { league: 'NFL' })
    expect(recs.map((r) => r.kind)).toEqual(['name', 'number'])
    // "bundle" is a price, not something that goes on a shirt.
    expect(recs.some((r) => (r.kind as string) === 'bundle')).toBe(false)
  })

  it('keeps the rows summing to what was charged', () => {
    for (const sel of [
      { name: 'ALLEN', number: '17' },
      { name: 'ALLEN' },
      { number: '17' },
      { name: 'ALLEN', number: '17', patch: 'captain' },
      { patch: 'captain' },
    ]) {
      const charged = priceSelection(sel).total
      const stored = toRecords(sel, { league: 'NFL' }).reduce((t, r) => t + r.price, 0)
      expect(stored).toBe(charged)
    }
  })

  it('stamps the typeface on each row, so a later league change cannot rewrite history', () => {
    const recs = toRecords({ name: 'ALLEN' }, { league: 'MLB' })
    expect(recs[0].typeface).toBe('mlb-varsity')
  })

  it('places the number on the front only when asked', () => {
    expect(toRecords({ number: '17' }, {})[0].placement).toBe('back')
    expect(toRecords({ number: '17' }, { numberOnFront: true })[0].placement).toBe('front')
  })

  it('returns nothing for an empty selection', () => {
    expect(toRecords({}, {})).toEqual([])
  })
})
