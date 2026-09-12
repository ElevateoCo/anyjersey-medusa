/** Thin typed client over the Medusa Store API. Server-side by default. */
const URL_BASE = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
const PK = process.env.NEXT_PUBLIC_MEDUSA_PK ?? ''
export const REGION_ID = process.env.NEXT_PUBLIC_REGION_ID ?? ''

export type Facet = { value: string; count: number }
/**
 * A team carries the league and the sport it sells in, paired off the catalogue rather
 * than mapped by hand. The navigation needs both and they are not the same grouping:
 * Barcelona is league CLUB and sport soccer, England is league SOCCER and sport soccer.
 */
export type TeamFacet = Facet & {
  league: string | null
  sport: string | null
  /**
   * A photograph of that team's own stock, for the navigation tile. Null when every
   * product for the team is unphotographed, which `Rail` falls back from.
   */
  image: string | null
}
/**
 * Athletes, bucketed by sport and capped per bucket by the endpoint.
 *
 * A flat top-N would be entirely NFL and would lose the athletes this facet exists for —
 * the MMA fighters carry one or two products each and no team at all.
 */
export type PlayerBucket = {
  sport: string | null
  players: (Facet & { team: string | null })[]
}
export type Facets = {
  total: number
  /** How many custom (blank, print-to-order) jerseys exist. A count, not a facet list. */
  custom: number
  leagues: Facet[]; teams: TeamFacet[]; sports: Facet[]
  colourways: Facet[]; garments: Facet[]; seasons: Facet[]
  players: PlayerBucket[]
}
export type Detail = {
  team?: string | null; player?: string | null; colourway?: string | null
  league?: string | null; season?: string | null; sport?: string | null
  garment?: string | null; seo_title?: string | null; seo_description?: string | null
  needs_review?: boolean
  /** A blank shirt sold to be printed, at $89.99 with the printing included. */
  is_custom?: boolean
  eu_responsible_person?: string | null; fibre_composition?: string | null
  country_of_origin?: string | null; care_instructions?: string | null
}
export type Card = {
  id: string; handle: string; title: string; thumbnail: string | null
  price: number | null; sizes: number; detail: Detail | null
}
export type Variant = {
  id: string; title: string; sku: string
  options?: { value: string; option_id?: string }[]
  calculated_price?: { calculated_amount: number } | null
}
export type Product = {
  id: string; title: string; handle: string; description: string | null
  thumbnail: string | null
  images?: { id: string; url: string }[]
  options?: { id: string; title: string; values?: { value: string }[] }[]
  variants: Variant[]
  jersey_detail?: Detail | null
}

async function get<T>(path: string, revalidate = 60): Promise<T> {
  const res = await fetch(`${URL_BASE}${path}`, {
    headers: { 'x-publishable-api-key': PK },
    next: { revalidate },
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export const getFacets = () => get<Facets>('/store/facets', 300)

/**
 * What this shirt can have printed on it, and at what price.
 *
 * Server-side so the control is in the initial HTML. Returns null rather than throwing:
 * a personalisation offer failing to load must not take a product page down with it.
 */
export const getPersonalisationOffer = (productId: string) =>
  get<PersonalisationOffer>(
    `/store/personalisation?product_id=${encodeURIComponent(productId)}`, 300
  ).catch(() => null)

export type PersonalisationOffer = {
  eligible: boolean
  reason: string | null
  /** True on a custom jersey: the name and number are already in the shirt's price. */
  included: boolean
  prices: Record<string, number>
  from: number
  typeface: string
  patches: string[]
  notice: { non_returnable: string; lead_time: string }
}

/**
 * An array value is appended as a repeated key, not comma-joined.
 *
 * `?garment=shorts&garment=set` reaches Express as an array, and the route hands the array
 * to MikroORM, which reads it as an IN. A comma would arrive as the single literal string
 * "shorts,set" and match nothing — an empty listing that looks exactly like an empty
 * catalogue, with no error anywhere. The "Shorts & Kits" nav slot is built on this.
 */
export function listJerseys(
  params: Record<string, string | string[] | number | undefined>
) {
  const qs = new URLSearchParams({ region_id: REGION_ID })
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue
    if (Array.isArray(v)) v.forEach((one) => one !== '' && qs.append(k, String(one)))
    else qs.set(k, String(v))
  }
  return get<{
    count: number; limit: number; offset: number; products: Card[]
    sort: string; sorts: string[]
  }>(`/store/jerseys?${qs}`)
}

export async function getProduct(handle: string): Promise<Product | null> {
  const qs = new URLSearchParams({
    handle,
    region_id: REGION_ID,
    fields: '*variants.calculated_price,*images,*options,*options.values,*variants.options,+jersey_detail.*',
  })
  const { products } = await get<{ products: Product[] }>(`/store/products?${qs}`)
  return products?.[0] ?? null
}

export const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL',
  '7XL', '8XL', '9XL', '10XL', 'YS', 'YM', 'YL', 'YXL', 'Y2XL', 'ONE']

/** The API returns variants unordered — a real spike finding. Always sort. */
export function sortSizes<T extends { title: string }>(vs: T[]): T[] {
  const rank = (t: string) => {
    const s = t.split('/')[0].trim().toUpperCase()
    const i = SIZE_ORDER.indexOf(s)
    return i === -1 ? 999 : i
  }
  return [...vs].sort((a, b) => rank(a.title) - rank(b.title) || a.title.localeCompare(b.title))
}

/**
 * Display formatting only.
 *
 * `toFixed(2)` delegates rounding to binary floating point, where 69.985 is actually
 * 69.98499… and renders as $69.98. Rounding to cents explicitly first makes the result
 * predictable. This is a display guard, not a substitute for the real rule: amounts must
 * be cent-precise before they get here (research.md §6.2, money as integer minor units).
 *
 * Returns an em dash for an unknown amount — showing $0.00 for "we don't know" is a
 * pricing bug on the page, not a formatting choice.
 */
/**
 * Resolve an image URL.
 *
 * Images live in Postgres and are served from /store/media/<sha256>.webp, so product
 * records hold a relative path. This prefixes the API origin and picks a width — widths
 * are rendered on demand rather than stored, so asking for a narrow one costs nothing in
 * database size.
 */
export function mediaUrl(
  url: string | null | undefined,
  width?: 200 | 400 | 800 | 1400,
  /**
   * Force a format. Only needed for `png`, and only by the Open Graph routes: Satori — the
   * renderer behind Next's `ImageResponse` — cannot decode WebP, so it fetched the shirt,
   * got bytes it could not read, and drew a share card with a blank panel. No error, on a
   * route only crawlers request. Browsers should keep the default.
   */
  format?: 'png' | 'jpg'
): string | null {
  if (!url) return null
  let abs = url.startsWith('http') ? url : `${URL_BASE}${url}`
  // '/media/' not '/store/media/': everything under /store needs the publishable-key
  // header, which an <img> cannot send, so image bytes are served from a root route.
  if (!abs.includes('/media/')) return abs
  if (format) abs = abs.replace(/\.(webp|jpe?g|png|avif)(?=$|\?)/i, `.${format}`)
  if (!width) return abs
  return `${abs}${abs.includes('?') ? '&' : '?'}w=${width}`
}

/** srcset for a content-addressed asset. Cheap: nothing extra is stored per width. */
export function mediaSrcSet(url: string | null | undefined): string | undefined {
  if (!url || !url.includes('/media/')) return undefined
  return ([200, 400, 800, 1400] as const)
    .map((w) => `${mediaUrl(url, w)} ${w}w`)
    .join(', ')
}

export const money = (n: number | null | undefined) =>
  n == null ? '—' : `$${(Math.round(n * 100) / 100).toFixed(2)}`

export type SitemapIndex = {
  products: { handle: string; updated_at: string }[]
  leagues: string[]
  teams: string[]
}

/**
 * Handles and last-modified dates for the whole published catalog, in one request.
 *
 * Returns an empty index rather than throwing. A backend that is down must produce an
 * empty `sitemap.xml`, not a 500 — Next would otherwise serve an error page at
 * `/sitemap.xml`, and a crawler reading HTML where XML was promised treats the file as
 * broken for longer than the outage lasted.
 */
export const getSitemapIndex = () =>
  get<SitemapIndex>('/store/sitemap', 3600).catch(() => ({
    products: [], leagues: [], teams: [],
  }))

export type ZoneCard = {
  zone: number
  name: string
  rate: number
  freeOver: number
  countries: number
  country_codes: string[]
  leadTime: string
}

/**
 * The whole zone rate card.
 *
 * Lives here rather than in `lib/cart.ts` on purpose: `cart.ts` imports `next/headers` and
 * is therefore server-only, and a client component importing it pulls that into the browser
 * bundle and 500s every page. That has happened twice (Steps 17 and 22) and is now pinned by
 * `lib/line-groups.test.ts`. Nothing about a public rate card needs a cookie, so it belongs
 * on the side of the boundary anything can import.
 */
export const getZones = () =>
  /**
   * 60 seconds, not an hour.
   *
   * `backend/src/shipping-zones.ts` exists so the storefront "can never show a rate or
   * threshold that disagrees with what checkout actually charges" — and a one-hour cache
   * put a one-hour window under that sentence. Observed, not theorised: the rate card was
   * changed and this page kept publishing the old thresholds until the entry expired.
   *
   * The card is five rows and changes about twice a year, so the hour was buying nothing
   * measurable and costing the guarantee the module is named for.
   */
  get<{ zones: ZoneCard[] }>('/store/shipping-zones', 60)
    .then((r) => r.zones)
    .catch(() => [] as ZoneCard[])

export type Region = {
  id: string
  name: string
  currency_code: string
  countries?: { iso_2: string; display_name?: string }[]
}

/**
 * The regions the shop actually has.
 *
 * All five exist in the database already — United States, Canada, United Kingdom, Europe,
 * Asia Pacific, with their countries mapped — and matched the shipping zones from the day
 * those were seeded. Only the storefront was locked to one, through a single
 * `NEXT_PUBLIC_REGION_ID`.
 *
 * A note on currency, so the switcher is not mistaken for something it is not: every region
 * is priced in USD today. Switching region changes the shipping zone, the tax treatment and
 * which countries checkout will accept — which is the part that was actually broken. It does
 * not convert prices, and the picker does not imply it does. Real multi-currency needs price
 * lists per region and is a pricing decision, not a UI one.
 */
export const getRegions = () =>
  get<{ regions: Region[] }>('/store/regions?fields=id,name,currency_code,*countries', 3600)
    .then((r) => r.regions ?? [])
    .catch(() => [] as Region[])

export type ReviewAggregate = { count: number; average: number | null }

/**
 * The approved-review aggregate, server-side.
 *
 * Fetched here so `aggregateRating` can be emitted in structured data **only when real
 * reviews exist**. Google treats a fabricated rating as spam and the FTC treats it as a
 * misrepresentation at $51,744 a violation, so the field is absent rather than zeroed when
 * there is nothing to count. The backend computes the average from the same approved set it
 * returns, so the rich result and the reviews under it cannot disagree.
 */
export const getReviewAggregate = (productId: string) =>
  get<{ count: number; average: number | null }>(
    `/store/reviews?product_id=${encodeURIComponent(productId)}`, 300
  )
    .then((r) => ({ count: r.count ?? 0, average: r.average ?? null }))
    .catch(() => ({ count: 0, average: null }))

export type StoreReviews = {
  count: number
  average: number | null
  distribution: { stars: number; count: number }[]
  sources: { source: string; count: number }[]
  reviews: {
    id: string; rating: number; title: string | null; body: string
    author: string; source: string; reviewed_at: string
  }[]
  disclosure: string
}

/**
 * The store-wide review aggregate — 84 reviews carried over from eBay, Depop and Facebook
 * Marketplace, averaging 4.94.
 *
 * **Store scope only.** This number must never appear on a product page as that product's
 * rating: research.md §12.7 records the reference storefront showing 137,135 reviews on its
 * homepage and 8,342 on a product page, which is the Omnibus violation in one screenshot.
 * `getReviewAggregate(productId)` is the only thing that answers for a product.
 */
export const getStoreReviews = (limit = 12) =>
  get<StoreReviews>(`/store/store-reviews?limit=${limit}`, 600).catch(() => null)

export type CuratedCollection = {
  handle: string
  title: string
  description: string | null
  count: number
}

/**
 * The editorial collections.
 *
 * Facet navigation answers "Chicago Bears shirts" from data; these answer "what is selling"
 * and "the World Cup range", which no property of a product implies. They are a different
 * kind of navigation, not a competing one — the leagues stay facets.
 *
 * `curated-collections`, not `collections`: Medusa owns the latter path and its validator
 * rejects any query parameter it does not recognise.
 */
export const getCollections = () =>
  get<{ collections: CuratedCollection[] }>('/store/curated-collections', 600)
    .then((r) => r.collections ?? [])
    .catch(() => [] as CuratedCollection[])

export const getCollection = (handle: string, params: Record<string, string | number> = {}) => {
  const qs = new URLSearchParams({ region_id: REGION_ID })
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v))
  return get<{
    collection: { handle: string; title: string; description: string | null }
    count: number; limit: number; offset: number; products: Card[]
  }>(`/store/curated-collections/${encodeURIComponent(handle)}?${qs}`, 300)
    .catch(() => null)
}

/**
 * Where an old Shopify handle should redirect to, or null.
 *
 * Returns null on anything unexpected — a 404, a network failure, a malformed body. A
 * redirect lookup that throws would turn a 404 into a 500, which is worse for a crawler than
 * the 404 it was trying to fix.
 */
export const resolveOldHandle = async (handle: string): Promise<string | null> => {
  if (!handle) return null
  const data = await get<{ found: boolean; handle?: string }>(
    `/store/resolve-handle?handle=${encodeURIComponent(handle)}`,
    3600
  ).catch(() => null)
  return data?.found && data.handle ? data.handle : null
}
