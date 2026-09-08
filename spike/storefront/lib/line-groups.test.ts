import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { groupLines, isPersonalisationLine } from './line-groups'

const shirt = (id: string, subtotal: number) =>
  ({ id, subtotal, variant: { sku: 'BRA-ROM-M', title: 'M' } })
const addon = (id: string, subtotal: number, title = 'Name & number') =>
  ({ id, subtotal, variant: { sku: 'PERS-BUNDLE', title } })

describe('recognising the add-on', () => {
  it('matches on the SKU prefix the seed script owns', () => {
    expect(isPersonalisationLine(addon('a', 19.99))).toBe(true)
    expect(isPersonalisationLine(shirt('s', 64.99))).toBe(false)
  })

  it('reads variant_sku when the variant is not expanded', () => {
    expect(isPersonalisationLine({ id: 'x', variant_sku: 'PERS-NAME' })).toBe(true)
  })

  it('is false, not a crash, for a line with no variant at all', () => {
    expect(isPersonalisationLine({ id: 'x' })).toBe(false)
    expect(isPersonalisationLine({ id: 'x', variant: null })).toBe(false)
  })
})

describe('grouping', () => {
  it('folds one add-on into the shirt and sums the two', () => {
    const [row] = groupLines([shirt('s1', 64.99), addon('a1', 19.99)])
    expect(row.id).toBe('s1')
    expect(row.addOns).toHaveLength(1)
    expect(row.groupSubtotal).toBeCloseTo(84.98, 2)
  })

  it('leaves a plain shirt alone', () => {
    const [row] = groupLines([shirt('s1', 64.99)])
    expect(row.addOns).toEqual([])
    expect(row.groupSubtotal).toBeCloseTo(64.99, 2)
  })

  it('never shows an add-on as its own row', () => {
    // The whole point: a standalone "Personalisation $19.99" row with its own Remove
    // button lets a customer orphan the printing they paid for.
    const rows = groupLines([shirt('s1', 64.99), addon('a1', 19.99), shirt('s2', 64.99)])
    expect(rows.map((r) => r.id)).toEqual(['s1', 's2'])
  })

  it('gives each add-on to exactly one shirt', () => {
    const rows = groupLines([
      shirt('s1', 64.99), shirt('s2', 64.99), addon('a1', 19.99), addon('a2', 14.99),
    ])
    const claimed = rows.flatMap((r) => r.addOns.map((a) => a.id))
    expect(new Set(claimed).size).toBe(claimed.length)
    expect(claimed.sort()).toEqual(['a1', 'a2'])
  })

  it('preserves the cart total whatever the pairing', () => {
    // Position-matching can pair the wrong add-on with the wrong shirt in display order,
    // but it must never lose or duplicate money.
    const items = [shirt('s1', 64.99), shirt('s2', 59.99), addon('a1', 19.99), addon('a2', 7.99)]
    const cartTotal = items.reduce((t, i) => t + Number(i.subtotal), 0)
    const grouped = groupLines(items).reduce((t, r) => t + r.groupSubtotal, 0)
    expect(grouped).toBeCloseTo(cartTotal, 2)
  })

  it('coerces decimal-string subtotals from the API', () => {
    // Totals arrive as strings; adding them uncoerced once turned $204.59 of shipping
    // into reported revenue.
    const rows = groupLines([
      { id: 's1', subtotal: '64.99' as any, variant: { sku: 'X' } },
      { id: 'a1', subtotal: '19.99' as any, variant: { sku: 'PERS-BUNDLE' } },
    ])
    expect(rows[0].groupSubtotal).toBeCloseTo(84.98, 2)
    expect(typeof rows[0].groupSubtotal).toBe('number')
  })

  it('drops an orphan add-on rather than inventing a shirt for it', () => {
    expect(groupLines([addon('a1', 19.99)])).toEqual([])
  })

  it('handles an empty cart', () => {
    expect(groupLines([])).toEqual([])
  })
})

/**
 * The RSC boundary, asserted statically.
 *
 * This has now broken the site twice — a server component passing a URL builder into
 * SortSelect, and this module importing `next/headers` transitively through lib/cart.ts,
 * which 500'd every page. Both times the type-checker was happy. So the rule gets a test:
 * nothing a client component imports may reach a server-only API.
 */
describe('client-importable modules stay free of server-only imports', () => {
  const SERVER_ONLY = ['next/headers', 'next/cache', "from 'fs'", 'node:fs']

  const clientComponents = readdirSync('components')
    .filter((f) => f.endsWith('.tsx'))
    .filter((f) => readFileSync(join('components', f), 'utf8').startsWith("'use client'"))

  it('finds the client components to check', () => {
    expect(clientComponents.length).toBeGreaterThan(5)
  })

  it.each(['line-groups.ts', 'medusa.ts'])(
    'lib/%s imports nothing server-only',
    (file) => {
      const src = readFileSync(join('lib', file), 'utf8')
      // Only import statements — a comment mentioning next/headers is not a violation.
      const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n')
      for (const banned of SERVER_ONLY) {
        expect(imports).not.toContain(banned)
      }
    }
  )

  it('no client component imports lib/cart, which is server-only', () => {
    const offenders = clientComponents.filter((f) => {
      const src = readFileSync(join('components', f), 'utf8')
      // A type-only import is erased at compile time and never reaches the bundle.
      return /^\s*import\s+(?!type\b)[^;]*from\s+['"]@\/lib\/cart['"]/m.test(src)
    })
    expect(offenders).toEqual([])
  })

  it('lib/cart really is server-only, so the rule above has teeth', () => {
    // If cart.ts ever stops importing next/headers, the test above stops meaning anything
    // — this catches that rather than letting it pass vacuously.
    expect(readFileSync('lib/cart.ts', 'utf8')).toContain('next/headers')
  })
})
