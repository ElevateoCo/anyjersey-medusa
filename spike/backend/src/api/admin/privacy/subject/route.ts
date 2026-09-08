import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../../modules/catalog'
import {
  ANONYMISED, ANONYMISED_EMAIL, DATA_STORES, SEARCHABLE, maskEmail,
} from '../../../../privacy'

/**
 * Everything held about one person, and the ability to erase it.
 *
 * The published privacy policy already says: *"you can ask us for a copy of your data, ask us
 * to correct it, ask us to delete it… We respond within 30 days. We will ask you to confirm
 * the email address on the order rather than requiring an account."* Until now that was a
 * sentence with nothing behind it — answering a request meant hand-written SQL across eight
 * tables, and knowing which eight.
 *
 * `GET` is Article 15 (access) and Article 20 (portability) in one: the response is the export.
 * `DELETE` is Article 17, and it does three different things depending on the store, because
 * erasure is not one operation:
 *
 *   delete     the row *is* the personal data — a contact message is an address and a
 *              sentence, and nothing survives the person
 *   anonymise  the record must outlive the relationship — a return decision is evidence for a
 *              refusal, so the decision stays and the address on it goes
 *   retain     erasure does not apply and the reason is stated — an order is a tax record for
 *              seven years, which is Article 17(3)(b), and it is why the policy says deleting
 *              an account does not delete the orders behind it
 *
 * The response reports all three, per store. An erasure that quietly skipped the orders would
 * be worse than one that refused, because the subject would believe it was done.
 */

const emailFrom = (req: MedusaRequest): string => {
  const raw = String(
    (req.query.email as string) ?? ((req.body ?? {}) as { email?: string }).email ?? ''
  ).trim().toLowerCase()
  if (!raw || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      'An email address is required. This is the identifier the policy tells subjects to ' +
      'confirm, rather than requiring an account.')
  }
  return raw
}

/** Catalog-module stores, by table, with the service method stem each one needs. */
const CATALOG_STORES: Record<string, string> = {
  inbound_message: 'InboundMessages',
  jersey_request: 'JerseyRequests',
  product_review: 'ProductReviews',
  return_request: 'ReturnRequests',
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const email = emailFrom(req)
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const found: Record<string, unknown[]> = {}

  for (const [table, stem] of Object.entries(CATALOG_STORES)) {
    found[table] = await catalog[`list${stem}`]({ email }, { take: 1000 })
      .catch(() => [])
  }

  const { data: orders } = await query.graph({
    entity: 'order',
    fields: ['id', 'display_id', 'email', 'created_at', 'total', 'currency_code',
             'shipping_address.*', 'billing_address.*', 'items.title', 'items.quantity'],
    filters: { email } as any,
    pagination: { take: 200, skip: 0 },
  }).catch(() => ({ data: [] as any[] }))
  found['order'] = orders as unknown[]

  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'email', 'first_name', 'last_name', 'phone', 'created_at'],
    filters: { email } as any,
  }).catch(() => ({ data: [] as any[] }))
  found['customer'] = customers as unknown[]

  // Personalisations are reachable only through an order — the printed name is frequently a
  // third party's and is never keyed by the buyer's address.
  const orderIds = (orders as any[]).map((o) => o.id)
  found['line_personalisation'] = orderIds.length
    ? await catalog.listLinePersonalisations({ order_id: orderIds }, { take: 1000 })
        .catch(() => [])
    : []

  const total = Object.values(found).reduce((n, rows) => n + rows.length, 0)

  res.json({
    subject: email,
    generated_at: new Date().toISOString(),
    record_count: total,
    // Shaped by the register rather than dumped, so the export says what each group is and
    // why it is held — which is most of what Article 15 actually asks for.
    stores: DATA_STORES.map((store) => ({
      table: store.table,
      label: store.label,
      lawful_basis: store.basis,
      retention: store.retentionDays ? `${store.retentionDays} days` : 'no fixed term',
      published_as: store.published,
      on_erasure: store.erasure,
      ...(store.reason ? { erasure_note: store.reason } : {}),
      records: found[store.table] ?? [],
      // Named explicitly: a subject reading an export that omits a store should be able to
      // tell "nothing here" from "we did not look".
      searchable_by_email: !!store.subjectKey,
    })),
    not_searchable_by_email: DATA_STORES.filter((s) => !s.subjectKey).map((s) => s.table),
  })
}

/**
 * DELETE — erasure, reported honestly.
 *
 * Requires `confirm: true` in the body. Not ceremony: this is irreversible across eight
 * tables at once, and it is reachable by anyone holding the owner role.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const email = emailFrom(req)
  const body = (req.body ?? {}) as { confirm?: unknown }
  if (body.confirm !== true) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      'Send { "confirm": true } with the email. This erases across every store at once and ' +
      'cannot be undone.')
  }

  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const deleted: Record<string, number> = {}
  const anonymised: Record<string, number> = {}
  const retained: { table: string; count: number; reason: string }[] = []

  // ---------------------------------------------------------------- delete
  for (const [table, stem] of Object.entries(CATALOG_STORES)) {
    const store = DATA_STORES.find((s) => s.table === table)!
    const rows = await catalog[`list${stem}`]({ email }, { take: 5000 }).catch(() => [])
    if (!rows.length) { deleted[table] = 0; continue }

    if (store.erasure === 'delete') {
      await catalog[`delete${stem}`](rows.map((r: any) => r.id))
      deleted[table] = rows.length
    } else if (store.erasure === 'anonymise') {
      await catalog[`update${stem}`](rows.map((r: any) => ({
        id: r.id,
        email: ANONYMISED_EMAIL,
        ...(store.fields.includes('comment') ? { comment: null } : {}),
      })))
      anonymised[table] = rows.length
    }
  }

  // ---------------------------------------------------------------- orders
  const { data: orders } = await query.graph({
    entity: 'order', fields: ['id'], filters: { email } as any,
    pagination: { take: 500, skip: 0 },
  }).catch(() => ({ data: [] as any[] }))

  if ((orders as any[]).length) {
    const store = DATA_STORES.find((s) => s.table === 'order')!
    retained.push({
      table: 'order',
      count: (orders as any[]).length,
      reason: store.reason!,
    })

    // The personalisations hanging off those orders are a different matter: the order line
    // records what was sold, and the printed value does not.
    const pers = await catalog.listLinePersonalisations(
      { order_id: (orders as any[]).map((o) => o.id) }, { take: 5000 }
    ).catch(() => [])
    if (pers.length) {
      await catalog.updateLinePersonalisations(pers.map((p: any) => ({
        id: p.id, value: ANONYMISED, approved_preview: null,
      })))
      anonymised['line_personalisation'] = pers.length
    }
  }

  // Masked, because this line is the audit trail for an erasure and will outlive it — writing
  // the address into a log while deleting it from the database is self-defeating.
  logger.info(
    `[privacy] erasure for ${maskEmail(email)}: ` +
    `deleted ${Object.values(deleted).reduce((a, b) => a + b, 0)}, ` +
    `anonymised ${Object.values(anonymised).reduce((a, b) => a + b, 0)}, ` +
    `retained ${retained.reduce((n, r) => n + r.count, 0)}`
  )

  res.json({
    subject: maskEmail(email),
    deleted,
    anonymised,
    retained,
    // Said out loud rather than left to be discovered: a subject told "erased" who then gets
    // a marketing email because a suppression list elsewhere still holds them is the failure
    // this whole endpoint is meant to prevent.
    note:
      'Customer accounts are managed by Medusa and are not erased here — delete the customer ' +
      'in the admin. Imported marketplace reviews carry no address and cannot be found by ' +
      'email; search them by author name at /admin/store-reviews.',
  })
}
