import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../../../modules/catalog'
import { invalidate, cacheKey } from '../../../../../cache'

/**
 * Membership: which products are in this collection, and in what order.
 *
 * `POST` adds, `DELETE` removes, and both take a list — because the operation an operator
 * actually performs is "put these six in", not six separate calls, and doing it in one write
 * means the storefront never sees a half-built collection.
 *
 * Position is assigned from the end on add. Reordering is a separate concern and is done by
 * sending the full ordered list to `PUT`.
 */
async function collectionOf(req: MedusaRequest) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const [collection] = await catalog.listCuratedCollections(
    { handle: req.params.handle }, { take: 1 }
  )
  if (!collection) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'No such collection.')
  return { catalog, handle: collection.handle as string }
}

const idsFrom = (body: unknown): string[] => {
  const raw = (body ?? {}) as { product_ids?: unknown }
  const list = Array.isArray(raw.product_ids) ? raw.product_ids.map(String) : []
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))]
}

const drop = (req: MedusaRequest) =>
  invalidate(req.scope as never, cacheKey('curated-collections'))

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { catalog, handle } = await collectionOf(req)
  const ids = idsFrom(req.body)
  if (!ids.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'Send { "product_ids": [...] }.')
  }

  // Checked before writing. A membership row pointing at a product that does not exist is a
  // gap in the storefront listing with nothing to explain it — the collection reports a
  // count the page cannot fill, which is the §12.7 mismatch this table exists to avoid.
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: found } = await query.graph({
    entity: 'product',
    fields: ['id'],
    filters: { id: ids } as any,
    pagination: { take: ids.length, skip: 0 },
  })
  const real = new Set((found as any[]).map((p) => p.id))
  const unknown = ids.filter((id) => !real.has(id))
  if (unknown.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND,
      `No such product: ${unknown.join(', ')}`)
  }

  const existing = await catalog.listCollectionMemberships(
    { collection_handle: handle }, { take: 100000 }
  )
  const have = new Set((existing as any[]).map((m) => m.product_id))
  const toAdd = ids.filter((id) => !have.has(id))

  let position = (existing as any[]).reduce((n, m) => Math.max(n, m.position ?? 0), -1) + 1
  if (toAdd.length) {
    await catalog.createCollectionMemberships(
      toAdd.map((product_id) => ({ collection_handle: handle, product_id, position: position++ }))
    )
  }

  await drop(req)
  res.json({
    handle,
    added: toAdd.length,
    // Reported rather than treated as an error: adding a product that is already there is a
    // double-click, not a mistake worth refusing.
    already_present: ids.length - toAdd.length,
    count: have.size + toAdd.length,
  })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { catalog, handle } = await collectionOf(req)
  const ids = idsFrom(req.body)
  if (!ids.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'Send { "product_ids": [...] }.')
  }

  const rows = await catalog.listCollectionMemberships(
    { collection_handle: handle, product_id: ids }, { select: ['id'], take: 100000 }
  )
  if (rows.length) {
    await catalog.deleteCollectionMemberships(rows.map((m: any) => m.id))
  }

  await drop(req)
  res.json({ handle, removed: rows.length })
}

/**
 * PUT — the full ordered list, which is what a drag-to-reorder saves.
 *
 * Replaces the membership set rather than patching it, so the order sent is the order stored
 * with no gaps. Products not in the list are removed: this is "here is the collection", not
 * "here are some additions".
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { catalog, handle } = await collectionOf(req)
  const ids = idsFrom(req.body)

  const existing = await catalog.listCollectionMemberships(
    { collection_handle: handle }, { take: 100000 }
  )
  if ((existing as any[]).length) {
    await catalog.deleteCollectionMemberships((existing as any[]).map((m) => m.id))
  }
  if (ids.length) {
    await catalog.createCollectionMemberships(
      ids.map((product_id, position) => ({ collection_handle: handle, product_id, position }))
    )
  }

  await drop(req)
  res.json({ handle, count: ids.length, replaced: (existing as any[]).length })
}
