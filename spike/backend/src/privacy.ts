/**
 * Where personal data lives, why, for how long, and what erasure does to it.
 *
 * This file exists for the same reason `src/integrations.ts` does: the alternative to one
 * enumerated list is knowledge spread across eight models and three routes, which is
 * knowledge nobody can act on when a request arrives with a thirty-day clock on it.
 *
 * **It is executable, and that is the point.** The published privacy policy already promises
 * specific retention periods — "Jersey requests: two years", "Orders and invoices: seven
 * years" — and until now nothing enforced any of them. The register below is what the
 * retention job prunes from and what the subject-access and erasure endpoints walk, so a
 * promise on the policy page and the behaviour of the database cannot drift apart without a
 * test failing. `storefront/lib/policies.ts` is the published text; this is its enforcement.
 *
 * GDPR Article 25 is the frame — data protection by design *and by default*. The defaults
 * here are the conservative direction in each case: delete rather than keep, anonymise rather
 * than delete where a record must legally survive, and refuse to guess where the answer is a
 * business decision rather than an engineering one.
 */

/**
 * What happens to a store when somebody asks to be erased.
 *
 * The three are genuinely different obligations and collapsing them is the usual mistake:
 *
 *  - `delete` — the row *is* the personal data. A contact message is an address and a
 *    sentence somebody wrote; there is nothing left once you remove the person, so a soft
 *    delete that leaves the address in the table does not answer the request.
 *  - `anonymise` — the record must survive for a reason that outlives the person's
 *    relationship with us. An order is a tax record for seven years; erasing it is not
 *    lawful, but the name and address on it can go once the retention period for *those*
 *    fields has passed and the accounting record has not.
 *  - `retain` — erasure does not apply, and the reason has to be stated rather than implied.
 */
export type ErasureAction = 'delete' | 'anonymise' | 'retain'

export type DataStore = {
  /** The table, as it appears in the database. */
  table: string
  /** What an operator would call it. */
  label: string
  /** Which columns hold personal data. Anything not listed here is not about a person. */
  fields: string[]
  /** How a subject is found in this store. `null` means it is reachable only via an order. */
  subjectKey: string | null
  /** Why we are allowed to hold it, in the Article 6 sense. */
  basis: string
  /**
   * Days after which a row is no longer needed, or null when the answer is not ours to
   * pick. Null is a deliberate state, not an oversight — see `UNRESOLVED` below.
   */
  retentionDays: number | null
  /** Which sentence in the published policy this implements, so the two can be checked. */
  published: string | null
  erasure: ErasureAction
  /** Required when erasure is `retain` or `anonymise`. */
  reason?: string
}

const YEAR = 365
const DAY = 1

/**
 * The stores, in the order a subject-access request should read them.
 *
 * Medusa's own tables are included even though this module does not own them: a data subject
 * does not care which module holds their address, and a register that covers only the tables
 * we happened to write is not a register.
 */
export const DATA_STORES: DataStore[] = [
  {
    table: 'inbound_message',
    label: 'Contact messages and newsletter signups',
    fields: ['email', 'name', 'phone', 'body'],
    subjectKey: 'email',
    basis: 'Consent for marketing; legitimate interest for answering a question that was asked',
    retentionDays: 2 * YEAR,
    published: 'Extends the published table — see the note in storefront/lib/policies.ts',
    erasure: 'delete',
  },
  {
    table: 'jersey_request',
    label: 'Sourcing requests',
    fields: ['email', 'raw_request'],
    subjectKey: 'email',
    basis: 'Steps taken at the request of the data subject prior to entering a contract',
    retentionDays: 2 * YEAR,
    published: 'Jersey requests — two years, or until you ask us to delete them',
    erasure: 'delete',
  },
  {
    table: 'product_review',
    label: 'Product reviews',
    fields: ['email', 'author_name', 'body'],
    subjectKey: 'email',
    basis: 'Consent — a review is volunteered, and publishing it is the whole purpose',
    // No fixed term: a published review is content the shop relies on, and deleting reviews
    // on a timer would quietly shrink an aggregate customers are shown. Erasure on request
    // is the control, not expiry.
    retentionDays: null,
    published: null,
    erasure: 'delete',
  },
  {
    table: 'return_request',
    label: 'Return requests',
    fields: ['email', 'comment'],
    subjectKey: 'email',
    basis: 'Contract, and legal obligation under consumer law',
    retentionDays: 7 * YEAR,
    published: 'Follows orders and invoices — seven years',
    erasure: 'anonymise',
    reason:
      'A return decision is the evidence for a refusal under a final-sale policy and for a ' +
      'chargeback. The decision survives; the address on it does not.',
  },
  {
    table: 'line_personalisation',
    label: 'Names and numbers printed on shirts',
    fields: ['value', 'approved_preview'],
    subjectKey: null,
    basis: 'Contract — it is what the customer bought',
    // Two years rather than seven. The order line proves what was sold; the rendered preview
    // is chargeback evidence, and a chargeback cannot be raised this late. The *name* is
    // frequently a third party's — a player's, or a gift recipient's — who never dealt with
    // us at all, which is the strongest argument for the shorter term.
    retentionDays: 2 * YEAR,
    published: null,
    erasure: 'anonymise',
    reason: 'The order line records what was sold; the printed value and its preview do not.',
  },
  {
    table: 'store_review',
    label: 'Imported marketplace reviews',
    fields: ['author_name', 'body'],
    // Imported from eBay, Depop and Facebook Marketplace with no address attached, so a
    // subject cannot be found by email here. Erasure is by name, which is why it is manual.
    subjectKey: null,
    basis: 'Legitimate interest in displaying reviews of transactions that happened',
    retentionDays: null,
    published: null,
    erasure: 'delete',
  },
  {
    table: 'notification_recipient',
    label: 'Staff who receive operational notifications',
    fields: ['email', 'name'],
    subjectKey: 'email',
    basis: 'Legitimate interest in operating the shop — these are colleagues, not customers',
    // Kept while they are on the list. A colleague who leaves is removed from the list, which
    // is a hard delete, so there is nothing for a timer to collect.
    retentionDays: null,
    published: null,
    erasure: 'delete',
  },
  {
    table: 'customer',
    label: 'Customer accounts',
    fields: ['email', 'first_name', 'last_name', 'phone'],
    subjectKey: 'email',
    basis: 'Contract',
    retentionDays: null,
    published: 'Account details — until you delete the account, then removed within 30 days',
    erasure: 'delete',
  },
  {
    table: 'order',
    label: 'Orders, addresses and invoices',
    fields: ['email', 'shipping_address', 'billing_address'],
    subjectKey: 'email',
    basis: 'Contract, and legal obligation — tax and customs record-keeping',
    retentionDays: 7 * YEAR,
    published: 'Orders and invoices — seven years, tax and customs record-keeping requires it',
    erasure: 'retain',
    reason:
      'Erasing an order is not lawful while the record-keeping obligation runs. Article 17(3)(b) ' +
      'is the exception, and it is the reason the policy says deleting an account does not ' +
      'delete the orders behind it.',
  },
  {
    table: 'cart',
    label: 'Abandoned carts',
    fields: ['email', 'shipping_address'],
    subjectKey: 'email',
    // A cart that never became an order is not a tax record. It is a marketing asset, and
    // the recovery email is the only thing it is for.
    basis: 'Legitimate interest in recovering an abandoned purchase',
    retentionDays: 180 * DAY,
    published: null,
    erasure: 'delete',
  },
]

/**
 * Stores whose retention period is a business decision nobody has made.
 *
 * Reported rather than defaulted. Picking a number here would put a retention period into
 * effect that appears in no policy, which is the same defect as a policy period that appears
 * in no code — just pointing the other way.
 */
export const UNRESOLVED = DATA_STORES.filter((s) => s.retentionDays === null)

export const byTable = (table: string) => DATA_STORES.find((s) => s.table === table)

/** Stores a subject-access request can search directly, given an email address. */
export const SEARCHABLE = DATA_STORES.filter((s) => s.subjectKey)

/**
 * The value written over a field when a record is anonymised.
 *
 * A fixed string rather than a random one, so that anonymised rows are obviously anonymised
 * when somebody reads the table — and so that two anonymised orders cannot be told apart by
 * their placeholder, which would re-identify them by elimination.
 */
export const ANONYMISED = '[erased]'
export const ANONYMISED_EMAIL = 'erased@invalid'

/**
 * Mask an address for a log line.
 *
 * `a***@example.com` keeps a support conversation traceable — an operator with the customer
 * on the phone can confirm it is the right person — while keeping the address itself out of a
 * log that is retained for ninety days and shipped to whoever runs the platform. The domain
 * survives because it is not what identifies somebody.
 */
export const maskEmail = (email: string | null | undefined): string => {
  const value = String(email ?? '').trim()
  const at = value.lastIndexOf('@')
  if (at < 1) return value ? '[redacted]' : ''
  const local = value.slice(0, at)
  const domain = value.slice(at)
  return `${local[0]}${'*'.repeat(Math.max(2, Math.min(local.length - 1, 6)))}${domain}`
}
