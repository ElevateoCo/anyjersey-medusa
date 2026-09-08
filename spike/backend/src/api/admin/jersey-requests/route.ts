import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { CATALOG_MODULE } from '../../../modules/catalog'

/** GET /admin/jersey-requests?status=new — the sourcing queue. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const status = req.query.status as string | undefined

  const all = await catalog.listJerseyRequests({}, { take: 5000, order: { created_at: 'DESC' } })
  const rows = status && status !== 'all' ? all.filter((r: any) => r.status === status) : all

  // Demand, not arrival order: what to source next, ranked.
  const demand = new Map<string, { key: string; team: string | null; player: string | null; count: number }>()
  for (const r of all) {
    if (r.status !== 'new' && r.status !== 'sourcing') continue
    const key = `${r.team ?? '?'}|${r.player ?? '?'}`
    const hit = demand.get(key) ?? { key, team: r.team, player: r.player, count: 0 }
    hit.count += 1
    demand.set(key, hit)
  }

  const counts: Record<string, number> = { all: all.length }
  for (const r of all) counts[r.status] = (counts[r.status] ?? 0) + 1

  res.json({
    requests: rows,
    counts,
    demand: [...demand.values()].sort((a, b) => b.count - a.count).slice(0, 20),
  })
}
