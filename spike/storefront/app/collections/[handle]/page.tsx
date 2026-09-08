import { notFound } from 'next/navigation'
import { getCollection, getCollections } from '@/lib/medusa'
import ProductCard from '@/components/ProductCard'
import RequestBlock from '@/components/RequestBlock'
import { abs } from '@/lib/site'

export const revalidate = 300

/**
 * A curated collection.
 *
 * These are editorial lists, so the source's own ordering is preserved rather than sorted —
 * "Best Sellers" in alphabetical order is not a best-sellers list. There is deliberately no
 * sort control for the same reason.
 */
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const data = await getCollection(handle, { limit: 1 })
  if (!data) return { title: 'Not found', robots: { index: false, follow: false } }
  return {
    title: data.collection.title,
    description: data.collection.description || undefined,
    alternates: { canonical: abs(`/collections/${handle}`) },
    openGraph: {
      title: data.collection.title,
      description: data.collection.description || undefined,
      url: abs(`/collections/${handle}`),
    },
  }
}

export async function generateStaticParams() {
  const cols = await getCollections()
  return cols.map((c) => ({ handle: c.handle }))
}

const PER_PAGE = 24

export default async function CollectionPage({ params, searchParams }: {
  params: Promise<{ handle: string }>
  searchParams: Promise<{ offset?: string }>
}) {
  const { handle } = await params
  const { offset: rawOffset } = await searchParams
  const offset = Math.max(Number(rawOffset ?? 0) || 0, 0)

  const data = await getCollection(handle, { limit: PER_PAGE, offset })
  if (!data) notFound()

  const { collection, count, products } = data
  const shown = offset + products.length

  return (
    <>
      <section className="band">
        <div className="wrap">
          <p className="eyebrow">Collection</p>
          <h1>{collection.title}</h1>
          {collection.description && (
            <p className="plpintro">{collection.description}</p>
          )}
          <p className="note" style={{ marginBottom: '1.5rem' }}>
            {count.toLocaleString()} {count === 1 ? 'jersey' : 'jerseys'}
            {' · '}
            <a href="/jerseys">browse the full catalog</a> if you would rather filter by team
            or colour.
          </p>

          <div className="grid">
            {products.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>

          {/* Offset paging, matching the listing page. No sort control: the order is the
              editorial one and re-sorting it would discard the only thing that makes this
              a collection rather than a filter. */}
          {count > PER_PAGE && (
            <nav className="pager" aria-label="Pagination">
              {offset > 0 && (
                <a href={`/collections/${handle}${offset - PER_PAGE > 0
                  ? `?offset=${offset - PER_PAGE}` : ''}`}>← Previous</a>
              )}
              <span>{offset + 1}–{shown} of {count.toLocaleString()}</span>
              {shown < count && (
                <a href={`/collections/${handle}?offset=${offset + PER_PAGE}`}>Next →</a>
              )}
            </nav>
          )}
        </div>
      </section>

      <RequestBlock source="collection" />
    </>
  )
}
