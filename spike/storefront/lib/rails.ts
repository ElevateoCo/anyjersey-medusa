import type { Card } from './medusa'

/**
 * One shirt per team, in the order the API returned them.
 *
 * The listing sorts alphabetically by handle, so the first six football products were six
 * **Arizona Cardinals** shirts — three of them the same shirt in three colours. `newest`
 * was no better: the catalogue was imported a team at a time, so it clusters too. A
 * homepage rail is a sample of a sport, and a sample that is one team six times says the
 * opposite of what the band is for.
 *
 * Thinning by team rather than re-sorting keeps the API's own order intact, so "newest"
 * still means newest — it just does not show the same club twice. Products with no team
 * (the MMA range) fall back to the player, and then to the handle, so they are never
 * collapsed into each other.
 */
export function spread(products: Card[], take = 6): Card[] {
  const seen = new Set<string>()
  const out: Card[] = []
  for (const p of products) {
    const key = p.detail?.team ?? p.detail?.player ?? p.handle
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length === take) break
  }
  // A sport with fewer distinct teams than the rail holds keeps its duplicates rather than
  // rendering a short rail — better a repeated club than a gap.
  if (out.length < take) {
    for (const p of products) {
      if (out.length === take) break
      if (!out.includes(p)) out.push(p)
    }
  }
  return out
}
