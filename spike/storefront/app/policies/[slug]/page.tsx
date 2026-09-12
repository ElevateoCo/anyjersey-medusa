import { notFound } from 'next/navigation'
import Prose from '@/components/Prose'
import YourRights from '@/components/YourRights'
import { POLICIES, policyBySlug } from '@/lib/policies'
import { getVisitorGeo } from '@/lib/geo'
import { jurisdictionFor } from '@/lib/jurisdiction'
import { abs } from '@/lib/site'

/**
 * The legal documents, at stable URLs.
 *
 * `generateStaticParams` enumerates the three slugs so unknown ones 404 at the routing layer
 * rather than reaching the page. `dynamicParams = false` is what makes that a 404 instead of
 * an on-demand render.
 *
 * These pages are *not* statically rendered, and cannot be: the root layout reads the cart,
 * region and session cookies, so every route in this app is dynamic. The property that
 * actually matters here is met a different way — the documents are plain data in
 * `lib/policies.ts`, not a backend fetch, so a policy page still renders during an outage,
 * which is exactly when somebody is most likely looking for it. An earlier version asserted
 * `dynamic = 'error'` to pin that and simply 500'd on all three, which is a good argument for
 * checking what an assertion asserts.
 */
export const dynamicParams = false

export function generateStaticParams() {
  return POLICIES.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const doc = policyBySlug(slug)
  if (!doc) return { title: 'Not found' }
  return {
    title: doc.title,
    description: doc.summary,
    alternates: { canonical: abs(`/policies/${doc.slug}`) },
    openGraph: { title: doc.title, description: doc.summary, url: abs(`/policies/${doc.slug}`) },
  }
}

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const doc = policyBySlug(slug)
  if (!doc) notFound()

  /**
   * The privacy policy gets a panel naming the reader's own law; the other documents do
   * not, because their terms do not vary that way.
   *
   * The panel goes **inside** the document, in `Prose`'s slot between the title and the
   * sections. The first version put it in its own band above, which read correctly and was
   * wrong in the markup: the page then opened `h2` before `h1`. The accessibility checker
   * passed it — it looks for skips going down, not for a heading that precedes the
   * document's own — so this is one the gate did not catch.
   *
   * The document below it is unchanged and complete. Nothing is hidden from anyone and no
   * obligation is edited out per visitor: a regulator opening this URL sees the same policy
   * a customer does. What varies is which part is put first and labelled as theirs, which
   * is presentation, not a different policy.
   */
  if (doc.slug !== 'privacy') return <Prose doc={doc} />

  const geo = await getVisitorGeo()
  const j = jurisdictionFor(geo.country, geo.region)
  return (
    <Prose doc={doc}>
      <YourRights j={j} />
    </Prose>
  )
}
