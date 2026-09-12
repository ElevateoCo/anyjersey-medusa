import { describe, it, expect } from 'vitest'
import { JURISDICTIONS, jurisdictionFor, deadlineSentence } from './jurisdiction'

/**
 * Which law covers a reader, and what it promises them.
 *
 * Pinned rather than trusted, because every value here is published to a customer as a
 * statement about their legal rights. The failure is not a broken page — it is telling
 * somebody they have a right they do not have, or a deadline we will miss.
 */
describe('jurisdictionFor', () => {
  it('reads the EU and EEA as one regime', () => {
    for (const c of ['DE', 'FR', 'IE', 'NO', 'IS']) {
      expect(jurisdictionFor(c, null).key).toBe('eu')
    }
  })

  it('separates the UK and Switzerland from the EU', () => {
    expect(jurisdictionFor('GB', null).key).toBe('uk')
    expect(jurisdictionFor('CH', null).key).toBe('ch')
  })

  it('puts California on its own profile, ahead of the rest of the US', () => {
    expect(jurisdictionFor('US', 'CA').key).toBe('us-ca')
    expect(jurisdictionFor('US', 'TX').key).toBe('us')
  })

  it('puts Québec on its own profile, ahead of the rest of Canada', () => {
    expect(jurisdictionFor('CA', 'QC').key).toBe('ca-qc')
    expect(jurisdictionFor('CA', 'ON').key).toBe('ca')
  })

  it('does not confuse Canada with California', () => {
    // Both abbreviate to CA. The country is checked before the subdivision.
    expect(jurisdictionFor('CA', null).key).toBe('ca')
    expect(jurisdictionFor('US', 'CA').key).toBe('us-ca')
  })

  it('falls back to the strictest profile when it cannot place the reader', () => {
    const j = jurisdictionFor(null, null)
    expect(j.key).toBe('other')
    // Somewhere we cannot place is not somewhere with no privacy law.
    expect(j.regime).toBe('opt-in')
    expect(j.rights).toContain('portability')
  })
})

describe('the profiles themselves', () => {
  it('gives the sale/sharing opt-out only where it exists', () => {
    // It is a US-state right. Offering it to a German implies a practice we do not have;
    // withholding it from a Texan withholds a statutory right.
    expect(JURISDICTIONS.us.rights).toContain('optout')
    expect(JURISDICTIONS['us-ca'].rights).toContain('optout')
    expect(JURISDICTIONS.eu.rights).not.toContain('optout')
    expect(JURISDICTIONS.br.rights).not.toContain('optout')
  })

  it('gives the appeal right only in the US, where the statutes require it', () => {
    expect(JURISDICTIONS.us.rights).toContain('appeal')
    expect(JURISDICTIONS.eu.rights).not.toContain('appeal')
  })

  it('carries the Article 27 representative only for the EU', () => {
    expect(JURISDICTIONS.eu.pending).toContain('eu_representative')
    expect(JURISDICTIONS.uk.pending).not.toContain('eu_representative')
    expect(JURISDICTIONS.us.pending).not.toContain('eu_representative')
  })

  it('asks for a request channel everywhere, because every one of these laws requires one', () => {
    for (const j of Object.values(JURISDICTIONS)) {
      expect(j.pending).toContain('privacy_email')
    }
  })

  it('states a deadline or admits it has not confirmed one, never a guess', () => {
    for (const j of Object.values(JURISDICTIONS)) {
      expect(j.responseDays === null || j.responseDays > 0).toBe(true)
      // An extension without a base period would be meaningless.
      if (j.extensionDays !== null) expect(j.responseDays).not.toBeNull()
    }
  })

  it('holds the statutory numbers that were checked', () => {
    expect(JURISDICTIONS.eu.responseDays).toBe(30)      // GDPR Art. 12(3), one month
    expect(JURISDICTIONS.eu.extensionDays).toBe(60)     // extendable by two months
    expect(JURISDICTIONS['us-ca'].responseDays).toBe(45) // CCPA/CPRA
    expect(JURISDICTIONS.br.responseDays).toBe(15)       // LGPD Art. 19
    expect(JURISDICTIONS['ca-qc'].responseDays).toBe(30) // Law 25
  })

  it('says so rather than printing a number it does not have', () => {
    expect(JURISDICTIONS.ch.responseDays).toBeNull()
    expect(deadlineSentence(JURISDICTIONS.ch)).toMatch(/confirming/i)
    expect(deadlineSentence(JURISDICTIONS.ch)).not.toMatch(/\d+ days/)
  })
})

describe('deadlineSentence', () => {
  it('states the period, and the extension only where the law allows one', () => {
    expect(deadlineSentence(JURISDICTIONS.br)).toBe('We answer within 15 days.')
    const eu = deadlineSentence(JURISDICTIONS.eu)
    expect(eu).toContain('within 30 days')
    expect(eu).toContain('further 60 days')
  })
})
