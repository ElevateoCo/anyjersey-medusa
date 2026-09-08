import { getStoreReviews } from '@/lib/medusa'

/**
 * The store's own reviews: 84 from eBay, Depop and Facebook Marketplace, averaging 4.94.
 *
 * Two rules, both from research.md §7.10 and §12.7:
 *
 *  1. **The number and the cards are the same set.** The aggregate is computed by the
 *     endpoint over every row it holds, and the cards are a sample of those rows. A headline
 *     figure sourced from somewhere other than the reviews under it is the defect the
 *     Omnibus provisions are aimed at.
 *  2. **Origin is disclosed where the reviews are read**, not in a footnote nobody reaches.
 *     These are reviews of eBay and Depop transactions from before this shop opened. Shown
 *     as written; described as what they are.
 *
 * A server component, so the aggregate is in the initial HTML and no layout shift follows.
 * Renders nothing at all if there are no reviews — an empty "0 reviews, ★★★★★" block is
 * worse than the absence of one.
 */
export default async function StoreReviews({ limit = 6 }: { limit?: number }) {
  const data = await getStoreReviews(limit)
  if (!data || data.count === 0 || data.average == null) return null

  return (
    <section className="band storerev" id="store-reviews">
      <div className="wrap">
        <div className="srbar">
          <strong>{data.average.toFixed(1)}</strong>
          <span className="stars" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={i <= Math.round(data.average!) ? 'on' : ''}>★</span>
            ))}
          </span>
          <span className="srcount">
            {data.average.toFixed(1)} out of 5, from{' '}
            {data.count.toLocaleString()} review{data.count === 1 ? '' : 's'}
          </span>
        </div>

        <ul className="srcards">
          {data.reviews.map((r) => (
            <li key={r.id}>
              <span className="stars small" aria-label={`${r.rating} out of 5`}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className={i <= Math.round(r.rating) ? 'on' : ''}
                        aria-hidden="true">★</span>
                ))}
              </span>
              {r.title && <p className="srtitle">{r.title}</p>}
              <p className="srbody">{r.body}</p>
              <p className="srwho">
                {r.author}
                <span className="viasrc">via {r.source}</span>
              </p>
            </li>
          ))}
        </ul>

        {/* The disclosure travels with the data from the API, so any surface that renders
            these carries it. */}
        <p className="note srnote">{data.disclosure}</p>
      </div>
    </section>
  )
}
