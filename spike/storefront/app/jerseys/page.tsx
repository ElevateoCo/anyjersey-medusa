import { getFacets, listJerseys } from '@/lib/medusa'
import { abs } from '@/lib/site'
import ProductCard from '@/components/ProductCard'
import RequestBlock from '@/components/RequestBlock'
import { buildQuery as qs } from '@/lib/query'
import SearchBox from '@/components/SearchBox'
import SortSelect from '@/components/SortSelect'
import FilterDrawer from '@/components/FilterDrawer'
import { Suspense } from 'react'

export const revalidate = 120

const FACET_KEYS = ['league', 'team', 'colourway', 'garment', 'season'] as const
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

  const applied = FACET_KEYS.map((k) => [k, one(k)] as const).filter(([, v]) => !!v)
  const q = one('q')
  const paged = Number(one('offset') ?? 0) > 0
  const custom = one('custom') === 'true'

  const indexable = applied.length <= 1 && !q && !paged

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

  const title = q
    ? `Search: ${q}`
    : applied.length === 0
      ? 'All jerseys'
      : applied.length === 1
        ? `${applied[0][1]} jerseys`
        : `${applied.map(([, v]) => v).join(' · ')} jerseys`

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
  const limit = 24
  const offset = Number(get('offset') ?? 0) || 0

  const [facets, res] = await Promise.all([
    getFacets(),
    listJerseys({
      league: get('league'), team: get('team'), colourway: get('colourway'),
      garment: get('garment'), season: get('season'), q: get('q'),
      custom: get('custom'),
      sort: get('sort'), limit, offset,
    }),
  ])

  const isCustom = get('custom') === 'true'
  const active = FACET_KEYS.map((k) => [k, get(k)] as const).filter(([, v]) => v)
  const groups: { key: string; title: string; items: { value: string; count: number }[] }[] = [
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
                  const on = get(g.key) === it.value
                  return (
                    <li key={it.value}>
                      <a className={on ? 'on' : undefined}
                         aria-current={on ? 'true' : undefined}
                         aria-label={on ? `Remove ${g.title} filter ${it.value}`
                                        : `Filter by ${g.title} ${it.value}, ${it.count} items`}
                         href={qs(sp, { [g.key]: on ? undefined : it.value })}>
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
          <h1>
            {isCustom && !get('team') && !get('league')
              ? 'Custom jerseys'
              : get('team') ?? get('league') ?? (get('q') ? `“${get('q')}”` : 'All jerseys')}
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
                        const on = get(g.key) === it.value
                        return (
                          <li key={it.value}>
                            <a className={on ? 'on' : undefined}
                               aria-current={on ? 'true' : undefined}
                               href={qs(sp, { [g.key]: on ? undefined : it.value })}>
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
              {active.map(([k, v]) => (
                <span key={k} className="chip">
                  {k}: {v} <a href={qs(sp, { [k]: undefined })} aria-label={`Remove ${k} filter`}>×</a>
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
