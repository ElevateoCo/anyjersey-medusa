import { SITE_NAME, SITE_URL, abs } from './site'

/**
 * Structured data.
 *
 * research.md §12.3 makes the product page the site; structured data is how a crawler and
 * an AI answer engine read that page. Three rules, all of them learned from the FTC and
 * UCPD material in §7.10 rather than from SEO advice:
 *
 *  1. **Never emit a field we cannot substantiate.** No `aggregateRating` unless real
 *     reviews exist, no `priceValidUntil` we do not honour, no invented `sku` or `gtin`.
 *     A rich result is a public claim; a wrong one is an actionable misrepresentation, and
 *     Google's own policy treats fabricated ratings as spam.
 *  2. **Availability reflects the sourcing model.** Nothing here is stock-tracked
 *     (`manage_inventory: false`), so the honest value is `BackOrder` with a lead time,
 *     not `InStock`.
 *  3. **The JSON is derived from the same values the page renders.** A price in the markup
 *     that differs from the price on screen is the classic structured-data penalty.
 */
export type JsonLdValue = Record<string, unknown>

/** `<script type="application/ld+json">` content, escaped for inline embedding. */
export function jsonLdString(value: JsonLdValue | JsonLdValue[]): string {
  // `</script>` inside a string literal would close the element; `<` is escaped rather
  // than the sequence, because `<\/script`, `</script` and casing variants all end
  // the element too. U+2028/29 are legal in JSON and illegal in a JS string literal.
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export const organisation = (): JsonLdValue => ({
  '@context': 'https://schema.org',
  '@type': 'OnlineStore',
  '@id': `${SITE_URL}/#store`,
  name: SITE_NAME,
  url: SITE_URL,
  // No logo, no sameAs, no telephone: none of them exist yet, and a schema.org field
  // pointing at nothing is worse than an absent one.
})

export const website = (): JsonLdValue => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  publisher: { '@id': `${SITE_URL}/#store` },
  potentialAction: {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/jerseys?q={query}` },
    'query-input': 'required name=query',
  },
})

export const breadcrumbs = (trail: { name: string; path: string }[]): JsonLdValue => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: trail.map((t, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: t.name,
    item: abs(t.path),
  })),
})

export type ProductSeo = {
  handle: string
  title: string
  description?: string | null
  image?: string | null
  price: number | null
  currency: string
  sizes: string[]
  brand?: string | null
  reviews?: { count: number; average: number } | null
  leadTime?: string | null
}

export function productSchema(p: ProductSeo): JsonLdValue {
  const url = abs(`/jerseys/${p.handle}`)
  const node: JsonLdValue = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: p.title,
    url,
    ...(p.description ? { description: p.description } : {}),
    ...(p.image ? { image: [p.image] } : {}),
    ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
    ...(p.sizes.length ? { size: p.sizes } : {}),
  }

  if (p.price != null) {
    node.offers = {
      '@type': 'Offer',
      url,
      priceCurrency: p.currency.toUpperCase(),
      // Two decimals as a string: schema.org wants a number without grouping separators,
      // and a float here reintroduces exactly the rounding problem §6.2 is about.
      price: p.price.toFixed(2),
      // Rule 2 above. Nothing is stock-tracked, so BackOrder is the truthful value.
      availability: 'https://schema.org/BackOrder',
      ...(p.leadTime ? { deliveryLeadTime: p.leadTime } : {}),
      seller: { '@id': `${SITE_URL}/#store` },
    }
  }

  // Rule 1: emitted only when there is something real to count.
  if (p.reviews && p.reviews.count > 0) {
    node.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: p.reviews.average.toFixed(1),
      reviewCount: p.reviews.count,
      bestRating: 5,
      worstRating: 1,
    }
  }

  return node
}
