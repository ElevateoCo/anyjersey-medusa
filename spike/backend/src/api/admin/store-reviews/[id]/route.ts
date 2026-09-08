import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../../modules/catalog'
import { invalidate, cacheKey } from '../../../../cache'

const drop = (req: MedusaRequest) =>
  invalidate(req.scope as never, cacheKey('store-reviews'))

async function load(req: MedusaRequest) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const [review] = await catalog.listStoreReviews({ id: req.params.id }, { take: 1 })
  if (!review) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'No such review.')
  return { catalog, review }
}

/**
 * POST /admin/store-reviews/:id — correct an attribution.
 *
 * Deliberately narrow: `product_id` and `match_method` only.
 *
 * The rating, the body and the author are what a real person wrote on eBay, and the
 * storefront says they are shown as written and unfiltered. An admin screen that can edit
 * them makes that sentence false, and the FTC's Consumer Reviews rule is specifically about
 * misrepresenting what reviewers said. If a review is wrong, it goes — it does not get
 * rewritten.
 *
 * Attaching one to a product is a different act: it changes which page shows the review, not
 * what it says. `match_method` records that a human decided it, so the automatic
 * `exact_title` matches stay distinguishable from the judgement calls.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { catalog, review } = await load(req)
  const body = (req.body ?? {}) as { product_id?: string | null }

  if (!Object.prototype.hasOwnProperty.call(body, 'product_id')) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      'Only product_id can be changed. A review is shown as it was written; if it is ' +
      'wrong, delete it.')
  }

  const productId = body.product_id ? String(body.product_id).trim() : null
  if (productId) {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: 'product', fields: ['id'], filters: { id: productId } as any,
    })
    if (!(data as any[]).length) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `No such product: ${productId}`)
    }
  }

  const [updated] = await catalog.updateStoreReviews([{
    id: review.id,
    product_id: productId,
    match_method: productId ? 'manual' : 'unmatched',
  }])

  await drop(req)
  res.json({ review: updated })
}

/**
 * DELETE /admin/store-reviews/:id — takedown.
 *
 * Hard, not soft. This is the endpoint a right-to-erasure request or a defamation complaint
 * lands on, and a row that still holds the author's name after "deleting" it does not answer
 * either. The store aggregate is recomputed from what remains, so the count and the average
 * on the homepage move with it.
 *
 * The import is idempotent on `fingerprint`, which means a deleted review comes back if
 * `import-reviews.ts` is re-run against the same source file. That is a property of the
 * importer rather than of this endpoint, and it is called out in the response because
 * discovering it after a takedown would be the worst possible moment.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { catalog, review } = await load(req)

  await catalog.deleteStoreReviews([review.id])
  await drop(req)

  res.json({
    id: review.id,
    deleted: true,
    warning:
      'Re-running import-reviews.ts against the source file will restore this review — it ' +
      'de-duplicates on fingerprint, and the fingerprint goes with the row. Remove it from ' +
      'the source data too.',
  })
}
