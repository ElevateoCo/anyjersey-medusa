import { model } from '@medusajs/framework/utils'

/**
 * A customer-initiated return or exchange.
 *
 * Medusa v2 has a full returns domain, but it is admin-side: `POST /admin/returns` assumes
 * somebody in the back office is already handling the case. There is no store-side route a
 * customer can use to *start* one, so self-service returns need a request object of their
 * own — exactly as jersey requests do.
 *
 * Keeping it as a request rather than driving Medusa's return directly is also the right
 * shape operationally. A return has to be *accepted* before it becomes a financial event:
 * the item may be personalised and non-returnable, outside the window, or already returned
 * once. Creating a Medusa return on submission would put every one of those cases into the
 * ledger and require reversing them.
 *
 * `order_id` and `email` are stored rather than linked to the customer, because most orders
 * are guest orders — the shop deliberately has no account requirement (§12.1) — and a
 * return flow that only works for registered customers would not cover most of them.
 */
export const ReturnRequest = model
  .define('return_request', {
    id: model.id().primaryKey(),

    /** The order this concerns, and the email that proves the claim to it. */
    order_id: model.text(),
    order_display_id: model.text().nullable(),
    email: model.text(),

    /** Which line, and what is being asked for. */
    line_item_id: model.text().nullable(),
    item_title: model.text().nullable(),

    /**
     * What is being claimed. Not what the customer wants to happen — a `fault` may end in a
     * replacement or a refund, and that is the queue's decision.
     *
     * `withdrawal` is the EU/UK statutory cancellation right, which exists whatever the
     * published policy says. Under the live store's final-sale policy it is the only basis
     * on which a change of mind is accepted at all.
     */
    kind: model.enum(['fault', 'wrong_item', 'withdrawal']).default('fault'),
    /** Free text: sizes are catalog values, not an enum. */
    requested_size: model.text().nullable(),

    reason: model.enum([
      'too_small', 'too_large', 'not_as_described', 'faulty', 'wrong_item',
      'arrived_late', 'changed_mind', 'other',
    ]).default('other'),
    comment: model.text().nullable(),

    status: model.enum([
      'new', 'approved', 'label_sent', 'received', 'resolved', 'declined',
    ]).default('new'),
    /** Required to decline, so a rejection is never delivered without a reason. */
    decision_note: model.text().nullable(),

    /** Set when the return is accepted, so the free-postage promise is auditable. */
    return_shipping_paid_by: model.enum(['us', 'customer']).nullable(),

    /**
     * The refund, recorded here rather than only in Stripe.
     *
     * This row **is** the idempotency guarantee. Medusa's `refundPaymentWorkflow` takes no
     * idempotency key — its Stripe provider passes one from a payment context the workflow
     * does not expose — so the protection against refunding twice cannot live in the call.
     * It lives in `refunded_at`: set before anybody can ask again, and checked first.
     *
     * Stripe's own provider swallowing `CHARGE_ALREADY_REFUNDED` is a second layer under
     * this one, not a substitute for it: it protects the money, not the record, and an
     * operator who clicks twice deserves to be told the first one worked.
     */
    refunded_at: model.dateTime().nullable(),
    refunded_by: model.text().nullable(),
    /** Minor units, matching every other amount in this application. */
    refund_amount: model.number().nullable(),
    refund_payment_id: model.text().nullable(),
    /** Why a refund was attempted and did not happen, so a retry is possible. */
    refund_error: model.text().nullable(),
  })
  .indexes([
    { on: ['status'] },
    { on: ['order_id'] },
    { on: ['email'] },
    // The queue view: oldest unresolved first. Partial, so it stays small as history grows
    // — the same shape as the pending-personalisation index.
    {
      on: ['created_at'],
      where: "status in ('new', 'approved', 'label_sent', 'received')",
    },
  ])
