import { getCollection, getCollections, getFacets, listJerseys } from '@/lib/medusa'
import type { Card } from '@/lib/medusa'
import ProductCard from '@/components/ProductCard'
import RequestBlock from '@/components/RequestBlock'
import StoreReviews from '@/components/StoreReviews'
import Mosaic, { type Tile } from '@/components/Mosaic'
import HeroBanner from '@/components/HeroBanner'
import Rail from '@/components/Rail'
import RecentlyViewed from '@/components/RecentlyViewed'
import { spread } from '@/lib/rails'
import { getHero, hasHeroAsset } from '@/lib/hero'
import { abs } from '@/lib/site'

export const revalidate = 300

export const metadata = {
  alternates: { canonical: abs('/') },
}

/**
 * A sport earns a rail at this many products — the same threshold that puts it on the
 * category bar, so the homepage and the navigation tell the same story about what this
 * shop sells. Below it, the sport is reachable from "More" and from search, which is the
 * honest treatment of sixteen hockey shirts.
 */
const SPORT_ON_HOME = 100

/**
 * How many products a rail asks for before thinning it — see `spread`.
 *
 * Deliberately the API's own page size rather than a smaller number: 24 costs the same
 * round trip as 6, the response is cached for the whole revalidation window, and a bigger
 * pool is what makes the thinning work on a sport whose catalogue is lopsided.
 */
const RAIL_POOL = 24

const SPORT_LABEL: Record<string, string> = {
  football: 'Football', soccer: 'Soccer', baseball: 'Baseball',
  basketball: 'Basketball', 'college football': 'College football', hockey: 'Hockey',
  mma: 'MMA',
}

/**
 * The homepage, rebuilt to `layout-plan.md` §5.
 *
 * Two things are gone.
 *
 * **The dark hero.** Its main job was a second copy of the search box, and search now has
 * the middle of the masthead — keeping both put two search fields above the fold, which is
 * a question about which one is the real one. Its headline was doing work the mosaic does
 * better, with product photography instead of a sentence.
 *
 * **The public `.todo` block.** A note to ourselves about an unbuilt personalisation
 * teaser was rendering to customers. It is behind an env flag now.
 *
 * The order of what is left is the whole idea: what is good here (the mosaic, then Best
 * Sellers) before what is here (the sport rails). Best Sellers is new to this page — it is
 * the only list in the shop that is both cross-sport and cross-garment, and until now it
 * appeared nowhere on the homepage, which left the page implicitly claiming the store is
 * NFL and soccer only.
 */
export default async function Home() {
  const [facets, collections, custom] = await Promise.all([
    getFacets(),
    getCollections(),
    listJerseys({ custom: 'true', limit: RAIL_POOL }),
  ])

  // Custom shirts are per-team blanks, so the same club arrives in three colourways —
  // the same thinning the sport rails need.
  const customRail = spread(custom.products)

  const hasBest = collections.some((c) => c.handle === 'best-sellers')

  // **Every** sport, not only the ones big enough for a rail: the tile band is where a
  // six-sport catalogue proves it is one, and hockey and MMA are exactly the sports a
  // shopper does not expect to find here. The rails below still apply the threshold.
  const [best, kitsRaw, ...sportRows] = await Promise.all([
    hasBest ? getCollection('best-sellers', { limit: 6 }).catch(() => null) : null,
    // Repeated key, not a comma: see `listJerseys`. Sets and shorts are one destination.
    listJerseys({ garment: ['shorts', 'set'], limit: RAIL_POOL, sort: 'newest' }),
    ...facets.sports.map((s) =>
      listJerseys({ sport: s.value, limit: RAIL_POOL, sort: 'newest' })),
  ])
  const kits = { ...kitsRaw, products: spread(kitsRaw.products) }
  const rowFor = (sport: string) => {
    const row = sportRows[facets.sports.findIndex((s) => s.value === sport)] as
      Awaited<ReturnType<typeof listJerseys>> | undefined
    return row ? { ...row, products: spread(row.products) } : undefined
  }

  const homeSports = facets.sports.filter((s) => s.count >= SPORT_ON_HOME)

  /**
   * The leagues a sport actually sells under, for the tile's second line — derived, so a
   * new league appears here the day it appears in the catalogue. `SOCCER` and `CLUB` are
   * named for a shopper rather than for the database.
   */
  const LEAGUE_LABEL: Record<string, string> = {
    SOCCER: 'International', CLUB: 'Clubs', NCAA: 'College',
  }
  const leaguesFor = (sport: string) => {
    const names = facets.teams
      .filter((t) => t.sport === sport && t.league)
      .map((t) => LEAGUE_LABEL[t.league!] ?? t.league!)
    return [...new Set(names)].slice(0, 2).join(' · ')
  }

  const shot = (p?: Card) => p?.thumbnail ?? null

  /**
   * The tile band: every sport, then the three destinations that belong to no sport.
   *
   * Sport leads because it is this catalogue's largest division and the thing a shopper
   * arrives knowing — `layout-plan.md` §2 is an argument about exactly that, and the
   * `anyjersey_files/demo` concept opens on "pick your sport" for the same reason. Custom
   * and Request follow because they are the two things this shop does that a marketplace
   * listing cannot, and Best Sellers closes because it is the one entry that crosses every
   * sport at once.
   */
  const tiles: Tile[] = [
    ...facets.sports.map((s) => ({
      label: SPORT_LABEL[s.value] ?? s.value,
      sub: leaguesFor(s.value) || 'Shop now',
      href: `/jerseys?sport=${encodeURIComponent(s.value)}`,
      image: shot(rowFor(s.value)?.products[0]),
      count: s.count,
    })),
    {
      label: 'Custom',
      sub: 'Your name, your number',
      href: '/jerseys?custom=true',
      image: shot(customRail[0]),
      count: custom.count,
      accent: true,
    },
    {
      label: 'Request a jersey',
      sub: "If it isn't here, we'll source it",
      href: '/request',
      image: shot(customRail[1]),
    },
    ...(best
      ? [{
          label: 'Best sellers',
          sub: 'Across every sport',
          href: '/collections/best-sellers',
          image: shot(best.products[0]),
          count: best.count,
        }]
      : []),
  ]

  /**
   * The campaign band, above everything.
   *
   * It deliberately carries **no heading**. The `<h1>` belongs to the lede below it, and
   * `a11y_check.py` now asserts the page's outline opens at `h1` — a banner with an `h2`
   * in it would put a section before the thing it is a section of. Meaning lives in the
   * call to action, which is a real link.
   */
  const hero = getHero()
  const showHero = hasHeroAsset(hero)
  const showSlot = !showHero && process.env.NODE_ENV !== 'production'

  return (
    <>
      {(showHero || showSlot) && <HeroBanner hero={hero} placeholder={showSlot} />}

      {/* The dark hero is gone, but its `<h1>` cannot be: a homepage with no level-one
          heading fails the audit, and it costs the one place the store says what it is in
          its own words. This is that sentence at the weight it deserves — one line on
          paper, above the mosaic, instead of a full-height slab whose main job was a
          second copy of the search box. */}
      <section className="lede">
        <div className="wrap">
          <h1>Find <em>any</em> jersey</h1>
          <p>
            {facets.total.toLocaleString()} shirts across{' '}
            {facets.sports.length} sports, sourced on demand &mdash; and if it isn&rsquo;t
            here, <a href="/request">we&rsquo;ll find it</a>.
          </p>
        </div>
      </section>

      <Mosaic tiles={tiles} />

      {/* Band D. Teams across every sport, biggest first — the NFL dominates it and that
          is an honest picture of the catalogue, not a merchandising decision. */}
      <Rail
        title="Shop your team"
        seeAll={{ label: `All ${facets.teams.length} teams`, href: '/jerseys' }}
        items={facets.teams.slice(0, 16).map((t) => ({
          label: t.value,
          href: `/jerseys?team=${encodeURIComponent(t.value)}`,
          count: t.count,
          image: t.image,
        }))}
      />

      {best && best.products.length > 0 && (
        <section className="band">
          <div className="wrap">
            <div className="sechead">
              <h2>Best sellers</h2>
              <a href="/collections/best-sellers">See all {best.count.toLocaleString()}</a>
            </div>
            <div className="grid six">
              {best.products.map((p) => <ProductCard key={p.id} p={p} />)}
            </div>
          </div>
        </section>
      )}

      {/* The highest-margin thing on the site ($89.99 against a $64.99 base) and the one
          product a competitor cannot copy from a supplier list.

          It carries the customisation message on its own. A second band under it — an
          interactive personaliser — was built and removed: two adjacent ink bands both
          headed "put your name on it" read as the same thing said twice, whatever the
          proposition underneath. The live, priced, server-validated control is on every
          product page, which is where somebody has chosen a shirt to put a name on. */}
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
            <div className="grid six">
              {customRail.map((p) => <ProductCard key={p.id} p={p} />)}
            </div>
          </div>
        </section>
      )}

      {/* Per-device and client-only by design — see the component. Returns null when
          there is no history, which is most first visits, and only then does it ask the
          store for anything. */}
      <RecentlyViewed />

      {homeSports.map((s) => {
        const row = rowFor(s.value)
        if (!row?.products.length) return null
        return (
          <section className="band" key={s.value}>
            <div className="wrap">
              <div className="sechead">
                <h2>{SPORT_LABEL[s.value] ?? s.value}</h2>
                <a href={`/jerseys?sport=${encodeURIComponent(s.value)}`}>
                  See all {s.count.toLocaleString()}
                </a>
              </div>
              <div className="grid six">
                {row.products.map((p) => <ProductCard key={p.id} p={p} />)}
              </div>
            </div>
          </section>
        )
      })}

      {/* "Not just jerseys", made visible. 186 products against 4,131 shirts, so it is a
          rail at the bottom rather than a slot at the top — but it is on the page, which
          it was not before. */}
      {kits.products.length > 0 && (
        <section className="band">
          <div className="wrap">
            <div className="sechead">
              <h2>Shorts &amp; kits</h2>
              <a href="/jerseys?garment=shorts&garment=set">
                See all {kits.count.toLocaleString()}
              </a>
            </div>
            <div className="grid six">
              {kits.products.map((p) => <ProductCard key={p.id} p={p} />)}
            </div>
          </div>
        </section>
      )}

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

      {/* Real reviews, real aggregate — the 84 carried over from eBay, Depop and Facebook
          Marketplace. Store scope only: this number never appears on a product page as that
          product's rating, which is the §12.7 defect. */}
      <StoreReviews limit={6} />

      {/* A note to ourselves, and it was rendering to customers. Flagged off by default:
          the personalisation preview it describes is built and live on every product page,
          and what is missing is the supplier's print-file format
          (`personalisation-spec.md` §6). */}
      {process.env.NEXT_PUBLIC_SHOW_TODO === 'true' && (
        <section className="band">
          <div className="wrap">
            <div className="todo">
              <b>Not built yet — blocked on one supplier input</b>
              Personalisation teaser with a live preview for the homepage. The preview
              itself is built and live on every product page; what is missing is the
              supplier&rsquo;s print-file format (personalisation-spec.md §6), and a teaser
              that cannot lead to a finished order is not worth the space yet.
            </div>
          </div>
        </section>
      )}

      <RequestBlock source="homepage" />
    </>
  )
}
