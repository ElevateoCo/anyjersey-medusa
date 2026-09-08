/**
 * Cart line grouping — pure, and in its own file for a reason.
 *
 * It lived in lib/cart.ts first, and importing it into the client CartDrawer pulled that
 * whole module — and with it `next/headers` — into the client bundle, which 500'd every
 * page. Second time this boundary has bitten in this codebase (a server component once
 * passed a URL builder into SortSelect). Anything both a server component and a client
 * component need has to be free of server-only imports, so it lives here with none.
 */
import type { Line } from './cart'

/**
 * Fold personalisation add-on lines into the shirt they belong to.
 *
 * The add-on is a real product so that its price comes from the pricing engine
 * (see `addPersonalisedLine`), and the cost of that decision is exactly this: a cart holds
 * two lines for one physical item. Left unfolded, the customer sees "Personalisation —
 * $19.99" sitting on its own next to a shirt, with no indication which shirt it belongs to
 * and a Remove button that would silently orphan the printing.
 *
 * Folding is presentational only. The lines stay separate on the order, which is what makes
 * refunding a rejected personalisation a line refund rather than a price adjustment.
 */
/**
 * Structural minimum, not the full Line type.
 *
 * The cart page and the drawer each carry their own line shape, and grouping only needs an
 * id, a subtotal and enough of the variant to spot the add-on SKU. Typing against the full
 * Line made the drawer fail to compile over a field grouping never reads.
 */
type GroupableLine = {
  id: string
  subtotal?: number | string | null
  variant_sku?: string | null
  variant?: { sku?: string | null; title?: string | null } | null
}

export type Grouped<T extends GroupableLine> = T & {
  addOns: T[]
  /** Shirt plus its printing, so the row shows what the item actually costs. */
  groupSubtotal: number
}

export type GroupedLine = Grouped<Line>

export function groupLines<T extends GroupableLine>(items: T[]): Grouped<T>[] {
  const addOns = items.filter(isPersonalisationLine)
  const shirts = items.filter((i) => !isPersonalisationLine(i))

  // Matched by position: the nth add-on belongs to the nth personalised shirt. The
  // authoritative pairing lives in line_personalisation.cart_line_id server-side; this is
  // the display-side approximation, and it is only ever wrong in ordering, never in total.
  const claimed = new Set<string>()
  return shirts.map((shirt) => {
    const mine = addOns.filter((a) => !claimed.has(a.id)).slice(0, 1)
    mine.forEach((a) => claimed.add(a.id))
    return {
      ...shirt,
      addOns: mine,
      groupSubtotal: num(shirt.subtotal) + mine.reduce((t, a) => t + num(a.subtotal), 0),
    }
  })
}

/** Recognised by SKU prefix, which the seed script owns and nothing else uses. */
export const isPersonalisationLine = (line: GroupableLine) =>
  String(line.variant?.sku ?? line.variant_sku ?? '').startsWith('PERS-')

// Totals arrive as decimal strings from the API — adding them without coercion produced a
// report showing $204.59 of shipping as revenue.
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0))
