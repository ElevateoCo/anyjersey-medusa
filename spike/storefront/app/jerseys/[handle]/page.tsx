import {
  getPersonalisationOffer, getProduct, getReviewAggregate, listJerseys, money, sortSizes,
  mediaUrl, mediaSrcSet, resolveOldHandle,
} from '@/lib/medusa'
import { getZone } from '@/lib/cart'
import ProductCard from '@/components/ProductCard'
import RequestBlock from '@/components/RequestBlock'
import SizePicker from '@/components/SizePicker'
import Reviews from '@/components/Reviews'
import ShareLink from '@/components/ShareLink'
import JsonLd from '@/components/JsonLd'
import { breadcrumbs, productSchema } from '@/lib/seo'
import { abs } from '@/lib/site'
import { notFound, permanentRedirect } from 'next/navigation'
import { cache } from 'react'

export const revalidate = 120

/**
 * Memoised, because `generateMetadata` and the page body both need the product.
 *
 * Without `cache` this is two identical requests per render. Next dedupes `fetch` within a
 * render pass, but only for identical requests — and relying on that rather than saying so
 * makes the second call look intentional to whoever reads it next.
 */
const product = cache((handle: string) => getProduct(handle))

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const p = await product(handle)
  if (!p) return { title: 'Not found', robots: { index: false, follow: false } }
  const d = p.jersey_detail
  const title = d?.seo_title || p.title
  const description = d?.seo_description || p.description || undefined
  const image = mediaUrl(p.images?.[0]?.url ?? p.thumbnail, 1400)
  return {
    title,
    description,
    alternates: { canonical: abs(`/jerseys/${p.handle}`) },
    openGraph: {
      type: 'website',
      title,
      description,
      url: abs(`/jerseys/${p.handle}`),
      ...(image ? { images: [{ url: image }] } : {}),
    },
  }
}

export default async function PDP({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const p = await product(handle)

  if (!p) {
    /**
     * Before giving up, ask whether this was the old shop's slug.
     *
     * The import renamed a third of the catalogue, and links to the old slugs exist on the
     * new path shape too — anywhere somebody hand-edited a URL, and anywhere a crawler
     * followed one redirect and cached the result. The lookup costs nothing on the happy
     * path because it only runs when the page was going to 404 anyway.
     */
    const resolved = await resolveOldHandle(handle)
    if (resolved && resolved !== handle) permanentRedirect(`/jerseys/${resolved}`)
    notFound()
  }

  // All three are fetched here rather than inside the components that use them, so they
  // land in the server HTML. The zone is what stops the buy box quoting a shipping price
  // from a different continent.
  const [offer, reviews, zone] = await Promise.all([
    getPersonalisationOffer(p.id),
    getReviewAggregate(p.id),
    getZone(),
  ])

  const d = p.jersey_detail ?? {}
  const image = p.images?.[0]?.url ?? p.thumbnail
  const price = p.variants?.[0]?.calculated_price?.calculated_amount ?? null

  // Split each variant's options into size and fit. Sizes come back unordered from the
  // API — a spike finding — so sortSizes is not optional.
  const fitOption = p.options?.find((o) => o.title.toLowerCase() === 'fit')
  const fits = fitOption?.values?.map((v) => v.value) ?? []
  const enriched = sortSizes(p.variants).map((v) => {
    const parts = v.title.split('/').map((s) => s.trim())
    return { ...v, size: parts[0], fit: parts[1] ?? fits[0] ?? 'Unisex' }
  })

  const related = d.team
    ? await listJerseys({ team: d.team, limit: 6 })
    : { products: [] as Awaited<ReturnType<typeof listJerseys>>['products'] }

  // Structured data built from the same values the page renders. A price in the markup that
  // differs from the price on screen is the classic penalty, and no field is emitted that
  // the catalog cannot substantiate — no invented rating, no `priceValidUntil` we do not
  // honour, and `BackOrder` rather than `InStock` because nothing here is stock-tracked.
  const schema = productSchema({
    handle: p.handle,
    title: p.title,
    description: d.seo_description || p.description,
    image: mediaUrl(image, 1400),
    price,
    currency: 'usd',
    sizes: enriched.map((v) => v.size).filter((v, i, a) => a.indexOf(v) === i),
    brand: d.team ?? null,
    // Emitted only when there is something real to count — see getReviewAggregate.
    reviews: reviews.count > 0 && reviews.average != null
      ? { count: reviews.count, average: reviews.average }
      : null,
    leadTime: zone?.leadTime ?? null,
  })

  const trail = [
    { name: 'Home', path: '/' },
    { name: 'Jerseys', path: '/jerseys' },
    ...(d.league ? [{ name: d.league, path: `/jerseys?league=${encodeURIComponent(d.league)}` }] : []),
    ...(d.team ? [{ name: d.team, path: `/jerseys?team=${encodeURIComponent(d.team)}` }] : []),
    { name: p.title, path: `/jerseys/${p.handle}` },
  ]

  return (
    <>
      <JsonLd data={[schema, breadcrumbs(trail)]} />

      {/* A visible breadcrumb, not just markup. It is how a customer arriving from search
          discovers the league and team listings, which is the navigation this catalog has
          instead of collections. */}
      <nav className="crumbs wrap" aria-label="Breadcrumb">
        <ol>
          {trail.map((t, i) => (
            <li key={t.path}>
              {i === trail.length - 1
                ? <span aria-current="page">{t.name}</span>
                : <a href={t.path}>{t.name}</a>}
            </li>
          ))}
        </ol>
      </nav>

      <div className="wrap pdp">
        <div className="gallery">
          {image
            ? <img
                src={mediaUrl(image, 800) ?? undefined}
                srcSet={mediaSrcSet(image)}
                sizes="(max-width: 900px) 100vw, 620px"
                alt={[d.player, d.team, d.colourway, d.garment]
                  .filter(Boolean).join(' ') || p.title} />
            : <div className="noimg" style={{ aspectRatio: '1/1' }}>No image</div>}
          <p className="onlyone">
            One image per product &mdash; a deliberate decision (§13.6). The copy, fit
            information and personalisation preview carry what a gallery would have shown.
          </p>
        </div>

        <div className="buybox">
          <p className="eyebrow">{[d.league, d.team].filter(Boolean).join(' · ')}</p>
          <h1>{p.title}</h1>
          <a className="rating" href="#reviews">See reviews below</a>
          {/* Was "+ $4.99 shipping", hardcoded. That is right for the US and wrong by up
              to $25 everywhere else — the same bug the cart had before it started reading
              the zone, one page earlier in the funnel and therefore worse. */}
          <p className="price">
            {money(price)}
            <small>
              {zone
                ? price != null && zone.freeOver > 0 && price >= zone.freeOver
                  ? `free shipping to ${zone.name}`
                  : `+ ${money(zone.rate)} shipping to ${zone.name}`
                : 'shipping calculated at checkout'}
            </small>
          </p>

          <SizePicker variants={enriched} fits={fits}
                      product={{ id: p.id, title: p.title, team: d.team,
                                 player: d.player, colourway: d.colourway,
                                 colour_hex: colourHex(d.colourway) }}
                      offer={offer} />

          {p.description && <p className="desc">{p.description}</p>}

          {/* Size is the one thing we cannot take back, so the guide is offered where the
              size is chosen rather than in the footer. */}
          <p className="fitlink">
            Unsure of the size? <a href="/size-guide">How our sizing runs</a> &mdash; all
            sales are final, so it is worth a look before you order.
          </p>

          <ShareLink title={p.title} />

          <div className="todo">
            <b>Blocked on one supplier input</b>
            Chest and length measurements, for the <a href="/size-guide">size guide</a>. The
            guidance there is accurate; the numbers are outstanding and are shown as missing
            rather than guessed. Personalisation is live above; its production print-file
            format is the other input that cannot be assumed (personalisation-spec.md §6).
          </div>

          <h2 style={{ marginTop: '1.5rem', fontSize: '1.05rem' }}>Details</h2>
          <table className="spec">
            <tbody>
              {([['Team', d.team], ['Player', d.player], ['Colour', d.colourway],
                 ['League', d.league], ['Season', d.season], ['Type', d.garment],
                 ['Fibre composition', d.fibre_composition],
                 ['Country of origin', d.country_of_origin],
                 ['Care', d.care_instructions]] as [string, string | null | undefined][])
                .map(([k, v]) => (
                  <tr key={k}>
                    <th>{k}</th>
                    <td>{v ?? <span style={{ color: 'var(--ink-3)' }}>Not recorded</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!d.fibre_composition && (
            <p style={{ fontSize: '.8rem', color: 'var(--ink-3)', marginTop: '.5rem' }}>
              The blank rows are the regulatory block (§13.5). They are a hard gate on EU
              orders, and one supplier email fills all of them.
            </p>
          )}
        </div>
      </div>

      <section className="band" id="reviews">
        <div className="wrap"><Reviews productId={p.id} /></div>
      </section>

      {related.products.length > 1 && (
        <section className="band">
          <div className="wrap">
            <div className="sechead">
              <h2>More {d.team}</h2>
              <a href={`/jerseys?team=${encodeURIComponent(d.team!)}`}>See all</a>
            </div>
            <div className="grid">
              {related.products.filter((r) => r.handle !== p.handle).slice(0, 5)
                .map((r) => <ProductCard key={r.id} p={r} />)}
            </div>
          </div>
        </section>
      )}

      <RequestBlock source="product"
        prefill={[d.player, d.team, d.colourway].filter(Boolean).join(' ')} />
    </>
  )
}

/**
 * The shirt colour for the preview plate.
 *
 * Derived from the colourway the taxonomy already resolved, so there is no new field to
 * populate across 3,155 products. Unknown colourways fall back to a neutral navy rather
 * than to white, because a white plate makes white print invisible and reads as a broken
 * preview instead of an unknown colour.
 */
function colourHex(colourway?: string | null): string {
  const c = (colourway ?? '').toLowerCase()
  const map: [string, string][] = [
    ['white', '#EFEDE8'], ['black', '#1A1A18'], ['red', '#A8271F'], ['blue', '#1F3A6E'],
    ['navy', '#16264A'], ['green', '#1B5E3A'], ['yellow', '#D8A526'], ['gold', '#C9992B'],
    ['orange', '#C4571C'], ['purple', '#4A2A6B'], ['pink', '#B4527A'], ['grey', '#6E6E69'],
    ['gray', '#6E6E69'], ['maroon', '#5C1F26'], ['teal', '#186D6D'], ['sky', '#4A7FB5'],
    ['cream', '#E8DFC9'], ['brown', '#5A3A22'], ['silver', '#B8B8B3'],
  ]
  for (const [key, hex] of map) if (c.includes(key)) return hex
  return '#1F3A6E'
}
