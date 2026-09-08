import { model } from '@medusajs/framework/utils'

/**
 * What a customer asked to have printed, and what happened to that request.
 *
 * personalisation-spec.md §5. Three things are structural rather than incidental:
 *
 *  1. **`price` is a snapshot, never a join.** Same rule as order lines (research.md §6.2,
 *     trap 2): reading the current add-on price to display a past order means every
 *     historical order changes the next time prices move.
 *
 *  2. **The parameters are the record of truth; the print file is a cache.** `render_sha256`
 *     is nullable and regenerable, so changing the print spec never orphans an old order —
 *     which matters because the supplier's required format is the one thing still unknown
 *     (spec §6).
 *
 *  3. **Nothing prints without a human approving it.** Automated screening runs before the
 *     order exists; this row starts `pending` regardless, because a blocklist catches what
 *     it knows about and the residual risk on a printed garment is a trademark claim, not a
 *     rude word.
 *
 * `order_line_id` is a plain text column, not a module link. Personalisation is captured on
 * a *cart* line and frozen onto an *order* line, and both ids live in the order module — a
 * link would have to be rewritten at completion, which is exactly the moment nothing should
 * be fragile.
 */
export const LinePersonalisation = model
  .define('line_personalisation', {
    id: model.id().primaryKey(),

    // Set at add-to-cart; order_line_id is filled in at completion. Both are kept so a
    // pending personalisation can be found from either side.
    cart_line_id: model.text().nullable(),
    order_line_id: model.text().nullable(),
    order_id: model.text().nullable(),

    /**
     * The marker that survives checkout.
     *
     * `order_line_id` and `order_id` were indexed, queried in two places and written by
     * nothing: a cart line's id does not survive into the order — Medusa builds fresh line
     * items — so there was no way back from a paid order to the name that has to be printed
     * on it. The visible symptom was worse than an empty print queue: the returns endpoint
     * decides whether an item is made-to-order by looking for personalisations with that
     * `order_id`, found none, and offered a refund on a printed shirt.
     *
     * What *does* survive is `metadata`. `prepareLineItemData` copies the cart line's
     * metadata verbatim onto the order line, so a random ref written into the cart line at
     * attach time comes out the other side of checkout intact. This column holds our copy
     * of it, and the order-placed subscriber joins on it.
     *
     * A second, useful consequence: Medusa merges cart lines by variant **and metadata**
     * equality, so a line carrying a ref can never be merged with a plain one of the same
     * variant. Two differently-personalised shirts of the same size stay two lines instead
     * of collapsing into one with the second name overwriting the first.
     */
    line_ref: model.text().nullable(),
    product_id: model.text(),

    // 'bundle' is a price, not something that goes on a shirt, so it never reaches here —
    // it is expanded into a name row and a number row by toRecords().
    kind: model.enum(['name', 'number', 'patch']),
    value: model.text(),
    /** Cents, snapshotted at capture. */
    price: model.number(),
    typeface: model.text(),
    placement: model.enum(['back', 'front', 'sleeve', 'chest']),

    /** Content address of the generated print file. Nullable: it is a cache. */
    render_sha256: model.text().nullable(),

    review_status: model.enum(['pending', 'approved', 'rejected']).default('pending'),
    /**
     * Why a request was refused. Not free text: the refund path and the customer email
     * differ per reason, and "rejected" with no reason gives support nothing to say.
     */
    rejection_reason: model
      .enum(['blocklist', 'trademark', 'illegible', 'unavailable_patch', 'other'])
      .nullable(),
    reviewed_by: model.text().nullable(),
    reviewed_at: model.dateTime().nullable(),

    /**
     * The preview the customer actually approved, as a data URI or content address.
     *
     * Kept as chargeback evidence (spec §7): a personalised, non-returnable, made-to-order
     * item is a common dispute pattern, and "this is the image they signed off" is the
     * strongest answer available.
     */
    approved_preview: model.text().nullable(),
  })
  .indexes([
    // Partial index for the review queue: the table grows with every order, the queue
    // stays small.
    { on: ['review_status'], where: "review_status = 'pending'" },
    { on: ['order_id'] },
    { on: ['cart_line_id'] },
    // The join the subscriber makes, once per order.
    { on: ['line_ref'] },
  ])
