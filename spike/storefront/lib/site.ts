/**
 * Site-level constants and entity details.
 *
 * Two rules govern this file.
 *
 * **1. The canonical origin comes from the environment, never from a request header.**
 * `sitemap.xml`, `robots.txt`, canonical links and JSON-LD all have to agree on one
 * absolute origin, and a value derived from `Host` disagrees with itself the moment the
 * site is reachable on a preview URL, a proxy hostname, and its real domain — which is
 * exactly when duplicate-content damage happens.
 *
 * **2. Legal entity details are placeholders until someone fills them in, and they say so.**
 * research.md §7.6, §7.8 and §13.5 make the same point in three places: a guessed
 * regulatory value is not a data-quality problem, it is a false statement. So the policy
 * pages read these fields and render a visible "not yet appointed" marker rather than
 * inventing a company address or an EU representative. `pendingEntityFields()` is what the
 * pages use to show that honestly.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
).replace(/\/$/, '')

export const SITE_NAME = 'Find Any Jersey'
export const SITE_TAGLINE = 'Hard-to-find jerseys shipped on-demand'

/** Absolute URL for a site-relative path. Trailing-slash safe on both halves. */
export const abs = (path: string) =>
  `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`

/**
 * Is this deployment allowed to be indexed?
 *
 * Defaults to **no**. A staging copy that quietly invites crawlers competes with the real
 * store for its own keywords, and the failure is silent for weeks. Indexing is therefore
 * opt-in per environment.
 */
export const INDEXABLE = process.env.NEXT_PUBLIC_ALLOW_INDEXING === 'true'

export type EntityField = {
  key: string
  label: string
  value: string
  why: string
  /**
   * Set when `value` came from somewhere other than its own variable.
   *
   * A field that is standing in for another is not the same as one that was filled in, and
   * the page says which it is. Without this the fallback below would read as an
   * appointment somebody made.
   */
  derived?: string
}

/**
 * The support mailbox, resolved once so the privacy channel can fall back to it.
 *
 * Taken from the live store's own contact-information policy, like the trader name and the
 * phone number beside it.
 */
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'scholarlove77@gmail.com'

/**
 * The trader identity that consumer and product law requires on a storefront.
 *
 * Every one of these is empty in the spike. They are listed here rather than written into
 * the policy pages so that (a) there is one place to fill them in, and (b) the pages can
 * enumerate what is still missing instead of silently omitting a required disclosure.
 */
export const ENTITY: EntityField[] = [
  {
    key: 'legal_name',
    label: 'Registered company name',
    // The trading entity behind the shop, taken from the live store's own contact-information
    // policy. It is not the same as the brand: the storefront trades as "Find Any Jersey"
    // and the trader is Crux Christi, which is a normal and lawful split — but the *trader*
    // is the one consumer law requires to be identified.
    value: process.env.NEXT_PUBLIC_LEGAL_NAME ?? 'Crux Christi',
    why: 'Consumer law requires the trader to be identified. FTC and EU UCPD alike.',
  },
  {
    key: 'address',
    label: 'Registered address',
    value: process.env.NEXT_PUBLIC_LEGAL_ADDRESS ?? '',
    why: 'Required on the storefront and on every invoice — research.md §7.4.',
  },
  {
    key: 'support_email',
    label: 'Support email',
    value: SUPPORT_EMAIL,
    why: 'A monitored contact route is a legal requirement, not a nicety.',
  },
  {
    key: 'phone',
    label: 'Phone number',
    value: process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? '9566226490',
    why: 'Published on the live store\u2019s contact-information policy.',
  },
  {
    /**
     * The one gap on this list that code could close, and it closes it.
     *
     * GDPR Articles 15–22, the US state laws, the LGPD and Law 25 all require a
     * **contactable channel** for a data-subject request. **None of them requires a
     * dedicated address.** So an empty variable here was not an unmet legal requirement —
     * it was a shop with a working mailbox declining to name it, and a reader with a right
     * to exercise and nowhere to send it.
     *
     * It falls back to the support mailbox, which is monitored and published already. A
     * dedicated address is better practice once the volume justifies it, and setting
     * `NEXT_PUBLIC_PRIVACY_EMAIL` takes precedence the moment it exists.
     *
     * The two appointments beside it — an Article 27 representative and a registered
     * address — have no equivalent. One is a contract with a firm established in the EU and
     * the other is a fact about the company; neither is derivable from anything in this
     * repository, and inventing either would be a false statement to a regulator.
     */
    key: 'privacy_email',
    label: 'Privacy / data-subject requests',
    value: process.env.NEXT_PUBLIC_PRIVACY_EMAIL || SUPPORT_EMAIL,
    why: 'GDPR Art. 15–22 and the US state laws all require a request channel.',
    derived: process.env.NEXT_PUBLIC_PRIVACY_EMAIL
      ? undefined
      : 'Using the support mailbox until a dedicated address is set.',
  },
  {
    key: 'eu_representative',
    label: 'GDPR Article 27 EU representative',
    value: process.env.NEXT_PUBLIC_EU_REPRESENTATIVE ?? '',
    why: 'Selling to the EU from the US requires one — research.md §7.6.',
  },
  {
    key: 'gpsr_responsible_person',
    label: 'GPSR EU Responsible Person',
    value: process.env.NEXT_PUBLIC_GPSR_RESPONSIBLE_PERSON ?? '',
    why: 'Without one, apparel cannot lawfully be placed on the EU market — §7.8.',
  },
  {
    key: 'ioss',
    label: 'IOSS registration number',
    value: process.env.NEXT_PUBLIC_IOSS_NUMBER ?? '',
    why: 'Import VAT on EU B2C consignments — §7.2.',
  },
]

export const entityValue = (key: string) =>
  ENTITY.find((e) => e.key === key)?.value || ''

/** The fields still unset, so a page can say which disclosures are outstanding. */
export const pendingEntityFields = () => ENTITY.filter((e) => !e.value)

/**
 * Fields that gate EU sales specifically.
 *
 * Kept as its own list because the consequence differs: a missing support email is a
 * compliance gap on any market, while these three block EU orders outright.
 */
export const EU_GATES = ['eu_representative', 'gpsr_responsible_person', 'ioss'] as const

/**
 * Lift the EU/UK gate while the appointments are outstanding.
 *
 * **This is a development switch, and it is written as one rather than as a commented-out
 * line.** The gate gets in the way of exercising the EU flow in a spike that takes no real
 * orders, which is a fair reason to turn it off — but a commented-out block is invisible to
 * the type checker, invisible to `grep` six months later, and is exactly the kind of thing
 * that gets committed and then shipped. A named flag can be searched for, tested, and
 * refused where it matters.
 *
 * **It cannot take effect in a production build.** `NODE_ENV` is baked in at build time, so
 * a production bundle has the override compiled out however the variable is set on the
 * host. That is the whole reason to write it this way: the convenience is available to
 * whoever is working on the thing, and there is no sequence of environment settings that
 * puts an ungated EU checkout in front of a customer.
 *
 * What the gate is actually holding back is not a formality. Without a GPSR responsible
 * person, apparel may not lawfully be placed on the EU market at all; without an Article 27
 * representative there is no one in the Union to receive a data-subject request; without an
 * IOSS registration the import VAT lands on the customer at the door. None of those become
 * true because a flag is set — the flag only stops this storefront saying so.
 */
const EU_GATE_LIFTED =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_LIFT_EU_GATE === 'true'

/** True when the gate is off, so the UI can say so rather than looking compliant. */
export const euGateLifted = () => EU_GATE_LIFTED

/**
 * The appointments still outstanding, or an empty list when the gate is lifted.
 *
 * Returning empty rather than adding a branch at each call site keeps `regionBlocked` and
 * the shipping page reading the way they did; `euGateLifted()` is what a caller uses when
 * it needs to say *why* the list is empty.
 */
export const euBlocked = () =>
  EU_GATE_LIFTED
    ? []
    : EU_GATES.filter((k) => !entityValue(k)).map((k) => ENTITY.find((e) => e.key === k)!)

/** The appointments, regardless of the flag — what is genuinely still missing. */
export const euGatesOutstanding = () =>
  EU_GATES.filter((k) => !entityValue(k)).map((k) => ENTITY.find((e) => e.key === k)!)
