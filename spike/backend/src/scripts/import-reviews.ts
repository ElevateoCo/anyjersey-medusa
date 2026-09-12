import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { CATALOG_MODULE } from '../modules/catalog'
import { __resetCache as resetStoreReviewCache } from '../api/store/store-reviews/route'

/**
 * Import the marketplace reviews from the 2026-08-18 Judge.me export.
 *
 *   npx medusa exec ./src/scripts/import-reviews.ts
 *   REVIEWS_JSON=/path/to/store_reviews.metafield.json npx medusa exec ./src/scripts/import-reviews.ts
 *
 * The export holds 84 published reviews averaging 4.94. Two things about it decide the whole
 * design of this script:
 *
 * **Only the published set exists here.** The same export contains 93 unpublished rows that
 * Judge.me had already flagged as spam — 54 of them 1-star "never received it" complaints and
 * repeat submissions. None was ever visible on anyjersey.com. There is deliberately no flag on
 * this script that would import them: a wall of delivery complaints about a different
 * marketplace, on a store that has not shipped an order, is not "more data".
 *
 * **45 of the 84 name an exact product title; 39 name nothing.** Matching is by exact
 * normalised title and by nothing else. A fuzzy match would attach a five-star review to the
 * wrong shirt, and on a catalog where titles differ by a single word — "Thanksgiving" versus
 * "Throwback" on the same player — that is not hypothetical. Anything that does not match
 * exactly is stored unmatched, which is a true statement about the data rather than a failure.
 *
 * Idempotent through a fingerprint over the source row, so a second run inserts nothing.
 */
/**
 * The reviews export, from the environment.
 *
 * Same reasoning as `ingest-media.ts`: `~/Downloads` is privacy-gated on macOS and a path
 * into it is a dependency on one machine's permissions. This one never blocked a build —
 * it is a string in a script, inert until the script runs — but it fails the same way for
 * the next person, and the fix is one variable.
 *
 * The 84 reviews it imported are already in the database. Set `REVIEWS_JSON` to re-run
 * it; unset, the read below fails with the path it was given, which is an empty string and
 * reads as such.
 */
const DEFAULT_JSON = ''

type SourceReview = {
  name: string
  title: string
  body: string
  rating: string | number
  date: string
  source: string
  item?: string
}

/**
 * Title normalisation for matching.
 *
 * Accents folded (the catalog holds "Dončić"), punctuation dropped, whitespace collapsed,
 * lowercased. Deliberately *not* stemmed or tokenised: the point is an exact match on the
 * same string written two ways, not a similarity score.
 */
const normalise = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const fingerprint = (r: SourceReview) =>
  createHash('sha256')
    .update([r.name, r.title, r.body, String(r.rating), r.date, r.source].join(' '))
    .digest('hex')
    .slice(0, 32)

export default async function importReviews({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const catalog: any = container.resolve(CATALOG_MODULE)

  const path = process.env.REVIEWS_JSON || DEFAULT_JSON
  let payload: { count?: number; average?: number; reviews: SourceReview[] }
  try {
    payload = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    logger.error(
      `Could not read ${path}. Pass REVIEWS_JSON=<file>. ` +
        (e instanceof Error ? e.message : String(e))
    )
    return
  }

  const rows = payload.reviews ?? []
  if (!rows.length) {
    logger.warn('No reviews in that file — nothing to do.')
    return
  }

  // Every published product title, normalised. One query, then matching in memory: 3,155
  // titles is nothing, and a query per review would be 84 round trips.
  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'title'],
    filters: { status: 'published' },
    pagination: { take: 100000, skip: 0 },
  })

  const byTitle = new Map<string, string[]>()
  for (const p of products as any[]) {
    if (!p.title) continue
    const key = normalise(p.title)
    byTitle.set(key, [...(byTitle.get(key) ?? []), p.id])
  }

  const existing = await catalog.listStoreReviews({}, { select: ['fingerprint'], take: 100000 })
  const seen = new Set((existing as any[]).map((r) => r.fingerprint))

  const toCreate: Record<string, unknown>[] = []
  const report = {
    total: rows.length,
    skipped: 0,
    matched: 0,
    unmatched: 0,
    ambiguous: 0,
    noItem: 0,
    badRating: 0,
  }

  for (const r of rows) {
    const fp = fingerprint(r)
    if (seen.has(fp)) {
      report.skipped++
      continue
    }

    const rating = Number(r.rating)
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      // Never coerce a rating. A default would invent an opinion.
      report.badRating++
      continue
    }

    const item = String(r.item ?? '').trim()
    let productId: string | null = null
    let method: 'exact_title' | 'unmatched' = 'unmatched'

    if (!item) {
      report.noItem++
    } else {
      const candidates = byTitle.get(normalise(item)) ?? []
      if (candidates.length === 1) {
        productId = candidates[0]
        method = 'exact_title'
        report.matched++
      } else if (candidates.length > 1) {
        // Two live products with the same title. Picking one would put the review on a coin
        // toss; the duplicate-merge script (Step 10) is the right place to fix that.
        report.ambiguous++
      } else {
        report.unmatched++
      }
    }

    const parsed = new Date(`${r.date}T12:00:00Z`)
    toCreate.push({
      product_id: productId,
      source_item: item || null,
      rating,
      title: String(r.title ?? '').trim() || null,
      body: String(r.body ?? '').trim(),
      author_name: String(r.name ?? '').trim() || 'Anonymous',
      source: String(r.source ?? '').trim() || 'Marketplace',
      reviewed_at: Number.isNaN(parsed.getTime()) ? new Date() : parsed,
      match_method: method,
      fingerprint: fp,
    })
    seen.add(fp)
  }

  if (toCreate.length) {
    await catalog.createStoreReviews(toCreate)
    // The aggregate endpoint caches for ten minutes. This used to be a variable in that
    // route's module scope, so clearing it from `medusa exec` — a different process —
    // did nothing, and a freshly imported corpus stayed invisible for up to ten minutes
    // while the operator reasonably concluded the import had failed. The cache is now
    // Medusa's cache module, so with REDIS_URL set this invalidation reaches the running
    // server. Without Redis it is still process-local and still a no-op from here.
    await resetStoreReviewCache(container)
  }

  const avg = toCreate.length
    ? Math.round(
        (toCreate.reduce((n, r) => n + (r.rating as number), 0) / toCreate.length) * 100
      ) / 100
    : 0

  logger.info(
    `Reviews imported: ${toCreate.length} new, ${report.skipped} already present. ` +
      `Attached to a product: ${report.matched}. ` +
      `No product named: ${report.noItem}. ` +
      `Named a product we do not stock: ${report.unmatched}. ` +
      `Ambiguous title: ${report.ambiguous}. ` +
      `Rejected rating: ${report.badRating}. ` +
      `Average of the new rows: ${avg}.`
  )

  if (toCreate.length) {
    logger.info(
      'Note: /store/store-reviews caches its aggregate for 10 minutes. This script runs in ' +
      'its own process, so a running server will keep serving the old count until that ' +
      'expires or it is restarted. Not a failed import.'
    )
  }

  if (payload.average && toCreate.length === report.total) {
    // The export carries the aggregate Judge.me cached on the live store. If ours disagrees,
    // the import dropped or altered something, and that is worth saying loudly.
    const claimed = Math.round(payload.average * 100) / 100
    if (Math.abs(claimed - avg) > 0.01) {
      logger.error(
        `Average mismatch: the export claims ${claimed}, the imported rows average ${avg}. ` +
          'Something was dropped — do not publish these until it is explained.'
      )
    } else {
      logger.info(`Average matches the export's own aggregate (${claimed}).`)
    }
  }
}
