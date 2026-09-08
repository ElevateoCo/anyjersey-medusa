import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, QueryContext } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../../modules/catalog'

/**
 * GET /store/curated-collections/:handle?limit=24&offset=0&region_id=…
 *
 * One collection and its products, paginated.
 *
 * Under `curated-collections`, not `collections`: Medusa owns the latter and its validator
 * rejects any query parameter it does not know, which is a 400 that reads like a bug in this
 * route rather than a collision with a built-in one.
 *
 * Two queries rather than a join: membership lives in the catalog module and products live
 * in Medusa's, and there is no link between them by design — membership is many-to-many and
 * re-importing a collection replaces its rows wholesale, which is a delete-and-insert on a
 * flat table and a considerably more delicate operation on a link.
 *
 * Ordering is the source's own, carried on `position`, because these are editorial lists —
 * "Best Sellers" in an arbitrary order is not a best-sellers list.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const handle = String(req.params.handle ?? '')
  const limit = Math.min(Math.max(Number(req.query.limit ?? 24) || 24, 1), 100)
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const [collection] = await catalog.listCuratedCollections({ handle, active: true }, { take: 1 })
  if (!collection) return res.status(404).json({ message: 'No such collection.' })

  const memberships = await catalog.listCollectionMemberships(
    { collection_handle: handle },
    { order: { position: 'ASC' }, take: 100000 }
  )
  const ids = (memberships as any[]).map((m) => m.product_id)
  const page = ids.slice(offset, offset + limit)

  let currency: string | undefined
  if (req.query.region_id) {
    const { data: regions } = await query.graph({
      entity: 'region',
      fields: ['id', 'currency_code'],
      filters: { id: req.query.region_id as string },
    })
    currency = regions[0]?.currency_code
  }

  /**
   * `calculated_price` is requested **only** when a currency was resolved.
   *
   * Asking for it without a pricing context does not return a null price — it fails the
   * whole request with "Method calculatePrices requires currency_code in the pricing
   * context", a 400 on an endpoint that looks otherwise fine. The storefront always sends
   * `region_id`, so this only ever broke a direct call; a test that omitted it is what
   * surfaced it.
   */
  const priced = !!currency
  const { data } = page.length
    ? await query.graph({
        entity: 'product',
        fields: [
          'id', 'title', 'handle', 'thumbnail',
          'variants.id', 'variants.title',
          ...(priced ? ['variants.calculated_price.*'] : []),
          'jersey_detail.team', 'jersey_detail.player', 'jersey_detail.colourway',
          'jersey_detail.league', 'jersey_detail.season', 'jersey_detail.is_custom',
        ],
        filters: { id: page, status: 'published' } as never,
        context: priced
          ? {
              variants: {
                calculated_price: QueryContext({
                  region_id: req.query.region_id as string,
                  currency_code: currency as string,
                }),
              },
            }
          : undefined,
        pagination: { take: limit, skip: 0 } as never,
      })
    : { data: [] as any[] }

  // query.graph returns them in its own order; the editorial order is the point, so they
  // are put back into membership order here.
  const rank = new Map(page.map((id, i) => [id, i]))
  const products = (data as any[])
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
    .map((p) => ({
      id: p.id,
      handle: p.handle,
      title: p.title,
      thumbnail: p.thumbnail,
      price: p.variants?.[0]?.calculated_price?.calculated_amount ?? null,
      sizes: (p.variants ?? []).length,
      detail: p.jersey_detail ?? null,
    }))

  res.json({
    collection: {
      handle: collection.handle,
      title: collection.title,
      description: collection.description,
    },
    count: ids.length,
    limit,
    offset,
    products,
  })
}
