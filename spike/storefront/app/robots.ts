import type { MetadataRoute } from 'next'
import { INDEXABLE, SITE_URL } from '@/lib/site'

/**
 * robots.txt
 *
 * Indexing is **opt-in per environment** (`NEXT_PUBLIC_ALLOW_INDEXING=true`). A staging
 * copy that lets crawlers in competes with the real store for its own keywords, and
 * nothing about the failure is visible until rankings move.
 *
 * What is *not* here, deliberately: any attempt to filter facet combinations. A
 * 3,155-product catalog with six facet dimensions generates more filter permutations than
 * it has products, and a crawler that spends its budget on
 * `?colourway=white&season=2019` never reaches the pages that rank. But robots.txt cannot
 * express "one parameter is fine, three are not", and — more importantly — `Disallow`
 * stops the crawl, which means the `noindex` on the page is never read and the URL can
 * still be indexed from an external link. Crawl-level rules cannot deindex.
 *
 * So the facet rule lives in `generateMetadata` on the listing page as `noindex, follow`:
 * the crawler reads the page, drops it from the index, and still follows through to the
 * product pages. This file only blocks paths that must never be fetched at all.
 */
export default function robots(): MetadataRoute.Robots {
  if (!INDEXABLE) {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Per-customer or transactional. Nothing here is a ranking candidate and a
        // crawler fetching /checkout creates carts.
        disallow: ['/cart', '/checkout', '/account', '/order/', '/track'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
