import { notFound } from 'next/navigation'
import Prose from '@/components/Prose'
import { POLICIES, policyBySlug } from '@/lib/policies'
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
  return <Prose doc={doc} />
}
