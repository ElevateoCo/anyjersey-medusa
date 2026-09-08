import { ContainerRegistrationKeys, Modules, ProductStatus } from '@medusajs/framework/utils'
import { createProductsWorkflow } from '@medusajs/medusa/core-flows'
import type { ExecArgs } from '@medusajs/framework/types'
import { readFileSync } from 'fs'
import { join } from 'path'
import { CATALOG_MODULE } from '../modules/catalog'
import { TEAM_LEAGUE, teamInTitle } from '../teams'

/**
 * Import the custom-jersey line.
 *
 *   npx medusa exec ./src/scripts/import-custom-jerseys.ts            # report only
 *   APPLY=1 npx medusa exec ./src/scripts/import-custom-jerseys.ts    # write
 *
 * These are blank shirts sold to be printed — one per team and colourway — and they did not
 * exist when the 2026-08-18 archive was taken. The live store runs them as a separate
 * product line at **$89.99 against a $64.99 base**, with the name and number **included in
 * the price**, and no personalisation control at all on its regular player jerseys.
 *
 * That is a different commercial shape from `personalisation-spec.md` §1, which prices
 * printing as an add-on. Both now exist here; `jersey_detail.is_custom` is what selects
 * between them, and `priceSelection(sel, { included })` is where it lands.
 *
 * Reads a snapshot in `data/custom-jerseys.json` rather than fetching at import time, so the
 * import is repeatable, reviewable in a diff, and does not depend on a third-party site
 * being up. Refresh it with the command in that file's `source` field.
 *
 * **Two products in the source collection are not custom jerseys.** `MINNESOTA VIKINGS
 * DALLAS TURNER RIVAL JERSEY` and `BUFFALO BILLS GREG ROUSSEAU GREY JERSEY` are ordinary
 * player shirts at $64.99 that have been mis-collected upstream. They are skipped and
 * named, because importing them would put a name-and-number control on two shirts that
 * already have a player's name on the back.
 */
type Snapshot = {
  source: string
  fetched_at: string
  products: {
    handle: string
    title: string
    product_type: string
    sizes: string[]
    prices: string[]
    image: string | null
    published_at: string | null
  }[]
}

const CUSTOM_PRICE_CENTS = 8999

/** Title Case for display; the source shouts everything, which breaks alt text and search. */
const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\s+/g, ' ').trim()

/**
 * Size normalisation.
 *
 * The source contains both `4XL` and `4Xl` — the same size written two ways, which would
 * become two variants of one shirt. Cheap to fix here, invisible if not.
 */
const normaliseSize = (s: string) => s.trim().toUpperCase()

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']
const sortSizes = (sizes: string[]) =>
  [...new Set(sizes.map(normaliseSize))].sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a), ib = SIZE_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b)
  })

/**
 * The colourway and edition vocabularies already in the catalog.
 *
 * Matched against, not extended. The first version of this function took everything left in
 * the title after the team and called it the colourway, which produced `White` alongside the
 * existing `white`, and invented colourways called `Rival`, `Throwback` and `Thanksgiving` —
 * splitting the colour facet in two and adding entries to it that are not colours. Both are
 * facet-level damage that is tedious to reverse once products are live.
 *
 * Ordered longest-first so `baby blue` wins over `blue` and `color rush` over `rush`.
 */
const COLOURWAYS = [
  'baby blue', 'kelly green', 'lime green', 'mint green', 'royal blue', 'burgundy',
  'creamsicle', 'crimson', 'maroon', 'orange', 'purple', 'yellow', 'beige', 'black',
  'brown', 'cream', 'green', 'navy', 'white', 'blue', 'gold', 'grey', 'pink', 'teal', 'red',
].sort((a, b) => b.length - a.length)

const EDITIONS = [
  'color rush', 'long sleeve', 'windbreaker', 'alternate', 'throwback', 'gradient',
  'rivalry', 'vintage', 'colorush', 'retro', 'rival', 'combo', 'game', 'home', 'away',
].sort((a, b) => b.length - a.length)

/**
 * Spellings the source uses that the catalog does not.
 *
 * `BURGANDY` is a typo on the live store. Importing it verbatim would put a second,
 * misspelled entry in the colour facet next to the one real `burgundy` product.
 */
const COLOUR_ALIASES: Record<string, string> = {
  burgandy: 'burgundy',
  burgundy: 'burgundy',
  gray: 'grey',
  charcoal: 'grey',
}

/**
 * Pull the team, colourway and edition out of a title like
 * `PITTSBURGH STEELERS CUSTOM BLACK COLOR RUSH JERSEY`.
 *
 * Team comes from the known-teams table rather than from position, because team names are
 * one, two or three words and a positional guess gets `NEW YORK GIANTS` wrong. Colour and
 * edition are then matched against the vocabularies above; anything left over is discarded
 * rather than stored, because an unrecognised word is not evidence of a new colour.
 */
function parseTitle(title: string): {
  team: string | null
  colourway: string | null
  edition: string | null
  leftover: string | null
} {
  // Longest match wins, so "NEW YORK GIANTS" is never shadowed by a shorter entry.
  const team = teamInTitle(title)

  let rest = title.toUpperCase()
  if (team) rest = rest.replace(team, ' ')
  rest = rest.replace(/\bCUSTOM\b/g, ' ')
    .replace(/\bJERSEYS?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  let edition: string | null = null
  for (const e of EDITIONS) {
    if (rest.includes(e)) { edition = e; rest = rest.replace(e, ' '); break }
  }

  let colourway: string | null = null
  const aliased = Object.keys(COLOUR_ALIASES).find((a) => rest.includes(a))
  if (aliased) {
    colourway = COLOUR_ALIASES[aliased]
    rest = rest.replace(aliased, ' ')
  } else {
    for (const c of COLOURWAYS) {
      if (rest.includes(c)) { colourway = c; rest = rest.replace(c, ' '); break }
    }
  }

  const leftover = rest.replace(/\s+/g, ' ').trim() || null
  return { team: team ? titleCase(team) : null, colourway, edition, leftover }
}

export default async function importCustomJerseys({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  const catalog: any = container.resolve(CATALOG_MODULE)
  const apply = process.env.APPLY === '1'

  const snapshot: Snapshot = JSON.parse(
    readFileSync(join(__dirname, 'data', 'custom-jerseys.json'), 'utf8')
  )

  // Skip anything that is not actually a blank. Both signals must agree: the title says
  // CUSTOM and the price is the custom price. Either alone lets a mis-collected shirt in.
  const candidates = snapshot.products.filter((p) => {
    const looksCustom = /\bCUSTOM\b/i.test(p.title)
    const pricedCustom = p.prices.includes('89.99')
    return looksCustom && pricedCustom
  })
  const skipped = snapshot.products.filter((p) => !candidates.includes(p))

  const { data: existing } = await query.graph({
    entity: 'product',
    fields: ['handle'],
    pagination: { take: 100000, skip: 0 },
  })
  const have = new Set((existing as any[]).map((p) => p.handle))
  const todo = candidates.filter((p) => !have.has(p.handle))

  logger.info('')
  logger.info(`  source            ${snapshot.source} (${snapshot.fetched_at})`)
  logger.info(`  in collection     ${snapshot.products.length}`)
  logger.info(`  custom jerseys    ${candidates.length}`)
  logger.info(`  not custom        ${skipped.length}${skipped.length ? ' — ' + skipped.map((s) => s.title).join('; ') : ''}`)
  logger.info(`  already imported  ${candidates.length - todo.length}`)
  logger.info(`  to import         ${todo.length}`)
  logger.info('')

  const unparsed = todo.filter((p) => !parseTitle(p.title).team)
  if (unparsed.length) {
    logger.warn(
      `  ${unparsed.length} title(s) with no recognised team — they will import with ` +
      'needs_review set rather than a guessed team: ' +
      unparsed.map((p) => p.title).join('; ')
    )
  }

  if (!todo.length) {
    logger.info('  nothing to do.')
    return
  }
  if (!apply) {
    for (const p of todo.slice(0, 8)) {
      const { team, colourway, edition, leftover } = parseTitle(p.title)
      logger.info(
        `    ${titleCase(p.title)}  ->  team=${team ?? '?'} colour=${colourway ?? '—'} ` +
        `edition=${edition ?? '—'}${leftover ? ` leftover="${leftover}"` : ''} ` +
        `sizes=${sortSizes(p.sizes).join('/')}`
      )
    }
    if (todo.length > 8) logger.info(`    … and ${todo.length - 8} more`)
    logger.info('')
    logger.info('  Report only. Re-run with APPLY=1 to write these.')
    return
  }

  const channels = await salesChannelModule.listSalesChannels()
  const channel = channels.find((c) => c.name === 'Web') ?? channels[0]
  if (!channel) throw new Error('no sales channel — run seed-spike.ts first')

  const { data: profiles } = await query.graph({ entity: 'shipping_profile', fields: ['id', 'name'] })
  const shippingProfileId = (profiles as any[])[0]?.id
  if (!shippingProfileId) throw new Error('no shipping profile — run seed-spike.ts first')

  const products = todo.map((p) => {
    const sizes = sortSizes(p.sizes)
    const title = titleCase(p.title)
    return {
      title,
      handle: p.handle,
      description:
        'A blank shirt, printed to order. Add a name and number and we print them — ' +
        'both are included in the price. Leave them blank and it ships plain.',
      status: ProductStatus.PUBLISHED,
      shipping_profile_id: shippingProfileId,
      weight: 200,
      // The image stays on the source CDN until `ingest-media.ts` pulls it in, so a failed
      // download cannot block the catalog. `repoint-media-urls.ts` moves them afterwards.
      ...(p.image ? { images: [{ url: p.image }], thumbnail: p.image } : {}),
      options: [{ title: 'SIZE', values: sizes }],
      variants: sizes.map((size) => ({
        title: size,
        // Deterministic and derived, so a re-run cannot mint a second SKU for one shirt.
        sku: `CUSTOM-${p.handle.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 40)}-${size}`,
        options: { SIZE: size },
        // Sourcing model: always buyable, never "sold out". research.md §12.1
        manage_inventory: false,
        prices: [{ amount: CUSTOM_PRICE_CENTS / 100, currency_code: 'usd' }],
      })),
      sales_channels: [{ id: channel.id }],
    }
  })

  const { result: created } = await createProductsWorkflow(container).run({
    input: { products: products as never },
  })

  // The detail row is what makes it a custom jersey rather than a shirt with CUSTOM in the
  // title, so it is written in the same run — a product without it would render as an
  // ordinary $89.99 jersey with no way to print anything on it.
  const details = await catalog.createJerseyDetails(
    (created as any[]).map((product) => {
      const source = todo.find((t) => t.handle === product.handle)!
      const { team, colourway, edition } = parseTitle(source.title)
      return {
        sport: 'football',
        league: team ? TEAM_LEAGUE[team.toUpperCase()] ?? 'NFL' : 'NFL',
        team,
        player: null,
        colourway,
        edition,
        garment: 'jersey',
        is_custom: true,
        // No team means no typeface, so it is flagged rather than guessed — the same rule
        // the personalisation eligibility check applies.
        needs_review: !team,
        review_notes: team ? null : ['team not recognised in title'],
        search_text: [team, colourway, edition, 'custom', 'blank', product.title]
          .filter(Boolean).join(' ').toLowerCase(),
        source_platform: 'shopify',
        source_handle: source.handle,
      }
    })
  )

  // `Modules.PRODUCT`, not the literal service name — the link registry is keyed by module
  // identifier, and the string that looks right ('productService') resolves to nothing.
  await link.create(
    (created as any[]).map((product, i) => ({
      [Modules.PRODUCT]: { product_id: product.id },
      [CATALOG_MODULE]: { jersey_detail_id: details[i].id },
    }))
  )

  logger.info('')
  logger.info('  ┌─ CUSTOM JERSEYS IMPORTED ───────────────────────────────')
  logger.info(`  │ products   ${created.length} at $${(CUSTOM_PRICE_CENTS / 100).toFixed(2)}`)
  logger.info(`  │ variants   ${products.reduce((n, p) => n + p.variants.length, 0)}`)
  logger.info(`  │ skipped    ${skipped.length} (not custom jerseys)`)
  logger.info('  └─────────────────────────────────────────────────────────')
  logger.info('')
  logger.info('  Images still point at the source CDN. Run ingest-media.ts to pull them in.')
}
