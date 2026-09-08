import { resolveOldHandle } from '@/lib/medusa'
import { permanentRedirect } from 'next/navigation'

/**
 * `/products/<handle>` — the shape every URL on the old shop had.
 *
 * Shopify serves products at `/products/…` and this store serves them at `/jerseys/…`, so
 * every inbound link, every indexed page and every share of the live store points at a path
 * that does not exist here. The handle usually changed too: the import generated fresh slugs
 * and 1,083 of 3,155 products came out with a different one.
 *
 * So this route does both halves of the move at once — the path shape and the slug — and
 * answers **308**, which is what `permanentRedirect` sends. Google treats 308 exactly as it
 * treats 301: the ranking follows.
 *
 * A handle with no mapping goes to the listing rather than to a 404. Somebody arriving from a
 * two-year-old link to a shirt that is no longer stocked is a shopper, and a catalogue of
 * 4,300 others is a better answer than a dead end.
 */
export const dynamic = 'force-dynamic'

export default async function ShopifyProductRedirect(
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params
  const resolved = await resolveOldHandle(handle)

  // Falls through to the same handle when nothing maps: a product whose slug never changed
  // still lives at /jerseys/<handle>, and that page 404s honestly if it does not.
  permanentRedirect(resolved ? `/jerseys/${resolved}` : `/jerseys/${handle}`)
}
