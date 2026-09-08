import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../modules/catalog'
import { limited } from '../../../rate-limit'

/**
 * GET  /store/reviews?product_id=…   approved reviews + aggregate
 * POST /store/reviews                submit one (lands pending)
 *
 * Only approved reviews are ever returned, and the aggregate is computed from the same
 * set — so the number on the page and the reviews under it can never disagree. That
 * mismatch is exactly what the Omnibus review provisions are about: the reference store
 * shows 137,135 reviews on its homepage and 8,342 on its product page (§12.7).
 *
 * **Two provenances, one aggregate.** Reviews submitted on this store live in
 * `product_review`; the 84 carried over from eBay, Depop and Facebook Marketplace live in
 * `store_review`, of which 45 name an exact product title and are attached to a product.
 * Both are genuine reviews of the same shirt, so the count and average cover both — one
 * number for one scope is the rule §12.7 is about.
 *
 * What does *not* merge is the labelling. Every card carries its `source`, and only a
 * first-party review can be `verified_purchase`, because that flag is derived from this
 * store's own order history and an eBay order cannot be checked against it. Presenting an
 * imported marketplace review as a verified purchase here would be the exact claim the FTC
 * rule prohibits.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const productId = req.query.product_id as string | undefined
  if (!productId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'product_id is required')
  }

  const [firstParty, imported] = await Promise.all([
    catalog.listProductReviews(
      { product_id: productId, status: 'approved' },
      { take: 200, order: { created_at: 'DESC' } }
    ),
    catalog.listStoreReviews(
      { product_id: productId },
      { take: 200, order: { reviewed_at: 'DESC' } }
    ).catch(() => []),
  ])

  // Normalised to one shape so the aggregate is computed once over one list. Computing two
  // averages and presenting them together is how the numbers drift apart.
  const rows = [
    ...(firstParty as any[]).map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      author_name: r.author_name,
      // Only ever true on this side. See the note above.
      verified_purchase: !!r.verified_purchase,
      fit_feedback: r.fit_feedback,
      created_at: r.created_at,
      source: 'Find Any Jersey',
      first_party: true,
    })),
    ...(imported as any[]).map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      author_name: r.author_name,
      verified_purchase: false,
      fit_feedback: null,
      created_at: r.reviewed_at,
      source: r.source,
      first_party: false,
    })),
  ].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))

  const count = rows.length
  const average = count
    ? Math.round((rows.reduce((n: number, r: any) => n + r.rating, 0) / count) * 10) / 10
    : null

  const histogram = [5, 4, 3, 2, 1].map((stars) => ({
    stars, count: rows.filter((r: any) => Math.round(r.rating) === stars).length,
  }))

  const fitVotes = rows.filter((r: any) => r.fit_feedback)
  const fit = fitVotes.length
    ? {
        votes: fitVotes.length,
        small: fitVotes.filter((r: any) => r.fit_feedback === 'small').length,
        true: fitVotes.filter((r: any) => r.fit_feedback === 'true').length,
        large: fitVotes.filter((r: any) => r.fit_feedback === 'large').length,
      }
    : null

  res.json({
    product_id: productId,
    count,
    average,
    histogram,
    fit,
    verified_count: rows.filter((r: any) => r.verified_purchase).length,
    imported_count: rows.filter((r: any) => !r.first_party).length,
    reviews: rows.map((r: any) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      author: r.author_name,
      verified_purchase: r.verified_purchase,
      fit_feedback: r.fit_feedback,
      created_at: r.created_at,
      // Disclosed per review, not once at the foot of the page — §7.10 requires the origin
      // to be apparent where the review is read.
      source: r.source,
      first_party: r.first_party,
    })),
    // Omnibus requires disclosing whether and how reviews are verified.
    verification_note:
      'Reviews marked verified are from an email that has an order containing this ' +
      'product. Reviews are published after a check for spam and abuse only — never ' +
      'filtered by how positive they are. Reviews labelled with a marketplace name were ' +
      'left by buyers on eBay, Depop or Facebook Marketplace before this shop opened; ' +
      'they are shown as they were written and cannot be verified against orders here.',
  })
}

/**
 * POST /store/reviews
 *
 * A public write that publishes text on a product page, which makes it the most attractive
 * of the unauthenticated writers to a spammer.
 *
 * Ten a minute, matching `/store/jersey-requests`, rather than the tighter budget the other
 * two writers get. A customer who bought three shirts and sits down to review all of them
 * is a real person and must not be told to come back later, and the moderation queue —
 * nothing is published until it is approved — is the control that actually stops spam
 * appearing. This limit is here to stop the *write*, not the publication.
 */
const DUPLICATE = 'You have already reviewed this product.'

/**
 * Did this insert lose the race against the unique index?
 *
 * Three shapes, because the error is rewritten on its way up and which one arrives depends
 * on how deep the failure was caught:
 *
 *  1. the raw driver error, `code: '23505'`
 *  2. Postgres's own text, naming the constraint
 *  3. **Medusa's translation**, which is what actually arrives:
 *     `invalid_data` — *"Product review with product_id: …, email: …, already exists."*
 *
 * The third was found by the concurrency test rather than reasoned about. The first version
 * of this checked only for 23505 and the index name, so five simultaneous submissions each
 * got a bare 400 with an internal message quoting the product id — and the sequential path
 * next to it answered 409 for the same thing. Two answers for one rule.
 *
 * Deliberately narrow. It matches "already exists" only when the message names both columns
 * this rule is about, so a future unique constraint on this table cannot be silently
 * reported to a customer as "you have already reviewed this product".
 */
function isUniqueViolation(e: unknown): boolean {
  const seen = new Set<unknown>()
  let cur: any = e
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur)
    if (cur.code === '23505') return true

    const text = String(cur.message ?? '')
    if (/duplicate key value/i.test(text) &&
        /IDX_product_review_product_id_email_unique/.test(text)) {
      return true
    }
    if (/already exists/i.test(text) &&
        /product_id/i.test(text) && /email/i.test(text)) {
      return true
    }
    cur = cur.cause ?? cur.previous ?? cur.originalError
  }
  return false
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (await limited(req, res, 'reviews', 10, 60_000)) return

  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const body = (req.body ?? {}) as Record<string, unknown>

  const productId = String(body.product_id ?? '').trim()
  const rating = Number(body.rating)
  const text = String(body.body ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const author = String(body.author_name ?? '').trim()

  if (!productId) throw new MedusaError(MedusaError.Types.INVALID_DATA, 'product_id is required')
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'rating must be between 1 and 5')
  }
  if (text.length < 10) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'Tell us a little more — 10 characters minimum.')
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'A valid email is required.')
  }
  if (!author) throw new MedusaError(MedusaError.Types.INVALID_DATA, 'A name is required.')

  const fit = ['small', 'true', 'large'].includes(String(body.fit_feedback))
    ? String(body.fit_feedback)
    : null

  /**
   * One review per email per product.
   *
   * Checked here so the common case gets a sentence a person can act on rather than a
   * constraint violation — but the check is not what enforces the rule. A read followed by
   * a write is a race: two submissions arriving together both saw no row and both inserted.
   * `IDX_product_review_product_id_email_unique` is the enforcement; this is the message.
   * The insert below catches the violation and answers with the same 409, so the two paths
   * are indistinguishable to the caller.
   */
  const existing = await catalog.listProductReviews(
    { product_id: productId, email }, { take: 1 }
  )
  if (existing.length) return res.status(409).json({ message: DUPLICATE })

  /**
   * verified_purchase is DERIVED, never accepted from the client. A badge the submitter
   * can set is precisely what the FTC rule prohibits.
   */
  let verified = false
  let orderId: string | null = null
  try {
    const { data: orders } = await query.graph({
      entity: 'order',
      fields: ['id', 'email', 'version', 'items.product_id'],
      filters: { email } as any,
      pagination: { take: 50, skip: 0 },
    })
    const match = (orders as any[]).find((o) =>
      (o.items ?? []).some((i: any) => i.product_id === productId)
    )
    if (match) { verified = true; orderId = match.id }
  } catch {
    // If order lookup fails the review still lands — unverified. Never verified by default.
  }

  let created: any
  try {
    ;[created] = await catalog.createProductReviews([{
      product_id: productId,
      rating: Math.round(rating),
      title: String(body.title ?? '').trim() || null,
      body: text.slice(0, 2000),
      author_name: author.slice(0, 80),
      email,
      verified_purchase: verified,
      order_id: orderId,
      fit_feedback: fit,
      status: 'pending',
    }])
  } catch (e) {
    // The other half of the race. Whichever request loses lands here, and gets exactly the
    // answer the winner's duplicate would have got — the caller cannot tell which path
    // refused them, which is the point.
    if (isUniqueViolation(e)) {
      return res.status(409).json({ message: DUPLICATE })
    }
    throw e
  }

  res.status(201).json({
    id: created.id,
    status: created.status,
    verified_purchase: created.verified_purchase,
    message: 'Thanks — your review is queued for a spam and abuse check.',
  })
}
