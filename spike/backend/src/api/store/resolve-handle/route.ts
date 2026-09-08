import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../modules/catalog'
import { cached, cacheKey } from '../../../cache'

/**
 * GET /store/resolve-handle?handle=<old-shopify-handle>
 *
 * Where a URL from the old shop should go now.
 *
 * The import generated fresh slugs, so **1,083 of 3,155 products changed URL** — a third of
 * the catalogue. Every one of those is a page the live store has been ranked for since it
 * opened, and every one of them 404s on the new site unless something maps it across.
 *
 * The mapping already exists and nothing was reading it: `jersey_detail.source_handle` holds
 * the true Shopify handle for every imported product, which is exactly what makes this a
 * lookup rather than a migration.
 *
 * Public, and deliberately so: it answers the same question a crawler is asking, and it
 * discloses nothing that `/store/jerseys` does not. Cached for an hour, because a handle
 * mapping changes only when the catalogue is re-imported.
 */
const TTL_SECONDS = 60 * 60

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const handle = String(req.query.handle ?? '').trim().toLowerCase()
  if (!handle || !/^[a-z0-9][a-z0-9-]*$/.test(handle)) {
    return res.status(400).json({ message: 'A handle is required.' })
  }

  const { value } = await cached(
    req.scope as never,
    cacheKey('resolve-handle', handle),
    TTL_SECONDS,
    async () => {
      const catalog: any = req.scope.resolve(CATALOG_MODULE)
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

      const [detail] = await catalog.listJerseyDetails(
        { source_handle: handle }, { select: ['id'], take: 1 }
      ).catch(() => [])

      if (!detail) return { found: false as const }

      // The product is reached through the link rather than by matching handles, which is the
      // whole reason this endpoint is needed: source_handle and handle are different strings
      // and joining on them is what broke an earlier version of the listing.
      const { data } = await query.graph({
        entity: 'jersey_detail',
        fields: ['id', 'product.handle', 'product.status'],
        filters: { id: detail.id } as any,
      }).catch(() => ({ data: [] as any[] }))

      const product = (data as any[])[0]?.product
      const resolved = Array.isArray(product) ? product[0] : product
      if (!resolved?.handle || resolved.status !== 'published') return { found: false as const }

      return { found: true as const, handle: resolved.handle }
    }
  )

  if (!value.found) {
    // 404 rather than an empty 200, so a caller can tell "no mapping" from "mapped to
    // nothing" without inspecting the body.
    return res.status(404).json({ found: false })
  }
  res.json(value)
}
