import { csvCell, csvDate, csvDateTime, csvMoney, toCsvFile, yesNo } from '../csv'

/**
 * The two things that are always wrong when a CSV is written by hand.
 *
 * Escaping is the obvious one and still gets missed: addresses contain commas and names
 * contain apostrophes, so an unescaped export is not an edge case here, it is most of the
 * file. Formula injection is the one that matters more — a customer chooses their own name,
 * which makes this a stored-injection sink that reaches an operator's spreadsheet, and the
 * shop would never see it happen.
 */
describe('csvCell', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvCell('Ada Lovelace')).toBe('Ada Lovelace')
  })

  it('quotes a value containing a comma', () => {
    expect(csvCell('Lake Hiawatha, NJ')).toBe('"Lake Hiawatha, NJ"')
  })

  it('doubles an embedded quote, per RFC 4180', () => {
    expect(csvCell('the "real" Ada')).toBe('"the ""real"" Ada"')
  })

  it('quotes a value containing a newline', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
  })

  it('quotes a value with surrounding space, which would otherwise be silently trimmed', () => {
    expect(csvCell('  Ada  ')).toBe('"  Ada  "')
  })

  it('renders null and undefined as empty, not as the strings', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  describe('formula injection', () => {
    // Excel and Sheets execute a cell beginning with any of these. The customer picks their
    // own name and address, so this is reachable from the storefront.
    for (const lead of ['=', '+', '-', '@']) {
      it(`neutralises a cell starting with "${lead}"`, () => {
        const out = csvCell(`${lead}HYPERLINK("http://evil","click")`)
        expect(out.startsWith('\t') || out.startsWith('"\t')).toBe(true)
        expect(out).toContain(`\t${lead}`)
      })
    }

    it('neutralises a leading tab and carriage return too', () => {
      expect(csvCell('\t=1+1')).toContain('\t\t=1+1')
      expect(csvCell('\r=1+1')).toContain('\t\r=1+1')
    })

    it('does not mangle a negative number that is genuinely data', () => {
      // Still prefixed — correctness beats tidiness here, and a refund total reading
      // "\t-5.00" is legible where an executed formula is not.
      expect(csvCell('-5.00')).toContain('-5.00')
    })
  })
})

describe('toCsvFile', () => {
  type Row = { a: string; b: number }
  const columns = [
    { label: 'A', value: (r: Row) => r.a },
    { label: 'B', value: (r: Row) => r.b },
  ]

  it('starts with a BOM, so Excel does not read it as Latin-1', () => {
    // Without this every accented name arrives as mojibake and nobody notices until a
    // customer is addressed as "JosÃ©". HTTP clients commonly strip it on the way back in —
    // axios does — so an end-to-end assertion has to read the bytes.
    expect(toCsvFile(columns, []).charCodeAt(0)).toBe(0xfeff)
  })

  it('uses CRLF line endings', () => {
    expect(toCsvFile(columns, [{ a: 'x', b: 1 }])).toContain('\r\n')
  })

  it('writes the header from the labels, in order', () => {
    expect(toCsvFile(columns, []).split('\r\n')[0]).toBe('\uFEFFA,B')
  })

  it('escapes through the same path as a bare cell', () => {
    const out = toCsvFile(columns, [{ a: 'one, two', b: 3 }])
    expect(out).toContain('"one, two"')
  })
})

describe('formatters', () => {
  it('renders booleans as yes/no, not TRUE/FALSE', () => {
    // A spreadsheet turns TRUE into a boolean and then into a filter nobody asked for.
    expect(yesNo(true)).toBe('yes')
    expect(yesNo(false)).toBe('no')
  })

  it('formats money to two decimals, and leaves the unknown blank', () => {
    expect(csvMoney(64.9)).toBe('64.90')
    expect(csvMoney(null)).toBe('')
    expect(csvMoney(undefined)).toBe('')
  })

  it('writes a date without a timezone, so it sorts', () => {
    expect(csvDate('2026-09-06T19:52:33.000Z')).toBe('2026-09-06')
    expect(csvDate(null)).toBe('')
    expect(csvDate('not a date')).toBe('')
  })

  it('keeps the time where the time is the point', () => {
    expect(csvDateTime('2026-09-06T19:52:33.000Z')).toBe('2026-09-06T19:52:33.000Z')
    expect(csvDateTime(null)).toBe('')
  })
})
