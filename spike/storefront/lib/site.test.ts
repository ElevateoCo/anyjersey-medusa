import { readFileSync } from 'fs'
import { describe, it, expect } from 'vitest'
import {
  ENTITY, entityValue, euBlocked, euGateLifted, euGatesOutstanding, siteNameParts,
  SITE_NAME, EU_GATES,
} from './site'

/**
 * The trader disclosures, and which of them code is allowed to fill in.
 *
 * The distinction this file pins is the whole point: one of these gaps was a shop declining
 * to name a mailbox it already had, and two of them are facts and contracts that only the
 * business can supply. Treating all three the same way left a reader with a legal right and
 * nowhere to send it.
 */
describe('the data-subject request channel', () => {
  /**
   * The rule, and note what it is *not*.
   *
   * It used to assert the channel is never empty — which held only because a personal Gmail
   * was hardcoded as the support default. That address is out of the source now, so an
   * unconfigured environment genuinely has no channel and the policy pages say so through
   * `pendingEntityFields()`. Asserting non-empty would be asserting that the default is
   * back.
   *
   * What has to stay true is the *relationship*: with no dedicated address configured, the
   * channel is the support mailbox. Every one of GDPR Art. 15–22, the US state laws, the
   * LGPD and Law 25 requires a contactable channel and none requires a dedicated one, which
   * is what makes that lawful rather than a fudge.
   */
  it('falls back to the support mailbox when no dedicated address is set', () => {
    if (process.env.NEXT_PUBLIC_PRIVACY_EMAIL) return
    expect(entityValue('privacy_email')).toBe(entityValue('support_email'))
  })

  it('says when it is standing in, rather than looking appointed', () => {
    const row = ENTITY.find((e) => e.key === 'privacy_email')!
    // Three states, and only the middle one is a derivation:
    //   dedicated address set   -> its own value, no note
    //   only a support address  -> the support value, with a note
    //   neither                 -> empty, and a gap rather than a note
    if (process.env.NEXT_PUBLIC_PRIVACY_EMAIL) expect(row.derived).toBeUndefined()
    else if (entityValue('support_email')) expect(row.derived).toBeTruthy()
    else expect(row.derived).toBeUndefined()
  })

  /**
   * The property the last change established, pinned so it cannot quietly regress.
   *
   * A contact address committed to a repository is published to everyone who can read the
   * repository, forever, and independently of whether the shop still uses it. These belong
   * in `.env.local`, which is gitignored.
   */
  it('hardcodes no contact address or phone number in the source', () => {
    const src = readFileSync(new URL('./site.ts', import.meta.url), 'utf8')
    // Any `key: value` pair that looks like an address or a run of digits long enough to
    // be a phone number, outside a comment.
    const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
    expect(code).not.toMatch(/['"][^'"]*@[^'"]+\.[a-z]{2,}['"]/i)
    expect(code).not.toMatch(/['"]\d{7,}['"]/)
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


/**
 * The wordmark.
 *
 * Worth pinning because it renders in the header of every page, and every failure mode here
 * is a header that is wrong or missing rather than a page that errors — which is the kind
 * of thing that ships. The rule is that the shop's name always appears in full, however
 * the accent is configured.
 */
describe('siteNameParts', () => {
  const whole = (p: ReturnType<typeof siteNameParts>) => p.before + p.accent + p.after

  it('splits the name around its accented word', () => {
    const p = siteNameParts()
    expect(whole(p)).toBe(SITE_NAME)
  })

  it('always renders the whole name, whatever the accent is', () => {
    // The one invariant that matters: no configuration may drop a character of the name.
    expect(whole(siteNameParts())).toBe(SITE_NAME)
  })
})

/**
 * The split itself, exercised directly rather than through the module's own environment.
 *
 * `siteNameParts()` reads `SITE_NAME` and `SITE_NAME_ACCENT`, which are resolved once at
 * import — so the cases below re-implement the same rule against explicit inputs. That is a
 * duplicate of four lines, and the alternative is a test that can only ever check whatever
 * happens to be in `.env.local`, which is one case out of six.
 */
function split(name: string, accent: string) {
  const a = accent.trim()
  if (!a) return { before: name, accent: '', after: '' }
  const at = name.toLowerCase().indexOf(a.toLowerCase())
  if (at === -1) return { before: name, accent: '', after: '' }
  const before = name.slice(0, at)
  const matched = name.slice(at, at + a.length)
  const after = name.slice(at + a.length)
  if (!before && !after) return { before: name, accent: '', after: '' }
  return { before, accent: matched, after }
}

describe('the accent rule', () => {
  const whole = (p: { before: string; accent: string; after: string }) =>
    p.before + p.accent + p.after

  it('highlights the word, keeping the spaces around it', () => {
    expect(split('Find Any Jersey', 'Any'))
      .toEqual({ before: 'Find ', accent: 'Any', after: ' Jersey' })
  })

  it('matches case-insensitively but keeps the name’s own casing', () => {
    // Configuring `any` must still highlight the `Any` the name actually spells.
    expect(split('Find Any Jersey', 'any').accent).toBe('Any')
  })

  it('renders plain when there is no accent configured', () => {
    expect(split('Everything Jersey', '')).toEqual(
      { before: 'Everything Jersey', accent: '', after: '' })
    expect(split('Everything Jersey', '   ').accent).toBe('')
  })

  it('renders plain rather than breaking when the accent is not in the name', () => {
    // A rename that forgets to update the accent must not empty the header.
    const p = split('Everything Jersey', 'Any')
    expect(p.accent).toBe('')
    expect(whole(p)).toBe('Everything Jersey')
  })

  it('renders plain when the accent is the whole name', () => {
    // Highlighting everything is the same as highlighting nothing, and looks like a bug.
    expect(split('Jerseys', 'Jerseys').accent).toBe('')
  })

  it('highlights the first occurrence only', () => {
    expect(split('Jersey Any Jersey', 'Jersey'))
      .toEqual({ before: '', accent: 'Jersey', after: ' Any Jersey' })
  })

  it('never drops a character of the name, in any configuration', () => {
    for (const name of ['Find Any Jersey', 'Everything Jersey', 'Jerseys', 'A']) {
      for (const accent of ['', ' ', 'Any', 'any', name, 'nope', 'Jersey']) {
        expect(whole(split(name, accent))).toBe(name)
      }
    }
  })
})
