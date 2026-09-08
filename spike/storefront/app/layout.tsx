import type { Metadata } from 'next'
import { Inter, Oswald } from 'next/font/google'
import './globals.css'
import { getCart, getZone } from '@/lib/cart'
import { getCollections, getRegions, getStoreReviews } from '@/lib/medusa'
import { getRegionId, regionBlocked } from '@/lib/region'
import { getCustomer } from '@/lib/account'
import { CONTENT_PAGES, LEGAL_PAGES } from '@/lib/content'
import { POLICIES } from '@/lib/policies'
import { INDEXABLE, SITE_NAME, SITE_TAGLINE, SITE_URL, euBlocked } from '@/lib/site'
import { organisation, website } from '@/lib/seo'
import CartButton from '@/components/CartButton'
import ConsentBanner from '@/components/ConsentBanner'
import Analytics from '@/components/Analytics'
import SearchBox from '@/components/SearchBox'
import JsonLd from '@/components/JsonLd'
import Newsletter from '@/components/Newsletter'
import RegionPicker, { type RegionOption } from '@/components/RegionPicker'
import PaymentMethods from '@/components/PaymentMethods'
import TraderIdentity from '@/components/TraderIdentity'
import { Suspense } from 'react'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const oswald = Oswald({ subsets: ['latin'], weight: ['500', '600', '700'],
  variable: '--font-oswald', display: 'swap' })

/**
 * `metadataBase` is what makes every relative `openGraph` and canonical URL resolve to an
 * absolute one. Without it Next emits relative OG tags, which crawlers and link unfurlers
 * simply drop — the tags are present in the HTML and do nothing, which is the worst kind of
 * missing.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: `${SITE_TAGLINE}. Can't find yours? Request it.`,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: `${SITE_TAGLINE}. Can't find yours? Request it.`,
    url: SITE_URL,
  },
  twitter: { card: 'summary_large_image' },
  // Belt and braces with robots.txt: a crawl-level rule cannot deindex a URL that was
  // reached from an external link, and a staging deployment is exactly where that happens.
  robots: INDEXABLE ? undefined : { index: false, follow: false },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [cart, zone, regions, regionId, customer, collections, reviews] = await Promise.all([
    getCart(),
    getZone(),
    getRegions(),
    getRegionId(),
    getCustomer(),
    getCollections(),
    // Store scope, and only ever store scope. The aggregate below is the shop's rating and
    // is never rendered on a product page as that product's rating — that conflation is the
    // §12.7 defect, and putting the number in a shared layout is exactly how it happens by
    // accident. `limit: 1` because the footer wants the counts, not the cards.
    getStoreReviews(1),
  ])

  const count = (cart?.items ?? []).reduce((n, l) => n + l.quantity, 0)
  const cartData = {
    items: (cart?.items ?? []).map((l) => ({
      id: l.id, title: l.title, quantity: l.quantity, subtotal: l.subtotal,
      thumbnail: l.thumbnail,
      variant: l.variant ? {
        title: l.variant.title, sku: l.variant.sku,
        product: l.variant.product ? { handle: l.variant.product.handle } : undefined,
      } : null,
    })),
    subtotal: cart?.subtotal ?? 0,
    zone: zone ? { name: zone.name, rate: zone.rate, freeOver: zone.freeOver } : null,
  }

  // Plain data only. `lib/region.ts` reads cookies, so handing a client component anything
  // from it would pull `next/headers` into the browser bundle — the RSC-boundary mistake
  // this codebase has made twice and now has a test for.
  const gates = euBlocked().length
  const regionOptions: RegionOption[] = regions.map((r) => ({
    id: r.id,
    name: r.name,
    currency: r.currency_code.toUpperCase(),
    blocked: regionBlocked(r, gates),
  }))

  return (
    <html lang="en">
      <body className={`${inter.variable} ${oswald.variable}`}
            style={{ ['--sans' as string]: 'var(--font-inter)',
                     ['--display' as string]: 'var(--font-oswald)' }}>
        <JsonLd data={[organisation(), website()]} />
        <a className="skip" href="#main">Skip to content</a>

        {/* AnyJersey's proposition, unchanged — research.md §12.1 */}
        <div className="announce">
          Can&rsquo;t find your jersey? <a href="/request"><strong>Request it</strong></a> &mdash;
          we&rsquo;ll source it for you fast
        </div>

        <header className="site">
          <div className="wrap hrow">
            <a href="/" className="logo">Find <em>Any</em> Jersey</a>
            <Suspense fallback={<div className="search compact" />}>
              <SearchBox compact />
            </Suspense>
            <nav className="main" aria-label="Main">
              <a href="/jerseys">All Jerseys</a>
              {/* Editorial, not a facet: no property of a product says "best seller", so
                  it cannot be derived and has to be curated. */}
              {collections.some((c) => c.handle === 'best-sellers') && (
                <a href="/collections/best-sellers">Best Sellers</a>
              )}
              <a href="/jerseys?league=NFL">NFL</a>
              <a href="/jerseys?league=SOCCER">Soccer</a>
              {/* Its own entry, not a filter buried in the sidebar: it is a different
                  product — a blank you put your own name on — at a different price. */}
              <a href="/jerseys?custom=true" className="navcustom">Custom</a>
              {/* MLB and NBA were here too. Eleven items wrapped the bar onto two rows at
                  1360px, and every league is one click away in the listing sidebar and in
                  the "Shop by league" chips on the homepage — whereas Best Sellers and
                  Custom are reachable from nowhere else. */}
              <a href="/request">Request a Jersey</a>
              <a href="/track">Track Order</a>
              <a href={customer ? '/account' : '/account/login'}>
                {customer ? 'Account' : 'Sign in'}
              </a>
              <CartButton count={count} data={cartData} />
            </nav>
          </div>
        </header>

        <main id="main">{children}</main>

        <ConsentBanner />
        <Analytics />

        <footer className="site">
          <div className="wrap">
            <Newsletter />
            <div className="cols">
              <div>
                <h2 className="display">Shop</h2>
                <ul>
                  <li><a href="/jerseys">All jerseys</a></li>
                  <li><a href="/jerseys?custom=true">Custom jerseys</a></li>
                  {/* The curated lists sit above the facet links, because they are the ones
                      somebody chose to put there. */}
                  {collections.slice(0, 4).map((c) => (
                    <li key={c.handle}>
                      <a href={`/collections/${c.handle}`}>{c.title}</a>
                    </li>
                  ))}
                  <li><a href="/jerseys?league=NFL">NFL</a></li>
                  <li><a href="/jerseys?league=SOCCER">Soccer</a></li>
                </ul>
              </div>
              <div>
                <h2 className="display">Help</h2>
                <ul>
                  <li><a href="/request">Request a jersey</a></li>
                  <li><a href="/track">Track your order</a></li>
                  {/* These three were dead text. Every one of them is a page a customer
                      needs before buying, not after. */}
                  {CONTENT_PAGES.map((c) => (
                    <li key={c.path}><a href={c.path}>{c.title}</a></li>
                  ))}
                </ul>
              </div>
              <div>
                <h2 className="display">Account</h2>
                <ul>
                  {customer ? (
                    <>
                      <li><a href="/account">Your account</a></li>
                      <li><a href="/returns">Start a return</a></li>
                    </>
                  ) : (
                    <>
                      <li><a href="/account/login">Sign in</a></li>
                      <li><a href="/account/register">Create an account</a></li>
                      <li><a href="/returns">Start a return</a></li>
                    </>
                  )}
                </ul>
              </div>
              <div>
                <h2 className="display">Legal</h2>
                <ul>
                  {POLICIES.map((p) => (
                    <li key={p.slug}>
                      <a href={`/policies/${p.slug}`}>{p.title}</a>
                    </li>
                  ))}
                  {LEGAL_PAGES.map((p) => (
                    <li key={p.path}><a href={p.path}>{p.title}</a></li>
                  ))}
                </ul>
              </div>
            </div>
            <PaymentMethods />

            <div className="base">
              <RegionPicker regions={regionOptions} current={regionId} />
              <span>
                Prices in {(regions.find((r) => r.id === regionId)?.currency_code ?? 'usd')
                  .toUpperCase()}
              </span>
              {/* Rendered only when there is something real to count. An empty
                  "0 reviews ★★★★★" is worse than no rating at all, and the origin note
                  travels with the number rather than sitting on a page nobody opens. */}
              {reviews && reviews.count > 0 && reviews.average != null && (
                <span className="footrating">
                  <span className="stars" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <span key={i} className={i <= Math.round(reviews.average!) ? 'on' : ''}>
                        ★
                      </span>
                    ))}
                  </span>
                  <a href="/#store-reviews">
                    {reviews.average.toFixed(2)} from {reviews.count.toLocaleString()}{' '}
                    review{reviews.count === 1 ? '' : 's'}
                  </a>
                  <span className="footratingnote">
                    left on eBay, Depop and Facebook Marketplace before this shop opened
                  </span>
                </span>
              )}
            </div>

            <TraderIdentity />
          </div>
        </footer>
      </body>
    </html>
  )
}
