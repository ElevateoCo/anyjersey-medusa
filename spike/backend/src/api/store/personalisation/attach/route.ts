import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { randomUUID } from 'crypto'
import { CATALOG_MODULE } from '../../../../modules/catalog'
import { eligibility, toRecords, validate, priceSelection } from '../../../../personalisation'
import { limited } from '../../../../rate-limit'

/**
 * POST /store/personalisation/attach
 *
 * Called after the shirt line and the add-on line are in the cart. It re-validates from
 * scratch and records what will be printed.
 *
 * **Re-validating is the point.** The client already validated, and that counts for
 * nothing: the browser can call this endpoint directly with whatever it likes. So the name
 * is normalised and screened again here, the price is recomputed here, and the tier is
 * checked against the add-on variant the cart actually holds. A client that adds the
 * $9.99 number variant and then attaches a name and number gets rejected rather than
 * printed.
 *
 * It also writes rows, unauthenticated, which is the other reason for the limit below.
 *
 * **It stamps the cart line, too**, and that is what makes the print reachable from the
 * order. A cart line's id does not survive checkout — Medusa builds fresh order line items —
 * so `order_line_id` on this table was written by nothing and the returns endpoint, which
 * asks "is this line personalised?", always heard no. Metadata is the one field
 * `prepareLineItemData` copies verbatim from cart line to order line, so a ref written here
 * comes out the other side intact and `order-placed` joins on it.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (await limited(req, res, 'personalisation-attach', 30, 60_000)) return

  const body = (req.body ?? {}) as {
    cart_id?: string
    line_id?: string
    addon_line_id?: string
    product_id?: string
    name?: string
    number?: string
    patch?: string
    preview?: string
  }
  if (!body.cart_id || !body.line_id || !body.product_id) {
    return res.status(400).json({ message: 'cart_id, line_id and product_id are required.' })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const catalog: any = req.scope.resolve(CATALOG_MODULE)

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'jersey_detail.garment', 'jersey_detail.team', 'jersey_detail.league',
             'jersey_detail.needs_review', 'jersey_detail.is_custom'],
    filters: { id: body.product_id },
  })
  const detail = (products as any[])[0]?.jersey_detail
  const elig = eligibility(detail)
  if (!elig.eligible) return res.status(409).json({ message: elig.reason })

  const patches = (process.env[`PATCHES_${(detail?.league ?? '').toUpperCase().replace(/[^A-Z]/g, '')}`] || '')
    .split(',').map((s) => s.trim()).filter(Boolean)

  const checked = validate({
    name: body.name, number: body.number, patch: body.patch, availablePatches: patches,
  })
  if (!checked.ok) {
    return res.status(422).json({ message: 'Personalisation rejected.', errors: checked.errors })
  }
  const sel = { name: checked.name, number: checked.number, patch: checked.patch }
  // A custom jersey has already been paid for. `included` therefore changes the price to
  // zero *and* changes what counts as a valid request — see the two guards below.
  const included = !!detail?.is_custom
  const priced = priceSelection(sel, { included })

  // "Nothing selected" and "selected, but free" are different states, and the old check
  // conflated them by testing the total. On a custom shirt the total is legitimately zero
  // with a name in it, so the emptiness test has to look at the selection.
  const nothingSelected = !sel.name && !sel.number && !sel.patch
  if (nothingSelected) {
    return res.status(400).json({ message: 'Nothing to personalise.' })
  }

  // The cart must actually be holding the add-on that matches this selection. Without this
  // check the add-on line is decorative and the price is whatever the client chose to add.
  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: ['id', 'items.*'],
    filters: { id: body.cart_id },
  })
  const items = ((carts as any[])[0]?.items ?? []) as any[]
  const shirt = items.find((i) => i.id === body.line_id)
  if (!shirt) return res.status(404).json({ message: 'That line is not in this cart.' })

  /**
   * The add-on line is required only when there is something to charge for.
   *
   * On a regular jersey the check is the whole security model: without it the add-on line
   * is decorative and the price is whatever the client chose to add. On a custom jersey
   * there is no add-on, because the printing is inside the shirt's own $89.99 — so
   * demanding one would make every custom order fail, and inventing a $0 add-on product
   * would put a zero-priced line in the cart for no reason.
   *
   * The guard that replaces it is `included`, which is read from the product, not from the
   * request. A client cannot claim a shirt is custom to get free printing.
   */
  if (!included) {
    const addon = items.find((i) => i.id === body.addon_line_id)
    if (!addon) return res.status(400).json({ message: 'The personalisation line is missing.' })
    const paid = Math.round(Number(addon.unit_price ?? 0) * 100) * Number(addon.quantity ?? 1)
    if (paid !== priced.total) {
      // Not a rounding tolerance: an exact mismatch means the tier in the cart is not the
      // tier being requested.
      return res.status(409).json({
        message: 'The personalisation in the cart does not match this request.',
        expected: priced.total,
        found: paid,
      })
    }
  }

  // Replace rather than append: editing a personalisation must not leave the previous
  // version queued for print alongside the new one.
  const previous = await catalog.listLinePersonalisations({ cart_line_id: body.line_id })
  if (previous.length) {
    await catalog.deleteLinePersonalisations(previous.map((p: any) => p.id))
  }

  const lineRef = await stampLine(req, shirt, previous[0]?.line_ref)

  const created = await catalog.createLinePersonalisations(
    toRecords(sel, { league: detail?.league, included }).map((r) => ({
      cart_line_id: body.line_id,
      line_ref: lineRef,
      product_id: body.product_id,
      kind: r.kind,
      value: r.value,
      price: r.price,
      typeface: r.typeface,
      placement: r.placement,
      // Chargeback evidence (spec §7): the preview the customer actually approved.
      approved_preview: body.preview ?? null,
    }))
  )

  res.json({
    personalisations: created,
    total: priced.total,
    included,
    // Everything below waits for the human queue. Nothing is generated yet.
    review_status: 'pending',
  })
}

/**
 * Write a ref into the cart line's metadata, and answer with it.
 *
 * Written server-side rather than asked of the client, so a personalisation can never exist
 * without the ref that makes it reachable after checkout — the client would only have to
 * forget it once.
 *
 * Two details that are deliberate:
 *
 *  - **Re-editing keeps the existing ref.** The rows are deleted and recreated on every
 *    edit; re-using the ref means the line's metadata does not churn, and an order placed
 *    between two edits still resolves.
 *  - **The cart module is called directly, not `updateLineItemInCartWorkflow`.** The
 *    workflow re-runs pricing, promotions and tax for a metadata change that affects none of
 *    them, in the middle of a checkout. Metadata is not priced.
 *
 * A failure here is logged and swallowed. The personalisation itself is already valid and
 * paid for; losing the ref costs an operator a manual lookup, whereas failing the request
 * would drop a name the customer has typed and been charged for.
 */
async function stampLine(
  req: MedusaRequest,
  line: { id: string; metadata?: Record<string, unknown> | null },
  existingRef?: string | null
): Promise<string | null> {
  const fromLine = (line.metadata as Record<string, unknown> | null)?.[LINE_REF_KEY]
  const ref = (typeof fromLine === 'string' && fromLine) || existingRef || randomUUID()

  if (fromLine === ref) return ref

  try {
    const cartModule: any = req.scope.resolve(Modules.CART)
    await cartModule.updateLineItems([
      { id: line.id, metadata: { ...(line.metadata ?? {}), [LINE_REF_KEY]: ref } },
    ])
    return ref
  } catch (e) {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    logger.error(
      `[personalisation] could not stamp line ${line.id}: ` +
      `${e instanceof Error ? e.message : String(e)}. The print will not be linked to the ` +
      `order automatically.`
    )
    return null
  }
}

/**
 * The metadata key. Namespaced because this object is Medusa's, shared with anything else
 * that wants to annotate a line, and visible to the storefront.
 */
export const LINE_REF_KEY = 'faj_personalisation_ref'
