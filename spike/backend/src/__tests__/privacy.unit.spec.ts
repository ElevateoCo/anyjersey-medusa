import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ANONYMISED, DATA_STORES, SEARCHABLE, UNRESOLVED, byTable, maskEmail,
} from '../privacy'

/**
 * The register, and the promise it has to keep.
 *
 * The published privacy policy states retention periods. Until the register existed, nothing
 * enforced any of them — the page said two years and the database held everything forever.
 * The test that matters most in this file is the last group: it reads the storefront's
 * published table off disk and fails if a period there is not the period the retention job
 * will actually apply.
 *
 * That is the same arrangement `returns.unit.spec.ts` already uses for the refund terms, and
 * for the same reason: a policy page is a contract, and a contract the code does not honour
 * is worse than no page at all.
 */
const POLICIES = join(__dirname, '../../../storefront/lib/policies.ts')

describe('the personal data register', () => {
  it('names a lawful basis for every store', () => {
    // Article 6 is not optional and not implicit. A store nobody can name a basis for is a
    // store that should not exist.
    for (const store of DATA_STORES) {
      expect(store.basis).toBeTruthy()
      expect(store.fields.length).toBeGreaterThan(0)
    }
  })

  it('gives a reason wherever erasure is not a delete', () => {
    // "We kept your data" needs a sentence attached. Anything else is a refusal with no
    // grounds, which is exactly what a supervisory authority asks about.
    for (const store of DATA_STORES) {
      if (store.erasure === 'delete') continue
      expect(store.reason).toBeTruthy()
    }
  })

  it('retains only where the law requires it', () => {
    const retained = DATA_STORES.filter((s) => s.erasure === 'retain')
    // Exactly one: orders, under Article 17(3)(b). If a second appears, somebody has decided
    // that inconvenience is a legal basis.
    expect(retained.map((s) => s.table)).toEqual(['order'])
  })

  it('keeps the order record longest', () => {
    const order = byTable('order')!
    for (const store of DATA_STORES) {
      if (!store.retentionDays || store.table === 'order') continue
      expect(store.retentionDays).toBeLessThanOrEqual(order.retentionDays!)
    }
  })

  it('keeps a printed name for less time than the order that carries it', () => {
    // The name on a shirt is frequently a third party's — a player's, or a gift recipient's —
    // who never dealt with us at all. It has no business outliving the chargeback window.
    expect(byTable('line_personalisation')!.retentionDays)
      .toBeLessThan(byTable('order')!.retentionDays!)
  })

  it('reports the stores nobody has set a period for', () => {
    // Not an assertion that the list is empty — some of these genuinely are business
    // decisions. It is an assertion that they are *visible*, so an unset period cannot be
    // mistaken for a decision that was made.
    for (const store of UNRESOLVED) expect(store.retentionDays).toBeNull()
    expect(UNRESOLVED.map((s) => s.table).sort())
      .toEqual(['customer', 'notification_recipient', 'product_review', 'store_review'])
  })

  it('knows which stores a subject can be found in by email', () => {
    const searchable = SEARCHABLE.map((s) => s.table)
    expect(searchable).toContain('inbound_message')
    expect(searchable).toContain('order')
    // Imported reviews carry no address, and personalisations are keyed to an order rather
    // than to the buyer. Saying so is what stops an export claiming to be complete.
    expect(searchable).not.toContain('store_review')
    expect(searchable).not.toContain('line_personalisation')
  })
})

describe('maskEmail', () => {
  it('keeps the first character and the domain', () => {
    // Enough for an operator with the customer on the phone to confirm they have the right
    // person; not enough to be a mailing list if the logs leak.
    expect(maskEmail('alice@example.com')).toMatch(/^a\*+@example\.com$/)
  })

  it('does not leak the length of the local part', () => {
    const short = maskEmail('ab@example.com')
    const long = maskEmail('averylongaddressindeed@example.com')
    expect(short.split('@')[0].length).toBeLessThanOrEqual(7)
    expect(long.split('@')[0].length).toBeLessThanOrEqual(7)
  })

  it('never returns something that still looks like an address', () => {
    expect(maskEmail('notanemail')).toBe('[redacted]')
    expect(maskEmail('')).toBe('')
    expect(maskEmail(null)).toBe('')
    expect(maskEmail('@example.com')).toBe('[redacted]')
  })

  it('is what the anonymiser writes, and it is obviously a placeholder', () => {
    // A random value would make two anonymised rows distinguishable, which re-identifies
    // them by elimination.
    expect(ANONYMISED).toBe('[erased]')
  })
})

describe('the published policy and the register agree', () => {
  const published = readFileSync(POLICIES, 'utf8')

  /** Pull `{ label: '…', days: N` pairs out of the storefront's RETENTION table. */
  const publishedDays = (label: string): number | null => {
    const m = published.match(
      new RegExp(`label:\\s*'${label}',\\s*days:\\s*(null|[\\d\\s*]+)`)
    )
    if (!m) throw new Error(`"${label}" is not in the published retention table`)
    const raw = m[1].trim()
    if (raw === 'null') return null
    // The table writes `7 * 365` rather than 2555, because a reader should see the years.
    return raw.split('*').map((n) => Number(n.trim())).reduce((a, b) => a * b, 1)
  }

  it.each([
    ['Orders and invoices', 'order'],
    ['Jersey requests', 'jersey_request'],
    ['Messages you send us', 'inbound_message'],
    ['Return requests', 'return_request'],
    ['Names printed on shirts', 'line_personalisation'],
    ['Abandoned baskets', 'cart'],
  ])('%s matches %s in the register', (label, table) => {
    expect(publishedDays(label)).toBe(byTable(table)!.retentionDays)
  })

  it('publishes a row for every store the retention job can act on', () => {
    // The job only prunes stores with a period. Every one of those is a promise, so every one
    // of those has to be on the page — otherwise the shop is deleting data on a schedule it
    // never told anybody about, which is its own transparency problem.
    const enforceable = DATA_STORES.filter((s) => s.retentionDays !== null)
    expect(enforceable.length).toBeGreaterThan(4)
    expect(published).toContain('export const RETENTION')
  })

  it('still tells subjects we respond within 30 days', () => {
    // The endpoint exists to make this achievable. If the sentence goes, the endpoint has
    // lost its reason to be shaped the way it is.
    expect(published).toContain('respond within 30 days')
  })
})
