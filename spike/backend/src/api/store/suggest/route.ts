import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { CATALOG_MODULE } from '../../../modules/catalog'
import { limited } from '../../../rate-limit'

/**
 * GET /store/suggest?q=buf
 *
 * Autocomplete for a 3,155-product catalog where search is the proposition. Returns
 * *entities* rather than only products — typing "buf" should offer the team, its players
 * and a few matching jerseys, because "Buffalo Bills" as a single click beats scrolling a
 * result page.
 *
 * Matches the folded haystack, so "romario" finds Romário and "jose" finds José (§14 of
 * the spike README).
 */
const fold = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  // Typeahead, and the one read here that genuinely arrives per customer: SearchBox is a
  // client component fetching this from the browser, so the key is a real address rather
  // than the storefront's. Sixty a minute is far above a debounced search box and far below
  // a script walking the prefix space to dump the catalogue.
  if (await limited(req, res, 'suggest', 60, 60_000)) return

  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const q = fold(String(req.query.q ?? ''))

  // Two characters is the floor: one letter matches most of the catalog and the
  // suggestions are noise.
  if (q.length < 2) {
    return res.json({ q, teams: [], players: [], products: [], total: 0 })
  }

  const rows = await catalog.listJerseyDetails(
    { search_text: { $ilike: `%${q}%` } },
    {
      select: ['id', 'team', 'player', 'league', 'colourway', 'garment', 'source_handle'],
      take: 400,
    }
  )

  const tally = (field: 'team' | 'player') => {
    const m = new Map<string, { value: string; count: number; league?: string | null }>()
    for (const r of rows) {
      const v = r[field]
      if (!v || !fold(v).includes(q)) continue
      const hit = m.get(v) ?? { value: v, count: 0, league: r.league }
      hit.count += 1
      m.set(v, hit)
    }
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 5)
  }

  // Product suggestions: prefer the ones whose player matched, they read as more relevant
  const products = rows
    .filter((r: any) => r.source_handle)
    .sort((a: any, b: any) => {
      const am = a.player && fold(a.player).includes(q) ? 0 : 1
      const bm = b.player && fold(b.player).includes(q) ? 0 : 1
      return am - bm
    })
    .slice(0, 6)
    .map((r: any) => ({
      label: [r.player, r.team, r.colourway].filter(Boolean).join(' · '),
      team: r.team,
      handle: r.source_handle,
    }))

  res.json({
    q: String(req.query.q ?? ''),
    teams: tally('team'),
    players: tally('player'),
    products,
    total: rows.length,
  })
}
