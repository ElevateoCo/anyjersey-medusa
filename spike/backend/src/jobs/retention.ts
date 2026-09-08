import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import type { MedusaContainer } from '@medusajs/framework/types'
import { ANONYMISED, DATA_STORES, UNRESOLVED } from '../privacy'
import { CATALOG_MODULE } from '../modules/catalog'

/**
 * Storage limitation, enforced nightly.
 *
 * The published privacy policy has promised retention periods since the day the policy page
 * shipped — "Jersey requests: two years", "Orders and invoices: seven years" — and nothing
 * deleted anything. Every row ever written was still there. GDPR Article 5(1)(e) is the
 * obligation; Article 25 is why it belongs in a scheduled job rather than in an operator's
 * memory.
 *
 * **Dry by default.** `PRIVACY_RETENTION_APPLY=true` is what makes it delete. That is not
 * timidity — the first run of a retention job against a real database is the one that removes
 * two years of history in a transaction nobody watched, and the count it reports first is
 * cheap insurance. The log line says which mode it ran in every time, so a job that has been
 * reporting and never applying cannot masquerade as one that works.
 *
 * Periods come from `src/privacy.ts`, which is the same register the subject-access and
 * erasure endpoints walk and the same one the policy page is checked against. A period that
 * exists in one place and not the others is the drift this arrangement is designed to make
 * impossible.
 */
const CATALOG_STORES: Record<string, string> = {
  inbound_message: 'InboundMessages',
  jersey_request: 'JerseyRequests',
  return_request: 'ReturnRequests',
  line_personalisation: 'LinePersonalisations',
}

const cutoff = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)

export default async function retentionJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const catalog: any = container.resolve(CATALOG_MODULE)
  const apply = process.env.PRIVACY_RETENTION_APPLY === 'true'

  const report: { store: string; due: number; action: string }[] = []

  for (const [table, stem] of Object.entries(CATALOG_STORES)) {
    const store = DATA_STORES.find((s) => s.table === table)
    if (!store?.retentionDays) continue

    const before = cutoff(store.retentionDays)
    const due = await catalog[`list${stem}`](
      { created_at: { $lt: before } }, { select: ['id'], take: 10000 }
    ).catch(() => [])

    if (!due.length) { report.push({ store: table, due: 0, action: store.erasure }); continue }

    if (apply) {
      if (store.erasure === 'delete') {
        await catalog[`delete${stem}`](due.map((r: any) => r.id))
      } else if (store.erasure === 'anonymise') {
        /**
         * Anonymise the fields the register names, not the row.
         *
         * A return request past seven years keeps its decision and loses its address; a
         * personalisation past two keeps the fact that something was printed and loses what.
         * Deleting these rows instead would take the commercial record with them, which is
         * the opposite of what the retention period is for.
         */
        await catalog[`update${stem}`](due.map((r: any) => ({
          id: r.id,
          ...(store.fields.includes('email') ? { email: ANONYMISED } : {}),
          ...(store.fields.includes('comment') ? { comment: null } : {}),
          ...(store.fields.includes('value') ? { value: ANONYMISED } : {}),
          ...(store.fields.includes('approved_preview') ? { approved_preview: null } : {}),
        })))
      }
    }
    report.push({ store: table, due: due.length, action: store.erasure })
  }

  const total = report.reduce((n, r) => n + r.due, 0)

  logger.info(
    [
      '',
      `  ┌─ RETENTION ${apply ? 'APPLIED' : 'DRY RUN'} ─────────────────────────────────`,
      ...report.map((r) =>
        `  │ ${r.store.padEnd(22)} ${String(r.due).padStart(6)} past retention  (${r.action})`),
      '  │',
      `  │ ${total} row(s) ${apply ? 'processed' : 'would be processed'}`,
      ...(apply ? [] : ['  │ set PRIVACY_RETENTION_APPLY=true to act on this']),
      ...(UNRESOLVED.length
        ? ['  │',
           `  │ no retention period set: ${UNRESOLVED.map((s) => s.table).join(', ')}`,
           '  │ these are kept indefinitely — a business decision, not an engineering one']
        : []),
      '  └──────────────────────────────────────────────────────────',
      '',
    ].join('\n')
  )

  return { apply, total, report }
}

export const config = {
  name: 'privacy-retention',
  // 03:20, nightly. Off the hour because everything else in the world runs on it.
  schedule: '20 3 * * *',
}
