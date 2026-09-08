import { model } from '@medusajs/framework/utils'

/**
 * Something a visitor sent us: a contact form message, or a newsletter sign-up.
 *
 * One table with a `kind` rather than two, because the shape is the same — an email address,
 * an optional body, and a state somebody has to move — and because both arrive through the
 * same unauthenticated public POST and want the same rate limit and the same queue.
 *
 * A newsletter sign-up is **consent to be marketed to**, which is why `consented_at` and
 * `source` exist and why there is an `unsubscribed_at` rather than a delete: under GDPR and
 * the US state laws the defensible record is *when* and *where* consent was given, and a row
 * that is removed on unsubscribe cannot show that the address was suppressed rather than
 * never collected. research.md §7.6, §7.7.
 */
export const InboundMessage = model
  .define('inbound_message', {
    id: model.id().primaryKey(),

    /**
     * `suppression` is a third kind and not a variant of the other two.
     *
     * Somebody who clicks unsubscribe in a cart-recovery email may never have signed up for
     * the newsletter — they gave their address at a checkout. Recording that refusal as a
     * `newsletter` row with `unsubscribed_at` set would be a lie about where the address came
     * from, and the whole reason `consented_at` and `source` exist is that the defensible
     * record is *when* and *where*. A refusal deserves the same honesty.
     */
    kind: model.enum(['contact', 'newsletter', 'suppression']),

    email: model.text(),
    name: model.text().nullable(),
    phone: model.text().nullable(),
    /** The contact form's comment. Null on a newsletter sign-up. */
    body: model.text().nullable(),

    /** Which page it came from, so the form that generates support load is identifiable. */
    source: model.text().nullable(),

    status: model.enum(['new', 'answered', 'closed']).default('new'),
    notes: model.text().nullable(),

    /** Marketing consent, recorded rather than assumed. */
    consented_at: model.dateTime().nullable(),
    unsubscribed_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ['kind', 'status'] },
    { on: ['email'] },
    // The queue: unanswered contact messages, oldest first. Partial, so it stays small.
    { on: ['created_at'], where: "kind = 'contact' AND status = 'new'" },
    // One live subscription per address. Partial rather than a plain unique index, because
    // the same person may also have sent a contact message.
    { on: ['email'], unique: true, where: "kind = 'newsletter' AND unsubscribed_at IS NULL" },
    // The marketing suppression check, run before every commercial send.
    { on: ['email'], where: 'unsubscribed_at IS NOT NULL' },
  ])
