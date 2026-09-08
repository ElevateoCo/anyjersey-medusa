import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * The cart's `fields` string, pinned.
 *
 * This is a string-shape test, which normally would not be worth writing. It exists because
 * the failure it guards is invisible: adding a **bare** field name to Medusa's `fields`
 * switches the query from "the defaults plus these relations" to "only these fields", so
 * `subtotal`, `shipping_total` and `total` silently stop being returned.
 *
 * What that looked like in practice: the cart page rendered a **$0.00 subtotal above a
 * $69.98 total**, while the same cart fetched without the new field still reported $64.99.
 * No error, no warning, and a plausible-looking page. The `+` prefix means "in addition to
 * the defaults" — the same prefix `getProduct` already uses for `+jersey_detail.*`.
 *
 * The README records the same trap one layer down, on `items.subtotal`, where it also failed
 * as zeros. Reading `lib/cart.ts` as text is the only way to assert this without a live
 * backend, and a wrong total in a cart is worth an ugly test.
 */
const source = readFileSync(join(__dirname, 'cart.ts'), 'utf8')

const fieldsBlock = () => {
  const start = source.indexOf('const FIELDS =')
  expect(start).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('export async function getCartId'))
}

/** Every field token in the list, comments stripped. */
const tokens = () =>
  fieldsBlock()
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .match(/'([^']*)'/g)!
    .map((s) => s.slice(1, -1))
    .join(',')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

describe('the cart fields string', () => {
  it('asks for the discount total', () => {
    expect(tokens().some((t) => t.includes('discount_total'))).toBe(true)
  })

  it('asks for applied promotions', () => {
    expect(tokens().some((t) => t.includes('promotions'))).toBe(true)
  })

  it('prefixes every scalar field with + so the default totals survive', () => {
    // A token with no prefix is the bug: it turns the whole list into an explicit
    // selection and drops subtotal, shipping_total and total.
    const bare = tokens().filter((t) => !t.startsWith('*') && !t.startsWith('+'))
    expect(bare).toEqual([])
  })

  it('never requests subtotal or total explicitly', () => {
    // They come back by default. Naming them here would be the same mistake from the other
    // direction — it would work, and then the next added field would break it again.
    const t = tokens()
    expect(t).not.toContain('subtotal')
    expect(t).not.toContain('total')
    expect(t).not.toContain('+subtotal')
  })

  it('keeps the relations the cart page and drawer actually read', () => {
    const t = tokens().join(',')
    for (const needed of [
      '*items', '*items.variant', '*items.variant.product', '*shipping_methods',
      '*payment_collection', '*payment_collection.payment_sessions',
    ]) {
      expect(t).toContain(needed)
    }
  })
})
