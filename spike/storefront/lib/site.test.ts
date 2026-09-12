import { readFileSync } from 'fs'
import { describe, it, expect } from 'vitest'
import { ENTITY, entityValue, euBlocked, euGateLifted, euGatesOutstanding, EU_GATES } from './site'

/**
 * The trader disclosures, and which of them code is allowed to fill in.
 *
 * The distinction this file pins is the whole point: one of these gaps was a shop declining
 * to name a mailbox it already had, and two of them are facts and contracts that only the
 * business can supply. Treating all three the same way left a reader with a legal right and
 * nowhere to send it.
 */
describe('the data-subject request channel', () => {
  it('is always published, because every one of these laws requires one', () => {
    // GDPR Art. 15–22, the US state laws, the LGPD and Law 25 all require a contactable
    // channel. None of them requires a *dedicated* address, which is what makes the
    // fallback lawful rather than a fudge.
    expect(entityValue('privacy_email')).not.toBe('')
  })

  it('says when it is standing in for the support mailbox', () => {
    const row = ENTITY.find((e) => e.key === 'privacy_email')!
    if (!process.env.NEXT_PUBLIC_PRIVACY_EMAIL) {
      expect(row.value).toBe(entityValue('support_email'))
      // A field that fell back is not a field somebody filled in, and the page says which.
      expect(row.derived).toBeTruthy()
    }
  })
})

describe('the gaps code must not fill', () => {
  it.each([
    ['address', 'a fact about the company, not derivable from this repository'],
    ['eu_representative', 'a contract with a firm established in the EU'],
  ])('leaves %s empty rather than inventing it', (key) => {
    const row = ENTITY.find((e) => e.key === key)!
    // If either of these is ever given a default, it is a false statement to a regulator.
    expect(row.derived).toBeUndefined()
  })

  it('never marks a gap as derived, which would read as an appointment', () => {
    for (const e of ENTITY) if (!e.value) expect(e.derived).toBeUndefined()
  })
})

describe('what an unmade appointment blocks', () => {
  it('keeps EU and UK sales gated on the three that gate them', () => {
    // The consequence is enforced, not merely disclosed. `regionBlocked` reads this.
    expect(EU_GATES).toEqual(['eu_representative', 'gpsr_responsible_person', 'ioss'])
  })

  it('reports every EU gate that is still missing', () => {
    const missing = euBlocked().map((e) => e.key)
    for (const k of EU_GATES) {
      if (!entityValue(k)) expect(missing).toContain(k)
    }
  })

  /**
   * The request channel is deliberately **not** an EU gate. It is a disclosure requirement
   * on every market, so falling back to the support mailbox fixes a real gap without
   * touching the three appointments that stop EU orders — which are still unmade.
   */
  it('does not let the fallback unblock EU sales', () => {
    expect(EU_GATES).not.toContain('privacy_email')
  })
})

/**
 * The development override.
 *
 * `NEXT_PUBLIC_LIFT_EU_GATE` makes EU and UK regions selectable while the appointments are
 * outstanding, which is reasonable in a spike that takes no real orders. What these pin is
 * that it stays a *development* convenience.
 */
describe('lifting the EU gate', () => {
  it('never hides what is actually still unappointed', () => {
    // `euBlocked()` is what the UI enforces and the flag empties it. `euGatesOutstanding()`
    // is the truth, and nothing may empty that — it is what the shipping page says out loud
    // when the gate is off, so a storefront cannot look compliant while it is not.
    const outstanding = euGatesOutstanding().map((e) => e.key)
    for (const k of EU_GATES) {
      if (!entityValue(k)) expect(outstanding).toContain(k)
    }
  })

  it('agrees with itself: lifted means enforced-empty but still outstanding', () => {
    if (euGateLifted()) {
      expect(euBlocked()).toHaveLength(0)
      // Lifting it cannot be what *makes* the list empty in a way that reads as compliance.
      expect(euGatesOutstanding().length).toBeGreaterThan(0)
    } else {
      expect(euBlocked().map((e) => e.key)).toEqual(euGatesOutstanding().map((e) => e.key))
    }
  })

  /**
   * The assertion that matters most, and the reason this is a flag rather than a
   * commented-out block. `NODE_ENV` is baked in at build time, so there is no sequence of
   * environment settings on a host that puts an ungated EU checkout in front of a customer.
   * Verified end to end as well: a production build with the flag set to `true` still
   * renders the EU and UK options disabled.
   */
  it('cannot be switched on in a production build', () => {
    // Read as source rather than exercised, deliberately. Re-importing the module would
    // re-evaluate the guard under the test runner's own NODE_ENV and prove nothing about a
    // build; what needs pinning is that the guard is *there*, because `NODE_ENV` is baked
    // in at build time and that is what makes the override unshippable.
    //
    // Verified end to end as well: a production build with the flag set to `true` still
    // renders the EU and UK options disabled.
    const src = readFileSync(new URL('./site.ts', import.meta.url), 'utf8')
    expect(src).toMatch(
      /NODE_ENV !== 'production'\s*&&\s*process\.env\.NEXT_PUBLIC_LIFT_EU_GATE/
    )
  })
})
