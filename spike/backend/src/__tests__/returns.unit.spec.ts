import {
  RETURN_WINDOW_DAYS, WITHDRAWAL_WINDOW_DAYS, STANCE,
  eligibility, hasWithdrawalRight, postagePaidBy, reasonAccepted,
} from '../returns'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-08-29T12:00:00Z')
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

const base = {
  placedAt: ago(20),
  deliveredAt: ago(3),
  personalised: false,
  alreadyOpen: false,
  now: NOW,
}

describe('the published stance', () => {
  it('is final sale, matching the live store', () => {
    // cruxchristi.com/policies/refund-policy: "All sales are final."
    // This assertion is the tripwire: flipping STANCE without updating the storefront copy
    // and the policy page is how a checkout ends up promising something the API refuses.
    expect(STANCE).toBe('final-sale')
  })

  it('matches the storefront copy', () => {
    const policies = require('fs').readFileSync(
      require('path').join(__dirname, '../../../storefront/lib/policies.ts'), 'utf8'
    )
    // Plain substring checks. A template literal inside `new RegExp` needs its backslashes
    // doubled to survive into the pattern, which is easy to get wrong and produced a regex
    // matching a literal backslash — a test that failed for a reason that had nothing to do
    // with the thing it guards.
    expect(policies).toContain(`stance: '${STANCE}'`)
    expect(policies).toContain(`windowDays: ${RETURN_WINDOW_DAYS}`)
    expect(policies).toContain(`withdrawalDays: ${WITHDRAWAL_WINDOW_DAYS}`)
  })
})

describe('returns eligibility', () => {
  it('accepts an item delivered inside the window', () => {
    expect(eligibility(base).eligible).toBe(true)
  })

  it('counts the window from delivery, not from purchase', () => {
    // A jersey is sourced to order and can take 16 business days to reach Europe, so a
    // window counted from purchase could expire before the customer held the shirt.
    const v = eligibility({ ...base, placedAt: ago(50), deliveredAt: ago(5) })
    expect(v.eligible).toBe(true)
  })

  it('falls back to the order date only when delivery is unknown', () => {
    const v = eligibility({ ...base, placedAt: ago(40), deliveredAt: null })
    expect(v.eligible).toBe(false)
    expect(v.eligible === false && v.reason).toContain('ordered')
  })

  it('is inclusive on the last day of the window', () => {
    // A customer on day 30 of a 30-day policy is inside it. Off-by-one here is a refused
    // claim, which is the expensive direction to get wrong.
    expect(eligibility({ ...base, deliveredAt: ago(RETURN_WINDOW_DAYS) }).eligible).toBe(true)
    expect(eligibility({ ...base, deliveredAt: ago(RETURN_WINDOW_DAYS + 1) }).eligible).toBe(false)
  })

  it('refuses a personalised item, and says why', () => {
    const v = eligibility({ ...base, personalised: true })
    expect(v.eligible).toBe(false)
    expect(v.eligible === false && v.reason).toContain('specification')
  })

  it('excludes a personalised item from the statutory right too', () => {
    // Made-to-specification goods are carved out of the withdrawal right by the directive
    // itself, so being in Germany does not restore it.
    const v = eligibility({ ...base, personalised: true, countryCode: 'de' })
    expect(v.eligible).toBe(false)
  })

  it('puts the personalisation rule ahead of the window rule', () => {
    // Both fail. The customer needs to be told the item was made for them, not that they
    // are three days late — one of those is actionable by us, the other is not.
    const v = eligibility({ ...base, placedAt: ago(90), deliveredAt: ago(90), personalised: true })
    expect(v.eligible === false && v.reason).toContain('specification')
  })

  it('refuses a second request for the same line', () => {
    const v = eligibility({ ...base, alreadyOpen: true })
    expect(v.eligible).toBe(false)
    expect(v.eligible === false && v.reason).toContain('already an open return')
  })

  it('lets an unparseable date through rather than denying a valid claim', () => {
    // Failing open sends one case to a human. Failing closed refuses a customer because of
    // our own bad data.
    expect(eligibility({ ...base, placedAt: 'not a date', deliveredAt: null }).eligible).toBe(true)
  })
})

describe('the statutory right of withdrawal', () => {
  it('applies to EU and UK destinations', () => {
    expect(hasWithdrawalRight('de')).toBe(true)
    expect(hasWithdrawalRight('gb')).toBe(true)
    expect(hasWithdrawalRight('IE')).toBe(true)
  })

  it('does not apply to the US', () => {
    expect(hasWithdrawalRight('us')).toBe(false)
    expect(hasWithdrawalRight(null)).toBe(false)
  })

  it('is flagged inside 14 days for an EU order', () => {
    const v = eligibility({ ...base, deliveredAt: ago(5), countryCode: 'de' })
    expect(v.eligible && v.withdrawal).toBe(true)
  })

  it('has lapsed after 14 days, while the fault route stays open', () => {
    // The two windows are different lengths and the longer one still governs eligibility.
    const v = eligibility({ ...base, deliveredAt: ago(WITHDRAWAL_WINDOW_DAYS + 1), countryCode: 'de' })
    expect(v.eligible).toBe(true)
    expect(v.eligible && v.withdrawal).toBe(false)
  })

  it('is never flagged for a US order', () => {
    const v = eligibility({ ...base, deliveredAt: ago(2), countryCode: 'us' })
    expect(v.eligible && v.withdrawal).toBe(false)
  })
})

describe('which reasons the policy accepts', () => {
  it('accepts a fault', () => {
    expect(reasonAccepted('faulty').accepted).toBe(true)
    expect(reasonAccepted('wrong_item').accepted).toBe(true)
    expect(reasonAccepted('not_as_described').accepted).toBe(true)
  })

  it('refuses a size that does not fit, and points at the size guide', () => {
    // The live policy is explicit: "We do not accept returns for: Incorrect size ordered."
    const v = reasonAccepted('too_small')
    expect(v.accepted).toBe(false)
    expect(v.message).toMatch(/size guide/i)
  })

  it('refuses a change of mind from a US customer', () => {
    const v = reasonAccepted('changed_mind')
    expect(v.accepted).toBe(false)
    expect(v.message).toMatch(/all sales are final/i)
  })

  it('accepts the same change of mind from an EU customer inside the window', () => {
    // The same request, refused from Texas and accepted from Germany. Both are correct: a
    // published policy cannot remove a statutory right.
    expect(reasonAccepted('changed_mind', { withdrawal: true }).accepted).toBe(true)
    expect(reasonAccepted('too_small', { withdrawal: true }).accepted).toBe(true)
  })
})

describe('who pays the return postage', () => {
  it('we do on anything that is our error', () => {
    expect(postagePaidBy('fault')).toBe('us')
    expect(postagePaidBy('wrong_item')).toBe('us')
  })

  it('the customer does on a statutory withdrawal', () => {
    // Permitted by the Consumer Rights Directive provided they were told before ordering,
    // which is what the refund policy page does.
    expect(postagePaidBy('withdrawal')).toBe('customer')
  })
})
