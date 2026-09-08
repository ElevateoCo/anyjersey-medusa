import { createHash } from 'crypto'

/**
 * Turning what an admin form can express into what Medusa and the catalog module need.
 *
 * Kept out of the route so it can be unit-tested without a database, because most of what
 * can go wrong with "create a product" is here rather than in the persistence: a handle
 * that collides, a size list with a duplicate in it, a price typed as "65,99", a title
 * that produces an empty slug.
 *
 * The shape mirrors what `scripts/import-catalog.ts` builds from `catalog.json`, on
 * purpose. A jersey created by hand in the admin and a jersey imported from the archive
 * have to be the same kind of thing — same option structure, same SKU shape, same
 * `search_text` folding — or the facets, the listing and the free-text search treat them
 * differently and nobody finds out until a customer cannot see the product they were told
 * about.
 */

/** The size run the catalogue uses. A jersey with different sizes passes its own list. */
export const DEFAULT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'] as const

/**
 * Sizes in wearing order, not the order the database happened to return them.
 *
 * Medusa returns variants unordered — a spike finding the storefront already has a
 * `sortSizes` for — so an admin form built straight off the API shows "L, 3XL, M, S" and
 * the operator reasonably concludes the product is broken. Anything outside the known run
 * sorts to the end alphabetically rather than being dropped, because an unrecognised size
 * is still a size somebody has to see.
 */
const SIZE_ORDER = ['XS', ...DEFAULT_SIZES, '4XL', '5XL']
export const sortSizes = (sizes: string[]): string[] =>
  [...sizes].sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a.toUpperCase())
    const ib = SIZE_ORDER.indexOf(b.toUpperCase())
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })

/**
 * Accent-folding, matching `/store/jerseys` and the Python importer exactly.
 *
 * "Romário" is stored as `romario` so that searching for either spelling finds it. Folding
 * at write time rather than at query time is what lets the trigram index do the work.
 */
export const fold = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** URL slug. Returns null when the input cannot produce one, rather than an empty string. */
export function slugify(input: string): string | null {
  const slug = fold(input)
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/, '')
  return slug || null
}

/**
 * The folded haystack `/store/jerseys?q=` searches.
 *
 * Field order matches the importer's — team, player, colourway, season, sport, garment —
 * which does not affect matching but does make a hand-created row diffable against an
 * imported one.
 */
export function searchText(t: {
  team?: string | null; player?: string | null; colourway?: string | null
  season?: string | null; sport?: string | null; garment?: string | null
}): string {
  return [t.team, t.player, t.colourway, t.season, t.sport, t.garment]
    .filter(Boolean)
    .map((v) => fold(String(v)))
    .filter(Boolean)
    .join(' ')
}

/**
 * A stable SKU stem for a handle, in the catalogue's existing `AJ-2F480-S` shape.
 *
 * Derived from the handle rather than from a counter so it can be recomputed — a counter
 * would need its own table and would produce a different SKU if a product were ever
 * recreated. Five hex characters over a catalogue of this size is a collision risk on the
 * order of one in a million per pair, and a SKU is a label rather than a key.
 */
export const skuStem = (handle: string) =>
  `AJ-${createHash('sha1').update(handle).digest('hex').slice(0, 5).toUpperCase()}`

export type JerseyInput = {
  title?: unknown
  handle?: unknown
  description?: unknown
  status?: unknown
  price?: unknown
  sizes?: unknown
  images?: unknown
  is_custom?: unknown
  team?: unknown; league?: unknown; player?: unknown; colourway?: unknown
  season?: unknown; edition?: unknown; garment?: unknown; sport?: unknown
  seo_title?: unknown; seo_description?: unknown
  needs_review?: unknown
}

export type NormalisedJersey = {
  title: string
  handle: string
  description: string | null
  status: 'published' | 'draft'
  price: number
  sizes: string[]
  images: string[]
  taxonomy: {
    team: string | null; league: string | null; player: string | null
    colourway: string | null; season: string | null; edition: string | null
    garment: string; sport: string | null
  }
  is_custom: boolean
  needs_review: boolean
  seo_title: string | null
  seo_description: string | null
  search_text: string
}

export class JerseyValidationError extends Error {}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * Validate and normalise a form submission.
 *
 * Everything that throws here is something a person can fix in the form, and the message is
 * written to be shown to them rather than logged. Anything that can be defaulted sensibly is
 * defaulted rather than rejected — an admin creating a jersey should not have to know that
 * `garment` exists.
 */
export function normaliseJersey(input: JerseyInput, opts: { partial?: boolean } = {}):
  NormalisedJersey | Partial<NormalisedJersey> {
  const title = str(input.title)
  if (!opts.partial && !title) {
    throw new JerseyValidationError('A title is required.')
  }

  const handle = str(input.handle) ?? (title ? slugify(title) : null)
  if (!opts.partial && !handle) {
    throw new JerseyValidationError(
      'That title does not produce a usable web address. Give the jersey a handle.'
    )
  }
  if (handle && !/^[a-z0-9][a-z0-9-]*$/.test(handle)) {
    throw new JerseyValidationError(
      'A handle may contain only lowercase letters, numbers and hyphens.'
    )
  }

  // Accepts "65.99", "$65.99" and 65.99. Rejects "65,99" rather than reading it as 65 —
  // a price silently truncated by a decimal separator is the worst possible outcome here.
  const rawPrice = input.price
  let price: number | undefined
  if (rawPrice !== undefined && rawPrice !== null && rawPrice !== '') {
    const cleaned = String(rawPrice).replace(/[$\s]/g, '')
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      throw new JerseyValidationError(
        `"${String(rawPrice)}" is not a price. Use a number like 65.99.`
      )
    }
    price = Number(cleaned)
    if (price <= 0) throw new JerseyValidationError('A price must be greater than zero.')
  }
  if (!opts.partial && price === undefined) {
    throw new JerseyValidationError('A price is required.')
  }

  let sizes: string[] | undefined
  if (input.sizes !== undefined) {
    const list = Array.isArray(input.sizes) ? input.sizes : String(input.sizes).split(',')
    sizes = list.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
    if (!sizes.length) throw new JerseyValidationError('At least one size is required.')
    const seen = new Set<string>()
    for (const s of sizes) {
      if (seen.has(s)) {
        throw new JerseyValidationError(`Size "${s}" is listed twice.`)
      }
      seen.add(s)
    }
  } else if (!opts.partial) {
    sizes = [...DEFAULT_SIZES]
  }

  // Images arrive as media URLs the upload endpoint already returned. Anything else is
  // refused: an arbitrary URL here would embed a third-party host in the storefront's
  // image tags and in its CSP, which is a decision, not a form field.
  let images: string[] | undefined
  if (input.images !== undefined) {
    const list = Array.isArray(input.images) ? input.images : []
    images = list.map((u) => String(u).trim()).filter(Boolean)
    for (const u of images) {
      if (!/^\/media\/[0-9a-f]{64}\.webp$/.test(u)) {
        throw new JerseyValidationError(
          `"${u}" is not an uploaded image. Images must come from the upload endpoint.`
        )
      }
    }
    if (new Set(images).size !== images.length) {
      throw new JerseyValidationError('The same image is attached twice.')
    }
  } else if (!opts.partial) {
    images = []
  }

  const statusRaw = str(input.status)
  if (statusRaw && statusRaw !== 'published' && statusRaw !== 'draft') {
    throw new JerseyValidationError('Status must be "published" or "draft".')
  }

  const taxonomy = {
    team: str(input.team),
    league: str(input.league)?.toUpperCase() ?? null,
    player: str(input.player),
    colourway: str(input.colourway)?.toLowerCase() ?? null,
    season: str(input.season),
    edition: str(input.edition),
    garment: str(input.garment)?.toLowerCase() ?? 'jersey',
    sport: str(input.sport)?.toLowerCase() ?? null,
  }

  const out: Partial<NormalisedJersey> = {
    ...(title ? { title } : {}),
    ...(handle ? { handle } : {}),
    ...(input.description !== undefined ? { description: str(input.description) } : {}),
    ...(statusRaw ? { status: statusRaw as 'published' | 'draft' } : {}),
    ...(price !== undefined ? { price } : {}),
    ...(sizes ? { sizes } : {}),
    ...(images ? { images } : {}),
    ...(input.seo_title !== undefined ? { seo_title: str(input.seo_title) } : {}),
    ...(input.seo_description !== undefined
      ? { seo_description: str(input.seo_description) } : {}),
    is_custom: input.is_custom === true || input.is_custom === 'true',
    needs_review: input.needs_review === true || input.needs_review === 'true',
    taxonomy,
    search_text: searchText(taxonomy),
  }

  if (!opts.partial) {
    out.status = out.status ?? 'draft'
    out.description = out.description ?? null
    out.seo_title = out.seo_title ?? null
    out.seo_description = out.seo_description ?? null
    return out as NormalisedJersey
  }
  return out
}

/**
 * The Medusa product payload, shaped exactly as the importer shapes it.
 *
 * `manage_inventory: false` is the sourcing model, not an oversight: nothing here is stock
 * tracked, so a variant must never be able to go out of stock (research.md §12.1). A single
 * `Size` option, because that is what the catalogue has — the storefront splits a variant
 * title on `/` and falls back to "Unisex" when there is no second part.
 */
export function toProductPayload(
  j: NormalisedJersey,
  ctx: { shippingProfileId: string; salesChannelId: string }
) {
  const stem = skuStem(j.handle)
  return {
    title: j.title,
    handle: j.handle,
    description: j.description ?? undefined,
    status: j.status,
    shipping_profile_id: ctx.shippingProfileId,
    weight: 200,
    images: j.images.map((url) => ({ url })),
    thumbnail: j.images[0],
    options: [{ title: 'Size', values: j.sizes }],
    variants: j.sizes.map((size) => ({
      title: size,
      sku: `${stem}-${size}`,
      options: { Size: size },
      manage_inventory: false,
      prices: [{ amount: j.price, currency_code: 'usd' }],
    })),
    sales_channels: [{ id: ctx.salesChannelId }],
  }
}

/** The catalog-module row. The regulatory block stays null — §13.5, it is not guessable. */
export function toDetailPayload(j: NormalisedJersey) {
  return {
    ...j.taxonomy,
    search_text: j.search_text,
    seo_title: j.seo_title,
    seo_description: j.seo_description,
    needs_review: j.needs_review,
    is_custom: j.is_custom,
    source_platform: 'admin',
    source_handle: j.handle,
  }
}
