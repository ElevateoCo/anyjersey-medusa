import { getFacets, listJerseys } from '@/lib/medusa'
import { display } from '@/lib/labels'
import { abs } from '@/lib/site'
import ProductCard from '@/components/ProductCard'
import RequestBlock from '@/components/RequestBlock'
import { buildQuery as qs, toggleQuery, valuesFor } from '@/lib/query'
import SearchBox from '@/components/SearchBox'
import SortSelect from '@/components/SortSelect'
import FilterDrawer from '@/components/FilterDrawer'
import { Suspense } from 'react'

export const revalidate = 120

/**
 * `sport` joined this list when the category bar became sport-first. It is the axis five of
 * the twelve nav slots filter on ("Football", "Soccer", …), and while it was missing here
 * every one of those links quietly rendered the entire catalogue: the parameter was in the
 * URL, nothing read it, and the page looked like it had worked.
 *
 * `player` is handled but stays out of this list. It is a real filter — the Shop by Athlete
 * panel links to it — but with ~3,000 values it is not a facet a sidebar can list, and
 * counting it as an applied facet would make every athlete page `noindex`.
 */
const FACET_KEYS = ['league', 'team', 'sport', 'colourway', 'garment', 'season'] as const



/**
 * What to call a garment filter.
 *
 * The two garment slots on the category bar each carry two values, and neither pair has a
 * name the data can supply: `shorts,set` is "Shorts & kits" to a shopper and
 * `jersey,longsleeve-jersey` is just "Jerseys". Without this the two most prominent
 * product-type links in the header both landed on a page headed "All jerseys".
 */
function garmentHeading(values: string[]): string | undefined {
  if (!values.length) return undefined
  const key = [...values].sort().join(',')
  if (key === 'set,shorts') return 'Shorts & kits'
  if (key === 'jersey,longsleeve-jersey') return 'Jerseys'
  return values.map((v) => display(v.replace(/-/g, ' '))).join(' & ')
}
type Search = Record<string, string | string[] | undefined>

/**
 * Listing metadata, and the rule that keeps a six-dimension facet system out of the index.
 *
 * A 3,155-product catalog with six facets generates more filter permutations than it has
 * products. Left indexable, a crawler spends its budget on `?colourway=white&season=2019`
 * and never reaches the product pages that actually rank — and the near-identical listings
 * compete with each other.
 *
 * So: **one facet is a page, two or more is a filter.** A single-facet view
 * (`?league=NFL`) gets a real title, its own canonical and an index directive, and it is
 * what the sitemap lists. Anything deeper, any search, and any paged view gets
 * `noindex, follow` — dropped from the index, still crawled through to the products.
 *
 * `follow` matters. `noindex, nofollow` would strand every product only reachable through a
 * filtered listing, which on this catalog is most of them.
 */
export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined)
  const many = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[]) : [])

  const applied = FACET_KEYS.map((k) => [k, one(k)] as const).filter(([, v]) => !!v)
  const q = one('q')
  const paged = Number(one('offset') ?? 0) > 0
  const custom = one('custom') === 'true'
  // A facet carrying two values — `?garment=shorts&garment=set`, the "Shorts & Kits" slot
  // — is a filter view, not a page. It gets the same `noindex, follow` as a two-facet
  // view, and for the same reason: there is no single canonical URL it is the canonical
  // form of. Without this branch it read as *zero* applied facets and claimed to be the
  // indexable "All jerseys" page, competing with the real one.
  const multi = [...FACET_KEYS, 'player'].some((k) => many(k).length > 1)
  const player = one('player')

  const indexable = applied.length <= 1 && !q && !paged && !multi && !player

  // The custom line is a page worth ranking in its own right — it is a different product at
  // a different price, not a filter of the main catalog — so it gets its own copy rather
  // than inheriting "All jerseys".
  if (custom && applied.length === 0 && !q && !paged) {
    return {
      title: 'Custom jerseys — your name, your number',
      description:
        'Blank team jerseys printed to order. Add any name and number — the printing is ' +
        'included in the price.',
      alternates: { canonical: abs('/jerseys?custom=true') },
      openGraph: {
        title: 'Custom jerseys — your name, your number',
        description: 'Blank team jerseys printed to order. Printing included.',
        url: abs('/jerseys?custom=true'),
      },
    }
  }

  const title =
    q ? `Search: ${q}`
    : player ? `${player} jerseys`
    : multi ? (garmentHeading(many('garment')) ?? 'Jerseys')
    : applied.length === 0 ? 'All jerseys'
    : applied.length === 1 && applied[0][0] === 'garment'
      ? garmentHeading([applied[0][1]!])!
    : applied.length === 1 ? `${display(applied[0][1]!)} jerseys`
    : `${applied.map(([, v]) => display(v!)).join(' · ')} jerseys`

  const description = q
    ? `Jerseys matching “${q}”. Can't find it? Ask us to source it.`
    : applied.length === 1
      ? `Every ${applied[0][1]} jersey we can source, shipped on-demand. ` +
        `Can't find yours? Request it.`
      : 'Hard-to-find jerseys shipped on-demand, sourced to order.'

  // The canonical points at the single-facet URL for an indexable view, and at the bare
  // listing otherwise — so a deep filter view credits the page it is a filter of.
  const canonical = indexable && applied.length === 1
    ? abs(`/jerseys?${applied[0][0]}=${encodeURIComponent(applied[0][1]!)}`)
    : abs('/jerseys')

  return {
    title,
    description,
    alternates: { canonical },
    robots: indexable ? undefined : { index: false, follow: true },
    openGraph: { title, description, url: canonical },
  }
}



export default async function PLP({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const get = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined)
  /**
   * A filter the URL repeats — `?garment=shorts&garment=set` — arrives as an array, and
   * `get` returns undefined for it. `all` is what the API call uses, so a one-value filter
   * still goes out as a string and a two-value one goes out as both.
   */
  const all = (k: string): string | string[] | undefined => {
    const v = sp[k]
    if (Array.isArray(v)) return v.length > 1 ? v : v[0]
    return typeof v === 'string' ? v : undefined
  }
  const limit = 24
  const offset = Number(get('offset') ?? 0) || 0

  const [facets, res] = await Promise.all([
    getFacets(),
    listJerseys({
      league: all('league'), team: all('team'), colourway: all('colourway'),
      garment: all('garment'), season: all('season'), q: get('q'),
      sport: all('sport'), player: all('player'),
      custom: get('custom'),
      sort: get('sort'), limit, offset,
    }),
  ])

  const isCustom = get('custom') === 'true'
  // One chip per value, so a two-value filter can have either half removed.
  const active: { key: string; value: string }[] = [...FACET_KEYS, 'player']
    .flatMap((k) => {
      const v = sp[k]
      const values = Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
      return values.filter(Boolean).map((value) => ({ key: k, value }))
    })
  const groups: { key: string; title: string; items: { value: string; count: number }[] }[] = [
    { key: 'sport', title: 'Sport', items: facets.sports },
    { key: 'league', title: 'League', items: facets.leagues },
    { key: 'team', title: 'Team', items: facets.teams.slice(0, 60) },
    { key: 'colourway', title: 'Colour', items: facets.colourways },
    { key: 'garment', title: 'Type', items: facets.garments },
  ]

  return (
    <>
      <div className="wrap plp">
        <nav className="facets desktop-only" aria-label="Filter jerseys">
          <p className="eyebrow" style={{ marginBottom: '1rem' }}>
            {res.count.toLocaleString()} of {facets.total.toLocaleString()}
          </p>
          {/* A boolean, so it is a toggle rather than a facet list — rendering it as one
              would put an option called "false" in the navigation. */}
          {facets.custom > 0 && (
            <section>
              {/* Not "Type": the garment facet below already uses that heading, and two
                  identical headings in one sidebar is a navigation problem. */}
              <h3>Personalise</h3>
              <ul>
                <li>
                  <a className={isCustom ? 'on' : undefined}
                     aria-current={isCustom ? 'true' : undefined}
                     href={qs(sp, { custom: isCustom ? undefined : 'true' })}>
                    <span>Custom &mdash; add your name</span>
                    <span className="n">{facets.custom}</span>
                  </a>
                </li>
              </ul>
            </section>
          )}

          {groups.map((g) => (
            <section key={g.key}>
              <h3>{g.title}</h3>
              <ul>
                {g.items.map((it) => {
                  const on = valuesFor(sp, g.key).includes(it.value)
                  return (
                    <li key={it.value}>
                      {/* Multi-select. `buildQuery` would replace the key and drop whatever
                          was already chosen — picking a second team should narrow to two
                          teams, not swap one for the other. */}
                      <a className={on ? 'on' : undefined}
                         aria-current={on ? 'true' : undefined}
                         aria-label={on ? `Remove ${g.title} filter ${it.value}`
                                        : `Filter by ${g.title} ${it.value}, ${it.count} items`}
                         href={toggleQuery(sp, g.key, it.value)}>
                        <span>{it.value}</span><span className="n">{it.count}</span>
                      </a>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </nav>

        <div>
          {/* The heading names whichever axis the shopper actually arrived on. `sport`
              and `player` are here because the category bar and the Shop by Athlete panel
              link to them — without them a Football listing was headed "All jerseys". */}
          <h1>
            {isCustom && !get('team') && !get('league') && !get('sport')
              ? 'Custom jerseys'
              : get('player')
                ?? get('team')
                ?? get('league')
                ?? (get('sport') ? display(get('sport')!) : undefined)
                ?? garmentHeading(
                     Array.isArray(sp.garment) ? sp.garment
                       : typeof sp.garment === 'string' ? [sp.garment] : []
                   )
                ?? (get('q') ? `“${get('q')}”` : 'All jerseys')}
          </h1>

          {/* What the customer is actually buying, stated once at the top. Without it a
              $89.99 shirt sits next to a $65.99 one with no visible reason. */}
          {isCustom && (
            <p className="plpintro">
              Blank team shirts, printed to order. Put <strong>any name and any number</strong>{' '}
              on the back — the printing is included in the price, not an extra.
              Leave them blank and it ships plain.{' '}
              <a href="/size-guide">Sizing runs large</a>, and custom shirts are made to your
              specification so they <a href="/returns">can’t be returned</a> once printed.
            </p>
          )}

          <div className="plphead">
            <FilterDrawer activeCount={active.length} resultCount={res.count}>
              <div className="facets in-drawer">
                <p className="eyebrow" style={{ marginBottom: '1rem' }}>
                  {res.count.toLocaleString()} of {facets.total.toLocaleString()}
                </p>
                {groups.map((g) => (
                  <section key={g.key}>
                    <h3>{g.title}</h3>
                    <ul>
                      {g.items.map((it) => {
                        const on = valuesFor(sp, g.key).includes(it.value)
                        return (
                          <li key={it.value}>
                            <a className={on ? 'on' : undefined}
                               aria-current={on ? 'true' : undefined}
                               href={toggleQuery(sp, g.key, it.value)}>
                              <span>{it.value}</span><span className="n">{it.count}</span>
                            </a>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            </FilterDrawer>
            <Suspense fallback={<div className="search" />}><SearchBox /></Suspense>
            <Suspense fallback={null}>
              <SortSelect options={res.sorts ?? ['relevance']}
                          current={res.sort ?? 'relevance'} />
            </Suspense>
          </div>

          {active.length > 0 && (
            <div className="chips" style={{ marginTop: '1rem' }}>
              {active.map(({ key, value }) => (
                <span key={`${key}-${value}`} className="chip">
                  {key}: {value}{' '}
                  {/* Removes this value only — the other values of the same filter stay. */}
                  <a href={toggleQuery(sp, key, value)}
                     aria-label={`Remove ${key} filter ${value}`}>×</a>
                </span>
              ))}
              <a className="chip" href="/jerseys">Clear all</a>
            </div>
          )}

          <p aria-live="polite" className="visually-hidden">
            {res.count} jerseys match the current filters
          </p>

          {res.products.length === 0 ? (
            <div className="todo" style={{ marginTop: '2rem' }}>
              <b>Nothing matched</b>
              This is exactly where the request block earns its place: an empty result is a
              customer telling you what to stock. Scroll down and ask for it.
            </div>
          ) : (
            <div className="grid" style={{ marginTop: '1.5rem' }}>
              {res.products.map((p) => <ProductCard key={p.id} p={p} />)}
            </div>
          )}

          {(() => {
            const pages = Math.ceil(res.count / limit)
            const cur = Math.floor(offset / limit) + 1
            // A window around the current page. anyjersey.com paginates 3,636 products
            // across 228 pages of 16 with no window at all — unusable past page 3.
            const window = new Set<number>([1, pages, cur, cur - 1, cur + 1, cur - 2, cur + 2])
            const shown = [...window].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
            return (
              <nav className="pager" aria-label="Pagination">
                {offset > 0 && (
                  <a href={qs(sp, { offset: String(Math.max(0, offset - limit)) })}
                     rel="prev">← Prev</a>
                )}
                {shown.map((n, i) => (
                  <span key={n} className="pagegroup">
                    {i > 0 && shown[i - 1] !== n - 1 && <span className="gap">…</span>}
                    {n === cur
                      ? <b aria-current="page">{n}</b>
                      : <a href={qs(sp, { offset: String((n - 1) * limit) })}>{n}</a>}
                  </span>
                ))}
                {offset + limit < res.count && (
                  <a href={qs(sp, { offset: String(offset + limit) })} rel="next">Next →</a>
                )}
                <span className="count">
                  {res.count === 0 ? '0' : `${offset + 1}–${Math.min(offset + limit, res.count)}`}
                  {' of '}{res.count.toLocaleString()}
                </span>
              </nav>
            )
          })()}
        </div>
      </div>

      <RequestBlock source={res.products.length === 0 ? 'search_empty' : 'collection'}
                    prefill={get('q') ?? [get('team'), get('colourway')].filter(Boolean).join(' ')} />
    </>
  )
}
