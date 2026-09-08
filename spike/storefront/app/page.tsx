import { getFacets, listJerseys } from '@/lib/medusa'
import ProductCard from '@/components/ProductCard'
import RequestBlock from '@/components/RequestBlock'
import SearchBox from '@/components/SearchBox'
import StoreReviews from '@/components/StoreReviews'
import { abs } from '@/lib/site'
import { Suspense } from 'react'

export const revalidate = 300

export const metadata = {
  alternates: { canonical: abs('/') },
}

/** Homepage per research.md §12.8 — AnyJersey's proposition, Glowfare's structure. */
export default async function Home() {
  const [facets, nfl, soccer, custom] = await Promise.all([
    getFacets(),
    listJerseys({ league: 'NFL', limit: 6 }),
    listJerseys({ league: 'SOCCER', limit: 6 }),
    listJerseys({ custom: 'true', limit: 6 }),
  ])
  const topTeams = facets.teams.slice(0, 12)

  return (
    <>
      <section className="hero">
        <div className="wrap">
          <h1>Find <em>any</em> jersey</h1>
          <p>Hard-to-find jerseys shipped on-demand. {facets.total.toLocaleString()} in
             the catalog &mdash; and if it isn&rsquo;t here, we&rsquo;ll source it.</p>
          <Suspense fallback={null}><SearchBox /></Suspense>
          <p style={{ marginTop: '1.25rem' }}>
            <a className="btn" href="/jerseys">Shop all jerseys</a>{' '}
            <a className="btn ghost" href="/request">Request a jersey</a>
          </p>
        </div>
      </section>

      <div className="trust">
        <div className="wrap">
          <ul>
            <li><strong>Tracked shipping</strong><span>Every order gets tracking</span></li>
            <li><strong>Trusted by fans</strong><span>Jerseys sourced with care</span></li>
            <li><strong>Secure checkout</strong><span>Stripe, 3-D Secure</span></li>
            <li><strong>Rare jerseys</strong><span>Sold out or custom? We&rsquo;ll find it</span></li>
          </ul>
        </div>
      </div>

      {/* Facets are the navigation for a 3,591-product catalog — §13.3 */}
      <section className="band">
        <div className="wrap">
          <div className="sechead">
            <h2>Shop by league</h2>
            <a href="/jerseys">All {facets.total.toLocaleString()} jerseys</a>
          </div>
          <div className="chips">
            {facets.leagues.map((l) => (
              <a key={l.value} className="chip" href={`/jerseys?league=${encodeURIComponent(l.value)}`}>
                {l.value} <span className="n">{l.count}</span>
              </a>
            ))}
          </div>
          <div className="sechead" style={{ marginTop: '2rem' }}>
            <h2>Shop by team</h2>
          </div>
          <div className="chips">
            {topTeams.map((t) => (
              <a key={t.value} className="chip" href={`/jerseys?team=${encodeURIComponent(t.value)}`}>
                {t.value} <span className="n">{t.count}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Above the league rails: it is the highest-margin thing on the site ($89.99 against
          a $65.99 base) and the one product a competitor cannot copy from a supplier list. */}
      {custom.products.length > 0 && (
        <section className="band customband">
          <div className="wrap">
            <div className="sechead">
              <h2>Custom jerseys</h2>
              <a href="/jerseys?custom=true">See all {custom.count}</a>
            </div>
            <p className="customlede">
              Your name. Your number. Printing included &mdash; not an extra.
            </p>
            <div className="grid">
              {custom.products.map((p) => <ProductCard key={p.id} p={p} />)}
            </div>
          </div>
        </section>
      )}

      <section className="band">
        <div className="wrap">
          <div className="sechead">
            <h2>NFL</h2>
            <a href="/jerseys?league=NFL">See all {facets.leagues.find(l => l.value === 'NFL')?.count}</a>
          </div>
          <div className="grid">{nfl.products.map((p) => <ProductCard key={p.id} p={p} />)}</div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="sechead">
            <h2>Soccer</h2>
            <a href="/jerseys?league=SOCCER">See all {facets.leagues.find(l => l.value === 'SOCCER')?.count}</a>
          </div>
          <div className="grid">{soccer.products.map((p) => <ProductCard key={p.id} p={p} />)}</div>
        </div>
      </section>

      {/* Real reviews, real aggregate — the 84 carried over from eBay, Depop and Facebook
          Marketplace. Store scope only: this number never appears on a product page as that
          product's rating, which is the §12.7 defect. */}
      <StoreReviews limit={6} />

      <section className="band">
        <div className="wrap">
          <div className="todo">
            <b>Not built yet — blocked on one supplier input</b>
            Personalisation teaser with a live preview for the homepage. The preview itself is
            built and live on every product page; what is missing is the supplier&rsquo;s
            print-file format (personalisation-spec.md §6), and a teaser that cannot lead to a
            finished order is not worth the space yet.
          </div>
        </div>
      </section>

      <RequestBlock source="homepage" />
    </>
  )
}
