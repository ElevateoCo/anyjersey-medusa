/**
 * CSV, with the two things that are always wrong when one is written by hand.
 *
 * Its own module because there are now two exports that need it — the customer list and the
 * order register — and the formula-injection guard is exactly the kind of protection that
 * gets left out of the second implementation. One place, one test suite.
 *
 * **Escaping.** A field is quoted whenever it contains a comma, a quote, a newline or a
 * leading/trailing space, and an embedded quote is doubled — RFC 4180. Addresses contain
 * commas and names contain apostrophes, so an unescaped export is not an edge case here, it
 * is most of the file.
 *
 * **Injection.** A cell starting `=`, `+`, `-` or `@` is executed as a formula when the file
 * is opened in Excel or Sheets. A customer chooses their own name, address and the text
 * printed on a shirt, which makes this a stored-injection sink that reaches an operator's
 * machine — and the shop would never see it happen. Prefixing a tab neutralises it and is
 * invisible in the cell.
 */
const FORMULA = /^[=+\-@\t\r]/

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (FORMULA.test(s)) s = `\t${s}`
  if (/[",\n\r]/.test(s) || s !== s.trim()) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export type Column<T> = { label: string; value: (row: T) => unknown }

/**
 * A whole file.
 *
 * CRLF and a BOM: Excel opens a UTF-8 CSV without one as Latin-1 and turns every accented
 * name into mojibake, which is the kind of thing nobody notices until a customer is
 * addressed as "JosÃ©". Note that HTTP clients commonly strip the BOM on the way back in —
 * axios does — so a test that asserts it has to read the bytes.
 */
export function toCsvFile<T>(columns: Column<T>[], rows: T[]): string {
  const header = columns.map((c) => csvCell(c.label)).join(',')
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(','))
  return `\uFEFF${[header, ...body].join('\r\n')}\r\n`
}

/** `yes`/`no`, because `TRUE`/`FALSE` in a spreadsheet becomes a boolean and then a filter. */
export const yesNo = (v: boolean) => (v ? 'yes' : 'no')

/** Two decimals, or blank. Never 0 for "unknown": a spreadsheet will sum the column. */
export const csvMoney = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : v.toFixed(2)

/** ISO date only. A timestamp with a local timezone in it is not a date somebody can sort. */
export const csvDate = (v: string | Date | null | undefined) => {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

/** Full precision, for when the time of day is the point — an order register's timestamp. */
export const csvDateTime = (v: string | Date | null | undefined) => {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}
