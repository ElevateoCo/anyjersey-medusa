import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils'
import { createProductsWorkflow } from '@medusajs/medusa/core-flows'
import { CATALOG_MODULE } from '../../../modules/catalog'
import {
  DEFAULT_SIZES, JerseyValidationError, normaliseJersey, toDetailPayload, toProductPayload,
  type NormalisedJersey,
} from '../../../jerseys'

/**
 * POST /admin/jerseys — create a product and its jersey_detail, together.
 *
 * Deliberately **not** at `/admin/products`. Medusa owns that path and a file route there
 * inherits its validators rather than replacing it — the same trap `/store/collections`
 * fell into, where a shadowing route looked broken because it rejected fields the caller
 * was required to send.
 *
 * The reason this exists rather than pointing an operator at the stock product screen is
 * that the stock screen creates *half* a jersey. A Medusa product with no `jersey_detail`
 * has no team, no league and no `search_text`, so it appears in no facet, no league
 * listing, no team listing and no free-text search — `/store/jerseys` filters through the
 * product↔detail link, so the row is invisible to the storefront while looking perfectly
 * healthy in the admin. Creating both in one call is the only way that cannot drift.
 *
 * Not transactional across the two modules, and worth stating rather than implying: the
 * product is created by a workflow with its own compensation, then the detail row and the
 * link. If the detail fails, the product is rolled back explicitly below, because a product
 * without a detail is exactly the invisible half-jersey this endpoint is for avoiding.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const catalog: any = req.scope.resolve(CATALOG_MODULE)

  let jersey: NormalisedJersey
  try {
    jersey = normaliseJersey(req.body as Record<string, unknown>) as NormalisedJersey
  } catch (e) {
    if (e instanceof JerseyValidationError) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, e.message)
    }
    throw e
  }

  // Checked before creating rather than caught after, so the message names the conflict
  // instead of surfacing a unique-constraint violation.
  const { data: clash } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle'],
    filters: { handle: jersey.handle } as any,
  })
  if (clash.length) {
    throw new MedusaError(
      MedusaError.Types.DUPLICATE_ERROR,
      `The handle "${jersey.handle}" is already in use. Choose another.`
    )
  }

  const ctx = await requirements(req)
  const { result } = await createProductsWorkflow(req.scope).run({
    input: { products: [toProductPayload(jersey, ctx)] },
  })
  const product = (result as any[])[0]

  try {
    const [detail] = await catalog.createJerseyDetails([toDetailPayload(jersey)])
    await link.create([{
      [Modules.PRODUCT]: { product_id: product.id },
      [CATALOG_MODULE]: { jersey_detail_id: detail.id },
    }])
    res.status(201).json({ product: shape(product), detail })
  } catch (e) {
    // Roll the product back by hand. Leaving it would create precisely the state this
    // endpoint exists to prevent, and it would look fine in the admin product list.
    await deleteProduct(req, product.id).catch(() => undefined)
    throw e
  }
}

/**
 * The two things a product cannot be created without, resolved once.
 *
 * Both come from `seed-spike.ts`. They are looked up rather than configured because a
 * hard-coded id is wrong on every environment but the one it was copied from.
 */
export async function requirements(req: MedusaRequest) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const salesChannelModule: any = req.scope.resolve(Modules.SALES_CHANNEL)

  const { data: profiles } = await query.graph({
    entity: 'shipping_profile', fields: ['id', 'name'],
  })
  const shippingProfileId = profiles[0]?.id
  if (!shippingProfileId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND,
      'No shipping profile exists. Run seed-spike.ts before creating products.')
  }

  const channels = await salesChannelModule.listSalesChannels()
  const channel = channels.find((c: any) => c.name === 'Web') ?? channels[0]
  if (!channel) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND,
      'No sales channel exists. Run seed-spike.ts before creating products.')
  }

  return { shippingProfileId, salesChannelId: channel.id }
}

export async function deleteProduct(req: MedusaRequest, id: string) {
  const { deleteProductsWorkflow } = await import('@medusajs/medusa/core-flows')
  await deleteProductsWorkflow(req.scope).run({ input: { ids: [id] } })
}

/** Only what the admin screen renders — the workflow result is very large. */
export function shape(p: any) {
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    status: p.status,
    description: p.description ?? null,
    thumbnail: p.thumbnail ?? null,
    images: (p.images ?? []).map((i: any) => i.url),
    variants: (p.variants ?? []).map((v: any) => ({
      id: v.id, title: v.title, sku: v.sku,
    })),
  }
}

/** GET /admin/jerseys — the defaults the create form needs before anything exists. */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  res.json({
    default_sizes: DEFAULT_SIZES,
    // The catalogue price, so the form opens on the right number instead of empty.
    default_price: 65.99,
    custom_price: 89.99,
    statuses: ['draft', 'published'],
  })
}
