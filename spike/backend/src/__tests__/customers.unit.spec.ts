import { filterAndSort, selectCustomers, toCsv, type CustomerRow } from '../customers'

const row = (over: Partial<CustomerRow> = {}): CustomerRow => ({
  id: 'cus_1',
  email: 'a@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  name: 'Ada Lovelace',
  phone: '+1 214 555 0142',
  has_account: true,
  created_at: '2026-01-01T00:00:00.000Z',
  orders: 1,
  amount_spent: 64.99,
  currency_code: 'usd',
  mixed_currency: false,
  last_order_at: '2026-02-01T00:00:00.000Z',
  last_order_display_id: '11247',
  marketing: 'implied',
  address_1: '17 Nokomis Ave',
  city: 'Lake Hiawatha',
  province: 'New Jersey',
  postal_code: '07034',
  country_code: 'us',
  ...over,
})

describe('toCsv', () => {
  const csv = () => toCsv([row()])

  it('starts with a BOM, so Excel does not read it as Latin-1', () => {
    // Without this every accented name arrives as mojibake and nobody notices until a
    // customer is addressed as "JosÃ©".
    expect(csv().charCodeAt(0)).toBe(0xfeff)
  })

  it('uses CRLF line endings', () => {
    expect(csv()).toContain('\r\n')
  })

  it('writes a header row naming every column', () => {
    const header = csv().split('\r\n')[0]
    expect(header).toContain('Email')
    expect(header).toContain('Amount spent')
    expect(header).toContain('Marketing')
    expect(header).toContain('Postal code')
  })

  it('renders booleans as yes/no rather than true/false', () => {
    expect(toCsv([row({ has_account: false })])).toMatch(/,no,/)
    expect(toCsv([row({ has_account: true })])).toMatch(/,yes,/)
  })

  it('formats money to two decimals', () => {
    expect(toCsv([row({ amount_spent: 64.9 })])).toContain('64.90')
  })

  it('leaves amount blank for a mixed-currency customer rather than writing 0', () => {
    // A spreadsheet will sum this column. A fabricated zero is a wrong total nobody questions.
    const line = toCsv([row({ amount_spent: null, mixed_currency: true, currency_code: null })])
      .split('\r\n')[1]
    // The two columns are Amount spent and Currency — both empty, rather than 0.00 and USD.
    const cells = line.split(',')
    expect(cells[8]).toBe('')
    expect(cells[9]).toBe('')
  })

  it('escapes a real address, which contains a comma', () => {
    const out = toCsv([row({ address_1: '17 Nokomis Ave, Apt 2' })])
    expect(out).toContain('"17 Nokomis Ave, Apt 2"')
  })
})

describe('filterAndSort', () => {
  const rows = [
    row({ id: 'a', name: 'Ada Lovelace', email: 'ada@example.com', amount_spent: 10,
          orders: 1, created_at: '2026-01-01T00:00:00.000Z', marketing: 'subscribed',
          last_order_at: '2026-01-02T00:00:00.000Z', city: 'Dallas' }),
    row({ id: 'b', name: 'Grace Hopper', email: 'grace@example.com', amount_spent: 300,
          orders: 4, created_at: '2026-03-01T00:00:00.000Z', marketing: 'unsubscribed',
          last_order_at: '2026-04-01T00:00:00.000Z', has_account: false, city: 'Arlington' }),
    row({ id: 'c', name: 'Norby Krenik', email: 'norby@example.com', amount_spent: 134.97,
          orders: 1, created_at: '2026-02-01T00:00:00.000Z', marketing: 'implied',
          last_order_at: null, last_order_display_id: null, city: 'Lake Hiawatha' }),
  ]
  const ids = (r: CustomerRow[]) => r.map((x) => x.id)

  it('searches across email, name, phone, city and order number', () => {
    expect(ids(filterAndSort(rows, { q: 'grace' }))).toEqual(['b'])
    expect(ids(filterAndSort(rows, { q: 'hiawatha' }))).toEqual(['c'])
    expect(ids(filterAndSort(rows, { q: '11247' })).sort()).toEqual(['a', 'b'])
  })

  it('is case-insensitive', () => {
    expect(ids(filterAndSort(rows, { q: 'ADA' }))).toEqual(['a'])
  })

  it('filters by marketing state', () => {
    expect(ids(filterAndSort(rows, { marketing: 'unsubscribed' }))).toEqual(['b'])
    expect(ids(filterAndSort(rows, { marketing: 'implied' }))).toEqual(['c'])
  })

  it('separates accounts from guests', () => {
    expect(ids(filterAndSort(rows, { account: 'guest' }))).toEqual(['b'])
    expect(ids(filterAndSort(rows, { account: 'account' })).sort()).toEqual(['a', 'c'])
  })

  it('sorts by spend, highest first by default', () => {
    expect(ids(filterAndSort(rows, { sort: 'amount_spent' }))).toEqual(['b', 'c', 'a'])
  })

  it('reverses on ascending', () => {
    expect(ids(filterAndSort(rows, { sort: 'amount_spent', direction: 'asc' })))
      .toEqual(['a', 'c', 'b'])
  })

  it('sorts newest customer first by default', () => {
    expect(ids(filterAndSort(rows, {}))).toEqual(['b', 'c', 'a'])
  })

  it('sorts a never-ordered customer last in BOTH directions', () => {
    // Absent data, not an extreme value. Treating "no last order" as a very old date puts
    // somebody who has never bought anything at the top of "oldest last order", which reads
    // as a real answer and is not one.
    expect(ids(filterAndSort(rows, { sort: 'last_order_at' })).at(-1)).toBe('c')
    expect(ids(filterAndSort(rows, { sort: 'last_order_at', direction: 'asc' })).at(-1))
      .toBe('c')
  })

  it('does the same for a customer whose total cannot be stated', () => {
    const mixed = row({ id: 'm', amount_spent: null, mixed_currency: true })
    const withMixed = [...rows, mixed]
    expect(ids(filterAndSort(withMixed, { sort: 'amount_spent' })).at(-1)).toBe('m')
    expect(ids(filterAndSort(withMixed, { sort: 'amount_spent', direction: 'asc' })).at(-1))
      .toBe('m')
  })

  it('sorts by name alphabetically', () => {
    expect(ids(filterAndSort(rows, { sort: 'name', direction: 'asc' })))
      .toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input', () => {
    const before = ids(rows)
    filterAndSort(rows, { sort: 'amount_spent' })
    expect(ids(rows)).toEqual(before)
  })
})

describe('selectCustomers', () => {
  const rows = Array.from({ length: 60 }, (_, i) =>
    row({ id: `c${i}`, created_at: new Date(2026, 0, i + 1).toISOString() }))

  it('reports the full count, not the page size', () => {
    const page = selectCustomers(rows, { limit: 25 })
    expect(page.rows).toHaveLength(25)
    expect(page.count).toBe(60)
  })

  it('pages with an offset', () => {
    const second = selectCustomers(rows, { limit: 25, offset: 25 })
    expect(second.rows[0].id).not.toBe(selectCustomers(rows, { limit: 25 }).rows[0].id)
    expect(second.rows).toHaveLength(25)
  })

  it('caps the page size, so one request cannot pull the whole base', () => {
    expect(selectCustomers(rows, { limit: 100000 }).rows.length).toBeLessThanOrEqual(200)
  })

  it('counts what matched the filter, not what exists', () => {
    const page = selectCustomers(
      [...rows, row({ id: 'x', marketing: 'unsubscribed' })],
      { marketing: 'unsubscribed' }
    )
    expect(page.count).toBe(1)
  })
})
