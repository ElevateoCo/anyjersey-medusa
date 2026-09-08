import { model } from '@medusajs/framework/utils'

/**
 * Product reviews.
 *
 * Shaped by research.md §7.10 rather than by the star rating. The FTC Consumer Reviews
 * and Testimonials Rule (effective 21 Oct 2024, $51,744 per violation) and the EU Omnibus
 * review provisions both bite here, so three things are structural rather than optional:
 *
 *  1. **`verified_purchase` is derived, never claimed.** It is set by checking whether
 *     that email actually has a delivered-or-placed order containing the product. A
 *     "verified" badge you can set by hand is exactly what the rule prohibits.
 *
 *  2. **Rejection carries a reason, and sentiment is not one.** Suppressing negative
 *     reviews is named explicitly in the FTC rule. The allowed reasons are policy
 *     violations; `status` cannot be set to rejected without one.
 *
 *  3. **Nothing is incentivised.** There is no field for a discount given in exchange,
 *     because incentivising a particular sentiment is also prohibited.
 */
export const ProductReview = model
  .define('product_review', {
    id: model.id().primaryKey(),
    product_id: model.text(),

    rating: model.number(),
    title: model.text().nullable(),
    body: model.text(),

    author_name: model.text(),
    email: model.text(),

    // derived at submission from order history — never accepted from the client
    verified_purchase: model.boolean().default(false),
    order_id: model.text().nullable(),

    status: model.enum(['pending', 'approved', 'rejected']).default('pending'),
    // policy reasons only. Sentiment is not a rejection reason (§7.10).
    rejection_reason: model
      .enum(['spam', 'abusive', 'off_topic', 'personal_info', 'not_a_customer'])
      .nullable(),
    moderated_by: model.text().nullable(),
    moderated_at: model.dateTime().nullable(),

    // "true to size" answers the biggest objection in apparel (§12.8 block 10)
    fit_feedback: model.enum(['small', 'true', 'large']).nullable(),
  })
  .indexes([
    { on: ['product_id'] },
    { on: ['status'] },
    { on: ['verified_purchase'] },
    /**
     * One review per email per product, enforced by the database rather than by a check.
     *
     * The rule already existed in `/store/reviews`, as a read followed by a write — which
     * is not a rule, it is a race. Two submissions arriving together both saw no existing
     * row and both inserted. The same index also removes a sequential scan: the lookup
     * filtered on `email`, and nothing was indexed on it.
     *
     * Partial on `deleted_at IS NULL`, matching every other unique index in this module, so
     * a soft-deleted review does not block the address from reviewing again.
     */
    { on: ['product_id', 'email'], unique: true, where: 'deleted_at IS NULL' },
  ])
