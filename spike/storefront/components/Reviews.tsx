'use client'
import { useEffect, useState } from 'react'

/**
 * Reviews on the product page — replacing the hardcoded "4.9/5" placeholder, which was
 * the last obviously fake thing on the page.
 *
 * The aggregate is computed from the same approved set that is listed below it, so the
 * number and the reviews can never disagree. That mismatch is exactly what the Omnibus
 * review provisions target: the reference store shows 137,135 reviews on its homepage and
 * 8,342 on its product page.
 */
type Review = {
  id: string; rating: number; title: string | null; body: string; author: string
  verified_purchase: boolean; fit_feedback: string | null; created_at: string
  /** Where the review was left. Disclosed on the card itself, per §7.10. */
  source: string
  /** False for the reviews carried over from eBay, Depop and Facebook Marketplace. */
  first_party: boolean
}
type Payload = {
  count: number; average: number | null; verified_count: number; imported_count: number
  histogram: { stars: number; count: number }[]
  fit: { votes: number; small: number; true: number; large: number } | null
  reviews: Review[]
  verification_note: string
}

const Stars = ({ n }: { n: number }) => (
  <span className="stars" aria-label={`${n} out of 5`}>
    {[1, 2, 3, 4, 5].map((i) => (
      <span key={i} className={i <= Math.round(n) ? 'on' : ''} aria-hidden="true">★</span>
    ))}
  </span>
)

export default function Reviews({ productId }: { productId: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [writing, setWriting] = useState(false)
  const [form, setForm] = useState({
    rating: '5', body: '', author_name: '', email: '', fit_feedback: '',
  })
  const [state, setState] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  const load = () => {
    fetch(`${process.env.NEXT_PUBLIC_MEDUSA_URL}/store/reviews?product_id=${productId}`, {
      headers: { 'x-publishable-api-key': process.env.NEXT_PUBLIC_MEDUSA_PK ?? '' },
    }).then((r) => r.json()).then(setData).catch(() => setData(null))
  }
  useEffect(load, [productId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('sending')
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_MEDUSA_URL}/store/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-publishable-api-key': process.env.NEXT_PUBLIC_MEDUSA_PK ?? '',
        },
        body: JSON.stringify({ ...form, product_id: productId, rating: Number(form.rating) }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.message ?? 'Could not submit.')
      setState('ok')
      setMsg(body.message ?? 'Thanks.')
    } catch (err: unknown) {
      setState('err')
      setMsg(err instanceof Error ? err.message : 'Could not submit.')
    }
  }

  const fitLabel = () => {
    if (!data?.fit || data.fit.votes < 3) return null
    const { small, true: tru, large, votes } = data.fit
    const top = Math.max(small, tru, large)
    const pct = Math.round((top / votes) * 100)
    if (top === tru) return `${pct}% say true to size`
    if (top === small) return `${pct}% say it runs small`
    return `${pct}% say it runs large`
  }

  return (
    <section className="reviews">
      <h2>Reviews</h2>

      {!data || data.count === 0 ? (
        <p className="reviews-none">
          No reviews yet.{' '}
          <button className="linkish" onClick={() => setWriting(true)}>
            Be the first
          </button>
          .
        </p>
      ) : (
        <>
          <div className="reviews-head">
            <div className="reviews-agg">
              <strong>{data.average?.toFixed(1)}</strong>
              <Stars n={data.average ?? 0} />
              <span className="n">
                {data.count} review{data.count === 1 ? '' : 's'}
                {data.verified_count > 0 && <> · {data.verified_count} verified</>}
                {data.imported_count > 0 && <> · {data.imported_count} from marketplaces</>}
              </span>
            </div>
            {/* Fit is the biggest objection in apparel, and the one image makes it worse */}
            {fitLabel() && <p className="fitline">{fitLabel()}</p>}
          </div>

          <ul className="reviewlist">
            {data.reviews.map((r) => (
              <li key={r.id}>
                <div className="rhead">
                  <Stars n={r.rating} />
                  <strong>{r.author}</strong>
                  {r.verified_purchase && (
                    <span className="verified" title="This email has an order containing this product">
                      Verified purchase
                    </span>
                  )}
                  {/* Origin on the card, not only in the footnote. A buyer reading one
                      review has to be able to see where it came from — and an eBay review
                      is not a review of this checkout. */}
                  {!r.first_party && (
                    <span className="viasrc" title="Left on another marketplace before this shop opened">
                      via {r.source}
                    </span>
                  )}
                </div>
                {r.title && <p className="rtitle">{r.title}</p>}
                <p className="rbody">{r.body}</p>
                {r.fit_feedback && (
                  <p className="rfit">
                    Fit: {r.fit_feedback === 'true' ? 'true to size'
                      : r.fit_feedback === 'small' ? 'runs small' : 'runs large'}
                  </p>
                )}
              </li>
            ))}
          </ul>

          <p className="reviews-note">{data.verification_note}</p>
        </>
      )}

      {state === 'ok' ? (
        <p className="notify done" role="status">{msg}</p>
      ) : writing ? (
        <form className="reviewform" onSubmit={submit}>
          <h3>Write a review</h3>
          <div className="rf-row">
            <span>
              <label htmlFor="rv-rating">Rating</label>
              <select id="rv-rating" value={form.rating}
                      onChange={(e) => setForm({ ...form, rating: e.target.value })}>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}
              </select>
            </span>
            <span>
              <label htmlFor="rv-fit">How did it fit?</label>
              <select id="rv-fit" value={form.fit_feedback}
                      onChange={(e) => setForm({ ...form, fit_feedback: e.target.value })}>
                <option value="">Prefer not to say</option>
                <option value="small">Runs small</option>
                <option value="true">True to size</option>
                <option value="large">Runs large</option>
              </select>
            </span>
          </div>
          <label htmlFor="rv-body">Your review</label>
          <textarea id="rv-body" rows={4} required value={form.body}
                    onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <div className="rf-row">
            <span>
              <label htmlFor="rv-name">Name shown</label>
              <input id="rv-name" required value={form.author_name}
                     onChange={(e) => setForm({ ...form, author_name: e.target.value })} />
            </span>
            <span>
              <label htmlFor="rv-email">Email (not published)</label>
              <input id="rv-email" type="email" required value={form.email}
                     onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </span>
          </div>
          {state === 'err' && <p className="rmsg err" role="alert" style={{ color: '#B3261E' }}>{msg}</p>}
          <button className="btn" type="submit" disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Submit review'}
          </button>
          <p className="reviews-note">
            Your email is used to check whether you bought this product, and is never
            published. Reviews are checked for spam and abuse only.
          </p>
        </form>
      ) : (
        data && data.count > 0 && (
          <button className="btn ghost dark" onClick={() => setWriting(true)}>
            Write a review
          </button>
        )
      )}
    </section>
  )
}
