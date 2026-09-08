import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils'
import {
  deleteProductsWorkflow, updateProductsWorkflow, updateProductVariantsWorkflow,
} from '@medusajs/medusa/core-flows'
import { CATALOG_MODULE } from '../../../../modules/catalog'
import {
  JerseyValidationError, normaliseJersey, searchText, sortSizes, type NormalisedJersey,
} from '../../../../jerseys'
import { shape } from '../route'

/**
 * Read, edit and delete one jersey — product and jersey_detail as a single thing.
 *
 * `:id` is the **product** id, because that is what the operator has in front of them
 * everywhere else in the admin. The detail is found through the link.
 */

/** Product plus its detail, or null. */
async function load(req: MedusaRequest, productId: string) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'product',
    fields: [
      'id', 'title', 'handle', 'status', 'description', 'thumbnail', 'images.url',
      'variants.id', 'variants.title', 'variants.sku',
      'variants.prices.amount', 'variants.prices.currency_code',
      'jersey_detail.*',
    ],
    filters: { id: productId } as any,
  })
  const product = (data as any[])[0]
  if (!product) return null
  const detail = Array.isArray(product.jersey_detail)
    ? product.jersey_detail[0]
    : product.jersey_detail
  return { product, detail: detail ?? null }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const found = await load(req, req.params.id)
  if (!found) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'No such jersey.')

  const price = found.product.variants?.[0]?.prices?.find(
    (p: any) => p.currency_code === 'usd'
  )?.amount ?? null

  res.json({
    ...shape(found.product),
    price,
    sizes: sortSizes((found.product.variants ?? []).map((v: any) => v.title)),
    detail: found.detail,
    // Said out loud, because it is the failure this whole endpoint pair exists to prevent
    // and it is otherwise invisible: a product with no detail renders fine here and is
    // absent from every storefront listing.
    storefront_visible: !!found.detail,
  })
}

/**
 * POST /admin/jerseys/:id — a partial update.
 *
 * Only the keys present in the body are touched, so the form can send one field. Product
 * fields and detail fields are separated here rather than by the caller, because which
 * module owns which column is not something an admin screen should have to know.
 *
 * The price is updated across **every** variant. The catalogue is one price per product —
 * 4,212 products at $65.99 — and a per-size price would need a per-size control; making it
 * look editable per variant while writing one number to all of them would be worse than not
 * offering it.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const found = await load(req, req.params.id)
  if (!found) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'No such jersey.')

  let patch: Partial<NormalisedJersey>
  try {
    patch = normaliseJersey(req.body as Record<string, unknown>, { partial: true })
  } catch (e) {
    if (e instanceof JerseyValidationError) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, e.message)
    }
    throw e
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const touched = (k: string) => Object.prototype.hasOwnProperty.call(body, k)

  // ---------------------------------------------------------------- product
  const productUpdate: Record<string, unknown> = {}
  if (touched('title') && patch.title) productUpdate.title = patch.title
  if (touched('handle') && patch.handle) productUpdate.handle = patch.handle
  if (touched('description')) productUpdate.description = patch.description ?? undefined
  if (touched('status') && patch.status) productUpdate.status = patch.status
  if (touched('images')) {
    productUpdate.images = (patch.images ?? []).map((url) => ({ url }))
    // Kept in step deliberately. The thumbnail is a separate column, so reordering images
    // without this leaves the card in the listing showing an image the gallery no longer
    // leads with.
    productUpdate.thumbnail = patch.images?.[0] ?? null
  }

  if (Object.keys(productUpdate).length) {
    if (productUpdate.handle && productUpdate.handle !== found.product.handle) {
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
      const { data: clash } = await query.graph({
        entity: 'product', fields: ['id'],
        filters: { handle: productUpdate.handle } as any,
      })
      if (clash.length) {
        throw new MedusaError(MedusaError.Types.DUPLICATE_ERROR,
          `The handle "${productUpdate.handle}" is already in use.`)
      }
    }
    await updateProductsWorkflow(req.scope).run({
      input: { selector: { id: found.product.id }, update: productUpdate as any },
    })
  }

  // ---------------------------------------------------------------- price
  if (touched('price') && patch.price !== undefined) {
    const variantIds = (found.product.variants ?? []).map((v: any) => v.id)
    if (variantIds.length) {
      await updateProductVariantsWorkflow(req.scope).run({
        input: {
          product_variants: variantIds.map((id: string) => ({
            id,
            prices: [{ amount: patch.price as number, currency_code: 'usd' }],
          })),
        } as any,
      })
    }
  }

  // ---------------------------------------------------------------- detail
  const DETAIL_KEYS = ['team', 'league', 'player', 'colourway', 'season', 'edition',
                       'garment', 'sport', 'seo_title', 'seo_description', 'needs_review',
                       'is_custom'] as const
  const detailTouched = DETAIL_KEYS.some(touched)

  let detail = found.detail
  if (detailTouched) {
    if (!detail) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND,
        'This product has no jersey_detail row, so its catalog fields cannot be edited. ' +
        'It was created outside /admin/jerseys and is invisible to the storefront.')
    }
    const update: Record<string, unknown> = { id: detail.id }
    for (const k of DETAIL_KEYS) {
      if (!touched(k)) continue
      update[k] = k === 'needs_review' || k === 'is_custom'
        ? (patch as any)[k]
        : (patch.taxonomy as any)?.[k] ?? (body[k] === '' ? null : body[k])
    }
    // Re-derived rather than sent, so it can never disagree with the fields it summarises —
    // which is what would make a renamed player unsearchable under their new name.
    const merged = { ...detail, ...update }
    update.search_text = searchText(merged as any)
    ;[detail] = await catalog.updateJerseyDetails([update])
  }

  const after = await load(req, found.product.id)
  res.json({ ...shape(after!.product), detail: after!.detail })
}

/**
 * DELETE /admin/jerseys/:id
 *
 * Removes the product, the detail row and the link between them. Medusa soft-deletes the
 * product; the detail is soft-deleted too, so both can be restored together if this turns
 * out to have been a mistake.
 *
 * Images are **not** deleted. They are content-addressed and shared: two products can
 * legitimately reference identical bytes, so removing the asset because one product left
 * would blank the other. Orphaned assets are a storage cost with a separate, safe sweep —
 * `scripts/prune-orphan-details.ts` is the model for that.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const found = await load(req, req.params.id)
  if (!found) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'No such jersey.')

  if (found.detail) {
    await link.dismiss([{
      [Modules.PRODUCT]: { product_id: found.product.id },
      [CATALOG_MODULE]: { jersey_detail_id: found.detail.id },
    }]).catch(() => undefined)
    await catalog.softDeleteJerseyDetails([found.detail.id]).catch(() => undefined)
  }

  await deleteProductsWorkflow(req.scope).run({ input: { ids: [found.product.id] } })

  res.json({ id: found.product.id, deleted: true, images_kept: true })
}
