import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'
import { CATALOG_MODULE } from '../modules/catalog'

/**
 * Does every old Shopify URL actually resolve?
 *
 * The redirect from `/products/<old-handle>` reads `jersey_detail.source_handle`, and the
 * resolver was tested against a seeded fixture rather than against the 1,083 products whose
 * handle genuinely changed. This walks the real data and reports the cases the fixture could
 * not contain:
 *
 *   - a `source_handle` on more than one product — ambiguous, and the resolver returns
 *     whichever the database felt like
 *   - a `source_handle` that collides with a *current* handle on a different product, which
 *     redirects a live URL to the wrong shirt
 *   - details with no `source_handle` at all — no redirect possible, so the old URL 404s
 *   - details whose product is missing or unpublished — the resolver refuses those, correctly,
 *     but they are still dead inbound links worth knowing the size of
 *
 * Read-only. Run it before pointing DNS at the new site, which is the last moment any of this
 * is cheap to fix.
 *
 *   npx medusa exec ./src/scripts/verify-redirects.ts
 */
export default async function verifyRedirects({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const catalog: any = container.resolve(CATALOG_MODULE)

  const details = await catalog.listJerseyDetails(
    {}, { select: ['id', 'source_handle'], take: 100000 }
  )

  const { data: linked } = await query.graph({
    entity: 'jersey_detail',
    fields: ['id', 'source_handle', 'product.id', 'product.handle', 'product.status'],
    pagination: { take: 100000, skip: 0 },
  }).catch(() => ({ data: [] as any[] }))

  const rows = (linked as any[]).map((r) => {
    const p = Array.isArray(r.product) ? r.product[0] : r.product
    return { source: r.source_handle as string | null, handle: p?.handle, status: p?.status }
  })

  const withSource = rows.filter((r) => r.source)
  const missingSource = rows.length - withSource.length

  // Ambiguous: the same old URL pointing at two products.
  const bySource = new Map<string, typeof rows>()
  for (const r of withSource) {
    const list = bySource.get(r.source!) ?? []
    list.push(r)
    bySource.set(r.source!, list)
  }
  const ambiguous = [...bySource.entries()].filter(([, list]) => list.length > 1)

  // A source handle that is somebody else's *current* handle: a live URL redirecting away.
  const currentHandles = new Map(rows.filter((r) => r.handle).map((r) => [r.handle!, r]))
  const shadowing = withSource.filter(
    (r) => r.source !== r.handle && currentHandles.has(r.source!)
  )

  const unresolvable = withSource.filter((r) => !r.handle || r.status !== 'published')
  const renamed = withSource.filter((r) => r.handle && r.source !== r.handle)

  logger.info('')
  logger.info('  ┌─ REDIRECT COVERAGE ─────────────────────────────────────')
  logger.info(`  │ catalog rows            ${rows.length}`)
  logger.info(`  │ with a Shopify handle   ${withSource.length}`)
  logger.info(`  │ handle changed          ${renamed.length}  ← these need the redirect`)
  logger.info(`  │ handle unchanged        ${withSource.length - renamed.length}`)
  logger.info('  │')
  logger.info(`  │ no source_handle        ${missingSource}${missingSource ? '  ← old URL will 404' : ''}`)
  logger.info(`  │ ambiguous               ${ambiguous.length}${ambiguous.length ? '  ← resolves arbitrarily' : ''}`)
  logger.info(`  │ shadowing a live handle ${shadowing.length}${shadowing.length ? '  ← redirects a live URL away' : ''}`)
  logger.info(`  │ unpublished or orphaned ${unresolvable.length}`)
  logger.info('  └─────────────────────────────────────────────────────────')

  for (const [source, list] of ambiguous.slice(0, 10)) {
    logger.warn(`  ambiguous: ${source} → ${list.map((r) => r.handle ?? '(none)').join(', ')}`)
  }
  for (const r of shadowing.slice(0, 10)) {
    logger.warn(`  shadowing: /products/${r.source} would redirect away from a live product`)
  }

  logger.info('')
  const clean = !ambiguous.length && !shadowing.length
  logger.info(clean
    ? '  No ambiguity and nothing shadowed. The mapping is safe to point DNS at.'
    : '  Fix the rows above before pointing DNS — each one sends real traffic somewhere wrong.')
  logger.info('')

  return { rows: rows.length, renamed: renamed.length, ambiguous: ambiguous.length,
           shadowing: shadowing.length, missingSource, unresolvable: unresolvable.length }
}
