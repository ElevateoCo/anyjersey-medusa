import {
  PRICES, NAME_MAX, eligibility, priceSelection, toRecords, validate,
} from '../personalisation'
import { TEAM_LEAGUE, teamInTitle } from '../teams'

/**
 * The custom-jersey line.
 *
 * The live store sells these as a separate product at $89.99 against a $65.99 base, with
 * the name and number **included in the price**, and no personalisation control at all on
 * its regular player jerseys. That is a different commercial shape from the add-on model in
 * `personalisation-spec.md` §1, and both now exist here.
 *
 * The thing these tests protect is the boundary between them. "Included" must mean free
 * *printing*, not absent personalisation — a custom shirt with a name still has to produce
 * the records the print queue and the review gate work from.
 */
const custom = { garment: 'jersey', team: 'Dallas Cowboys', needs_review: false, is_custom: true }
const regular = { garment: 'jersey', team: 'Dallas Cowboys', needs_review: false, is_custom: false }

describe('pricing a custom jersey', () => {
  it('charges nothing for a name', () => {
    const { total } = priceSelection({ name: 'RODRIGUEZ' }, { included: true })
    expect(total).toBe(0)
  })

  it('charges nothing for a name and number together', () => {
    const { total } = priceSelection({ name: 'RODRIGUEZ', number: '7' }, { included: true })
    expect(total).toBe(0)
  })

  it('still produces a line, so the print queue has something to work from', () => {
    // The failure this guards: modelling "included" as *no personalisation* would send a
    // printed shirt to a supplier with nothing recorded about what to print on it.
    const { lines } = priceSelection({ name: 'RODRIGUEZ', number: '7' }, { included: true })
    expect(lines).toHaveLength(1)
    expect(lines[0].kind).toBe('bundle')
    expect(lines[0].label).toContain('RODRIGUEZ')
  })

  it('leaves the regular add-on prices untouched', () => {
    const { total } = priceSelection({ name: 'RODRIGUEZ', number: '7' })
    expect(total).toBe(PRICES.bundle)
  })

  it('still charges for a patch, which is a physical extra rather than printing', () => {
    const { total } = priceSelection({ name: 'A', patch: 'Super Bowl' }, { included: true })
    expect(total).toBe(PRICES.patch)
  })
})

describe('records written for a custom jersey', () => {
  const sel = { name: 'RODRIGUEZ', number: '7' }

  it('writes one row per printed thing, exactly as a paid one does', () => {
    const rows = toRecords(sel, { league: 'NFL', included: true })
    expect(rows.map((r) => r.kind)).toEqual(['name', 'number'])
  })

  it('snapshots the price as zero, which is what was actually charged', () => {
    // §5's rule is that the row records what was charged, not what the price list says.
    const rows = toRecords(sel, { league: 'NFL', included: true })
    expect(rows.every((r) => r.price === 0)).toBe(true)
  })

  it('resolves the typeface from the league like any other shirt', () => {
    const rows = toRecords(sel, { league: 'NFL', included: true })
    expect(rows[0].typeface).toBe('nfl-block')
    expect(rows[0].placement).toBe('back')
  })

  it('still snapshots the paid price when it is not included', () => {
    const rows = toRecords(sel, { league: 'NFL' })
    expect(rows.find((r) => r.kind === 'name')!.price).toBe(PRICES.bundle)
    expect(rows.find((r) => r.kind === 'number')!.price).toBe(0)
  })
})

describe('eligibility', () => {
  it('accepts a custom jersey', () => {
    expect(eligibility(custom).eligible).toBe(true)
  })

  it('still refuses a custom shirt with no team, because there is no typeface', () => {
    // Being custom does not exempt it from the checks that decide what can be printed.
    const v = eligibility({ ...custom, team: null })
    expect(v.eligible).toBe(false)
    expect(v.reason).toContain('typeface')
  })

  it('still refuses a garment with no back to print on', () => {
    expect(eligibility({ ...custom, garment: 'shorts' }).eligible).toBe(false)
  })

  it('treats a regular jersey exactly as before', () => {
    expect(eligibility(regular).eligible).toBe(true)
  })
})

describe('validation is not relaxed for custom shirts', () => {
  it('still refuses a blocked name', () => {
    // Free printing is not a reason to print anything. The blocklist and the human queue
    // are about liability, not about revenue.
    const r = validate({ name: 'HITLER' })
    expect(r.ok).toBe(false)
    expect(r.name).toBeUndefined()
  })

  it('accepts up to the published limit and refuses beyond it', () => {
    expect(validate({ name: 'A'.repeat(NAME_MAX) }).ok).toBe(true)
    expect(validate({ name: 'A'.repeat(NAME_MAX + 1) }).ok).toBe(false)
  })

  it('matches the limit the live store accepts', () => {
    // The spec proposed 12; the shop currently trading accepts 14, and rejecting a name a
    // customer has already ordered under is the worse failure.
    expect(NAME_MAX).toBe(14)
  })

  it('still refuses a leading zero', () => {
    expect(validate({ number: '07' }).ok).toBe(false)
  })
})

describe('team parsing for the import', () => {
  it('matches the longest team name, not the first', () => {
    expect(teamInTitle('NEW YORK GIANTS CUSTOM BLUE JERSEY')).toBe('NEW YORK GIANTS')
    expect(teamInTitle('NEW YORK JETS CUSTOM GREEN JERSEY')).toBe('NEW YORK JETS')
  })

  it('recognises the historic franchises the catalog still sells', () => {
    expect(teamInTitle('HOUSTON OILERS THROWBACK JERSEY')).toBe('HOUSTON OILERS')
    expect(teamInTitle('SAN DIEGO CHARGERS RETRO JERSEY')).toBe('SAN DIEGO CHARGERS')
  })

  it('returns null rather than guessing', () => {
    expect(teamInTitle('CUSTOM BLUE JERSEY')).toBeNull()
  })

  it('agrees with the league taxonomy already in the catalog', () => {
    expect(TEAM_LEAGUE['DALLAS COWBOYS']).toBe('NFL')
    // A real NBA entry from the catalog. Only four teams are in it, and asserting one that
    // is not would be asserting the fixture rather than the mapping.
    expect(TEAM_LEAGUE['BOSTON CELTICS']).toBe('NBA')
    // Both Washington franchises exist and must be in the same league.
    expect(TEAM_LEAGUE['WASHINGTON COMMANDERS']).toBe('NFL')
    expect(TEAM_LEAGUE['WASHINGTON REDSKINS']).toBe('NFL')
  })
})
