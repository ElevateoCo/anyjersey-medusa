import { model } from '@medusajs/framework/utils'

/**
 * Who at the shop gets told when something happens.
 *
 * Every one of the nine emails this application sends addresses the *customer*. A contact
 * form submission emailed the person who wrote in and told nobody here; a paid order, a
 * sourcing request and a return request all arrived in silence. The rows were in the database
 * and the admin screens read them, but every piece of inbound work had to be discovered by
 * going to look for it — on a shop whose refund policy tells people to write in and whose
 * whole proposition is "ask us and we'll source it".
 *
 * **A table rather than an environment variable**, which was the other obvious option and is
 * worse for two reasons. Adding a colleague should not be a redeploy; and one address for
 * everything means whoever handles returns also receives every order confirmation, which is
 * how a notification address becomes a folder nobody opens.
 *
 * These are staff addresses, not customer data, but they are still personal data and they are
 * in the privacy register for that reason. What arrives at them, though, *is* customer data —
 * an order notification carries an address and a name — so the list is owner-only to manage.
 */
export const NOTIFICATION_EVENTS = [
  'order_placed',
  'contact_received',
  'jersey_request',
  'return_request',
] as const

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]

export const NotificationRecipient = model
  .define('notification_recipient', {
    id: model.id().primaryKey(),

    email: model.text(),
    /** For the admin list, so a row is recognisable without parsing the address. */
    name: model.text().nullable(),

    /**
     * Which events this address receives, as a JSON array of `NOTIFICATION_EVENTS`.
     *
     * A JSON column and not a join table, because the list is a handful of colleagues and a
     * membership table for four fixed values would be three queries to answer "who gets
     * orders". Filtering happens in application code for the same reason: at this size,
     * reading every row and filtering in memory is faster than a JSON containment query and
     * far easier to read.
     *
     * Empty is allowed and means "receives nothing" — the same state as inactive, reached a
     * different way, and both are kept because unticking every box and switching someone off
     * are different intentions.
     */
    events: model.json(),

    /**
     * Paused rather than removed.
     *
     * Somebody on holiday should not have to be deleted and re-added, and a deleted row loses
     * which events they were subscribed to.
     */
    active: model.boolean().default(true),

    /** Free text: "returns only", "covering for Sam until the 14th". */
    note: model.text().nullable(),
  })
  .indexes([
    { on: ['active'] },
    // One row per address. Partial on deleted_at like every other unique index here, so a
    // removed colleague can be re-added later.
    { on: ['email'], unique: true, where: 'deleted_at IS NULL' },
  ])
