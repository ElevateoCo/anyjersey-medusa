import type { ConsentRegime } from './consent'

/**
 * What a visitor's own privacy law gives them, and how to use it.
 *
 * `lib/geo.ts` answers *where*; this answers *so what*. It is pure data and a pure
 * function, with no `next/headers` anywhere, so a client component can import it — the
 * server resolves the profile and hands it down.
 *
 * ---
 *
 * **The problem this fixes.** The privacy policy said, in one paragraph: "Wherever you
 * live… In the EU and UK you also have… In California and the other US states…". Every word
 * of that is true and it makes the reader do the work of deciding which sentence is about
 * them. A Texan cannot tell from it whether they may demand portability (they may not), and
 * a German cannot tell how long we have to answer (one month, not forty-five days). A right
 * a reader cannot identify as theirs is one they will not exercise.
 *
 * **Two rules govern what may go in this file.**
 *
 * 1. **Only verified statutory facts.** Every deadline below is the number in the statute,
 *    checked against the regulator or the text, not recalled. Where a jurisdiction's answer
 *    was not confirmed, `responseDays` is `null` and the page says we are confirming it
 *    rather than printing a number that reads authoritative and is a guess. That is the
 *    same call `lib/policies.ts` makes about a controller address, and it matters more
 *    here: a published deadline is a promise a regulator can hold us to.
 * 2. **Nothing is hidden from anyone.** The policy document stays complete and identical
 *    for every reader — a regulator reads the same page a customer does. What varies is
 *    what is put *first* and named as theirs. Tailoring a legal document by showing
 *    different people different obligations is a different thing entirely, and not this.
 */
export type Right =
  | 'access' | 'correct' | 'delete' | 'portability' | 'object'
  | 'restrict' | 'withdraw' | 'optout' | 'nondiscrimination' | 'appeal'

export const RIGHT_LABEL: Record<Right, string> = {
  access: 'Ask for a copy of the data we hold about you',
  correct: 'Ask us to correct anything that is wrong',
  delete: 'Ask us to delete it',
  portability: 'Ask for it in a portable format, or sent to another provider',
  object: 'Object to how we use it',
  restrict: 'Ask us to stop using it while a dispute is resolved',
  withdraw: 'Withdraw consent at any time, without it affecting what came before',
  optout: 'Opt out of sale or sharing for targeted advertising',
  nondiscrimination: 'Be treated no differently for exercising any of these',
  appeal: 'Appeal, in writing, if we refuse — and we must answer',
}

export type Jurisdiction = {
  key: string
  /** What to call the place to somebody who lives in it. */
  name: string
  /** The statute, so a reader can look it up rather than take our word for it. */
  law: string
  regime: ConsentRegime
  /** Statutory days to respond. `null` when we have not confirmed it for this place. */
  responseDays: number | null
  /** Days the law lets us extend by, when it does. */
  extensionDays: number | null
  rights: Right[]
  /** Who to complain to over our head. `null` where we have not confirmed the body. */
  complaint: string | null
  /** Entity fields from `lib/site.ts` this jurisdiction's disclosure needs. */
  pending: string[]
  /**
   * Retention rows whose period is set by *local* law rather than by us.
   *
   * Named, not numbered, and deliberately so. How long an invoice must be kept is the tax
   * law of the place of supply — six years in one country, ten in another — and picking
   * those numbers is a decision for this business and its accountant, not a value to
   * invent in a storefront. Naming the row tells the reader which line in the table their
   * own law governs; `backend/src/privacy.ts` already has `UNRESOLVED` for the same idea on
   * the enforcement side.
   */
  retentionSetLocally: string[]
}

/** The rights every one of these laws grants, so the lists below only state the differences. */
const CORE: Right[] = ['access', 'correct', 'delete']

const GDPR_RIGHTS: Right[] = [
  ...CORE, 'portability', 'object', 'restrict', 'withdraw', 'nondiscrimination',
]

/** The US comprehensive-privacy-law set. Portability exists; restriction does not. */
const US_RIGHTS: Right[] = [...CORE, 'portability', 'optout', 'nondiscrimination', 'appeal']

export const JURISDICTIONS: Record<string, Jurisdiction> = {
  eu: {
    key: 'eu',
    name: 'the EU and EEA',
    law: 'the GDPR',
    regime: 'opt-in',
    // Article 12(3): one month, extendable by two further months.
    responseDays: 30,
    extensionDays: 60,
    rights: GDPR_RIGHTS,
    complaint: 'your national data protection authority',
    // Article 27: a controller outside the EU selling into it must appoint a representative.
    pending: ['eu_representative', 'legal_name', 'address', 'privacy_email'],
    retentionSetLocally: ['Orders and invoices'],
  },
  uk: {
    key: 'uk',
    name: 'the United Kingdom',
    law: 'the UK GDPR and the Data Protection Act 2018',
    regime: 'opt-in',
    responseDays: 30,
    extensionDays: 60,
    rights: GDPR_RIGHTS,
    complaint: 'the Information Commissioner’s Office (ICO)',
    pending: ['legal_name', 'address', 'privacy_email'],
    retentionSetLocally: ['Orders and invoices'],
  },
  ch: {
    key: 'ch',
    name: 'Switzerland',
    law: 'the revised Federal Act on Data Protection',
    regime: 'opt-in',
    // Not confirmed against the statute, so it is not printed. See rule 1 above.
    responseDays: null,
    extensionDays: null,
    rights: [...CORE, 'portability', 'object', 'withdraw'],
    complaint: 'the Federal Data Protection and Information Commissioner (FDPIC)',
    pending: ['legal_name', 'address', 'privacy_email'],
    retentionSetLocally: ['Orders and invoices'],
  },
  br: {
    key: 'br',
    name: 'Brazil',
    law: 'the LGPD',
    regime: 'opt-in',
    // Article 19: fifteen days for a full access request.
    responseDays: 15,
    extensionDays: null,
    rights: [...CORE, 'portability', 'object', 'withdraw', 'nondiscrimination'],
    complaint: 'the ANPD',
    pending: ['legal_name', 'address', 'privacy_email'],
    retentionSetLocally: ['Orders and invoices'],
  },
  'us-ca': {
    key: 'us-ca',
    name: 'California',
    law: 'the CCPA, as amended by the CPRA',
    // Opt-in here is a CIPA decision, not a CCPA one — see `lib/geo.ts`.
    regime: 'opt-in',
    responseDays: 45,
    extensionDays: 45,
    rights: US_RIGHTS,
    complaint: 'the California Privacy Protection Agency, or the Attorney General',
    pending: ['legal_name', 'address', 'privacy_email'],
    retentionSetLocally: [],
  },
  us: {
    key: 'us',
    name: 'the United States',
    law: 'your state’s consumer privacy law, where it has one',
    regime: 'opt-out',
    responseDays: 45,
    extensionDays: 45,
    rights: US_RIGHTS,
    complaint: 'your state Attorney General',
    pending: ['legal_name', 'address', 'privacy_email'],
    retentionSetLocally: [],
  },
  'ca-qc': {
    key: 'ca-qc',
    name: 'Québec',
    law: 'Law 25',
    regime: 'opt-in',
    responseDays: 30,
    extensionDays: null,
    rights: [...CORE, 'portability', 'withdraw', 'nondiscrimination'],
    complaint: 'the Commission d’accès à l’information du Québec',
    pending: ['legal_name', 'address', 'privacy_email'],
    retentionSetLocally: ['Orders and invoices'],
  },
  ca: {
    key: 'ca',
    name: 'Canada',
    law: 'PIPEDA',
    regime: 'opt-out',
    responseDays: 30,
    extensionDays: null,
    rights: [...CORE, 'withdraw', 'nondiscrimination'],
    complaint: 'the Office of the Privacy Commissioner of Canada',
    pending: ['legal_name', 'address', 'privacy_email'],
    retentionSetLocally: ['Orders and invoices'],
  },
  /**
   * The fallback, and the one a visitor gets when no edge header reached us.
   *
   * It promises the **strictest** handling we offer rather than the weakest. Somewhere we
   * cannot place is not somewhere with no privacy law, and offering a reader less than the
   * next reader gets for a reason neither of them can see is not a defensible default.
   */
  other: {
    key: 'other',
    name: 'your country',
    law: 'your local data protection law',
    regime: 'opt-in',
    responseDays: 30,
    extensionDays: null,
    rights: GDPR_RIGHTS,
    complaint: null,
    pending: ['legal_name', 'address', 'privacy_email'],
    retentionSetLocally: ['Orders and invoices'],
  },
}

const EEA = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
])

/** Country and subdivision to the profile that governs them. */
export function jurisdictionFor(
  country: string | null, region: string | null
): Jurisdiction {
  if (!country) return JURISDICTIONS.other
  const c = country.toUpperCase()
  const r = region?.toUpperCase() ?? null

  if (EEA.has(c)) return JURISDICTIONS.eu
  if (c === 'GB') return JURISDICTIONS.uk
  if (c === 'CH') return JURISDICTIONS.ch
  if (c === 'BR') return JURISDICTIONS.br
  // Order matters: California before the rest of the US, Québec before the rest of Canada.
  if (c === 'US') return r === 'CA' ? JURISDICTIONS['us-ca'] : JURISDICTIONS.us
  if (c === 'CA') return r === 'QC' ? JURISDICTIONS['ca-qc'] : JURISDICTIONS.ca
  return JURISDICTIONS.other
}

/** "within 30 days" / "within 45 days, which we may extend once by a further 45". */
export function deadlineSentence(j: Jurisdiction): string {
  if (j.responseDays === null) {
    return 'We answer as quickly as we can, and we are confirming the exact period ' +
      'your law sets before we publish it here.'
  }
  const base = `We answer within ${j.responseDays} days`
  if (!j.extensionDays) return `${base}.`
  return `${base}. Where the law allows it and a request is genuinely complex, we may ` +
    `extend that once by a further ${j.extensionDays} days, and we will tell you why ` +
    `before the first ${j.responseDays} are up.`
}
