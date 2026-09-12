import type { Metadata } from 'next'
import { Inter, Oswald } from 'next/font/google'
import './globals.css'
import { getCart, getZone } from '@/lib/cart'
import { getCollections, getFacets, getRegions, getStoreReviews } from '@/lib/medusa'
import { getRegionId, regionBlocked } from '@/lib/region'
import { getVisitorGeo } from '@/lib/geo'
import { getCustomer } from '@/lib/account'
import { CONTENT_PAGES, LEGAL_PAGES } from '@/lib/content'
import { POLICIES } from '@/lib/policies'
import {
  INDEXABLE, SITE_NAME, SITE_TAGLINE, SITE_URL, euBlocked, siteNameParts,
} from '@/lib/site'
import { organisation, website } from '@/lib/seo'
import CartButton from '@/components/CartButton'
import SiteNav, { NavAccordion } from '@/components/SiteNav'
import MobileNav from '@/components/MobileNav'
import SearchSheet from '@/components/SearchSheet'
import SearchHotkey from '@/components/SearchHotkey'
import { buildNav } from '@/lib/nav'
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
  const [cart, zone, regions, regionId, customer, collections, reviews, facets, geo] =
    await Promise.all([
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
    // The category bar is built from the catalogue, not typed out — see `lib/nav.ts`.
    // Same 5-minute cache the listing pages already share, so the bar costs one request
    // per window rather than one per page view.
    getFacets(),
    /**
     * Where the visitor is, which decides whether the law requires us to *ask* before
     * measuring or only to *tell*. Read from a CDN edge header, never from the shipping
     * region — that is where the parcel goes, not where the person is.
     */
    getVisitorGeo(),
  ])

  const nav = buildNav(facets, collections)
  const logo = siteNameParts()

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

        {/* ---- Band A — utility bar ----------------------------------------------
            Two slots, not centred text. The left one keeps AnyJersey's proposition: the
            reference spends this slot on "SIGN UP & SAVE 15%", which is their offer, and
            sourcing a shirt nobody else stocks is ours — it is the one thing no
            competitor's layout has a slot for.

            The right one holds what used to be four of the nine links in the old nav row.
            Moving them here is what frees the width for band C.

            **Not a currency picker.** All five regions are USD (`DEFERRED.md` §3), so a
            currency chooser would advertise a choice that changes no price. "Ship to" is
            real: it drives `getZone()` and the free-shipping threshold. */}
        <div className="utility">
          <div className="wrap">
            {/* `.upromise`, not `.promise`: the PDP already owns `.promise` for the
                bordered sourcing box in its buybox, and a bare class name would have
                painted a border and a wash background around this line. */}
            <p className="upromise">
              Can&rsquo;t find your jersey? <a href="/request">Request it</a> &mdash;
              we&rsquo;ll source it for you fast
            </p>
            <div className="ulinks">
              <a href="/track">Track order</a>
              <a href="/contact">Help</a>
              <a href="/returns">Returns</a>
              <RegionPicker regions={regionOptions} current={regionId} compact />
            </div>
          </div>
        </div>

        <header className="site">
          {/* ---- Band B — brand row ------------------------------------------------
              Logo, then search with the middle of the bar, then the bag.

              **Search is promoted deliberately.** For a 4,300-product catalogue spanning
              six sports, search *is* the primary navigation — and a 280px box in the
              right-hand corner said otherwise. It is also the only control in the header
              that finds "Makhachev", who belongs to no team and no league.

              The menu button and the magnifier are the phone header; CSS shows them below
              900px and hides the inline field and the category bar. */}
          <div className="wrap hrow">
            <MobileNav>
              <NavAccordion nav={nav} />
              {/* Band A is hidden on a phone, so its links live here or nowhere. */}
              <ul className="drawerlinks">
                <li><a href={customer ? '/account' : '/account/login'}>
                  {customer ? 'Your account' : 'Sign in'}</a></li>
                <li><a href="/request">Request a jersey</a></li>
                <li><a href="/track">Track order</a></li>
                <li><a href="/contact">Help</a></li>
                <li><a href="/returns">Returns</a></li>
              </ul>
            </MobileNav>

            {/* The wordmark, from `NEXT_PUBLIC_SITE_NAME` and its accent word. `<em>` is
                the yellow highlight; when there is nothing to accent the name renders
                plain rather than the component guessing which word to pick. */}
            <a href="/" className="logo">
              {logo.before}
              {logo.accent && <em>{logo.accent}</em>}
              {logo.after}
            </a>

            <div className="hsearch">
              <Suspense fallback={<div className="searchwrap" />}>
                <SearchBox id="q-header" />
              </Suspense>
            </div>

            <div className="hactions">
              <SearchSheet />
              {/* The account stays in the masthead rather than moving up into band A with
                  the other secondary links: band A is hidden below 720px, and an account
                  control that disappears on most of the traffic is not a secondary link,
                  it is a missing one. It is in the drawer too. */}
              <a className="haction" href={customer ? '/account' : '/account/login'}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <circle cx="12" cy="8" r="3.6" />
                  <path d="M4.5 20a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
                </svg>
                <span className="lbl">{customer ? 'Account' : 'Sign in'}</span>
              </a>
              <CartButton count={count} data={cartData} />
            </div>
          </div>

          {/* ---- Band C — category bar --------------------------------------------
              Full-bleed dark strip with mega-panels, built from `lib/nav.ts`. Every link
              and count in those panels is server-rendered and in the first response. */}
          <SiteNav nav={nav} />
        </header>

        <main id="main">{children}</main>

        {/* `/` focuses the header search. Renders nothing; stands down inside a field. */}
        <SearchHotkey />

        {/* A plain string crosses the boundary, never the country — see `lib/geo.ts`. */}
        <ConsentBanner regime={geo.regime} />
        <Analytics regime={geo.regime} />

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
              {/* The picker itself is in band A now — "Ship to" belongs above the fold,
                  where it changes what the shopper is about to pay, not at the bottom of
                  the page they have finished reading. The currency note stays. */}
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
