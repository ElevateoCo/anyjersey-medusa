import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'

/**
 * Strip import artefacts from product titles.
 *
 *   npx medusa exec ./src/scripts/fix-title-artefacts.ts            # report only
 *   APPLY=1 npx medusa exec ./src/scripts/fix-title-artefacts.ts    # write
 *
 * 56 live titles carry **U+FFFC OBJECT REPLACEMENT CHARACTER**, left behind by the Shopify
 * export where a rich-text title had an inline object in it. It is invisible in a database
 * client and renders as a tombstone box wherever a real font is asked to draw it.
 *
 * It was found by looking at a generated Open Graph image, which is the only surface that
 * draws the title with no HTML fallback to hide behind — the same string was already going
 * into `<title>`, the JSON-LD `name`, and every share card and search result.
 *
 * The other characters here are the rest of the family that behaves the same way: zero-width
 * spaces and joiners, the BOM, the bidirectional marks, and the soft hyphen. All of them
 * survive a copy-paste, none of them is visible while editing, and each one breaks an exact
 * title match — which this catalog depends on for both deduplication and review attribution.
 *
 * Report-only by default, like the rest of the catalog tooling. It prints what it would
 * change and touches nothing until `APPLY=1`.
 */
const ARTEFACTS = [
  '￼', // object replacement character — the 56 found here
  '�', // replacement character, from a decoding failure upstream
  '​', // zero-width space
  '‌', // zero-width non-joiner
  '‍', // zero-width joiner
  '﻿', // BOM / zero-width no-break space
  '‎', // left-to-right mark
  '‏', // right-to-left mark
  '­', // soft hyphen
]

const PATTERN = new RegExp(`[${ARTEFACTS.join('')}]`, 'g')

/**
 * Remove the artefacts, then repair the whitespace they leave behind.
 *
 * Deleting a character from the middle of "Rivalry Jersey ￼" leaves a trailing space, and
 * one in "Jersey ￼ Blue" leaves a double space. Both break the exact-title matching that
 * deduplication and review attribution rely on, so the collapse is part of the fix rather
 * than cosmetic.
 */
export const clean = (s: string): string =>
  s.replace(PATTERN, '').replace(/\s+/g, ' ').trim()

export default async function fixTitleArtefacts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const pg: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const apply = process.env.APPLY === '1'

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle', 'title', 'description'],
    filters: { status: 'published' },
    pagination: { take: 100000, skip: 0 },
  })

  const dirty = (products as any[]).filter(
    (p) =>
      (p.title && clean(p.title) !== p.title) ||
      (p.description && clean(p.description) !== p.description)
  )

  if (!dirty.length) {
    logger.info('No import artefacts in any published product title or description.')
    return
  }

  logger.info(`${dirty.length} product(s) carry invisible import artefacts:`)
  for (const p of dirty.slice(0, 10)) {
    logger.info(`  ${p.handle}`)
    if (p.title && clean(p.title) !== p.title) {
      // Codepoints, because the whole problem is that the characters do not print.
      const codes = [...p.title]
        .filter((c) => PATTERN.test(c))
        .map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'))
      logger.info(`    title: "${p.title}" -> "${clean(p.title)}"  [${codes.join(', ')}]`)
    }
  }
  if (dirty.length > 10) logger.info(`  … and ${dirty.length - 10} more`)

  if (!apply) {
    logger.info('Report only. Re-run with APPLY=1 to write these changes.')
    return
  }

  // Raw SQL rather than the product module: this is a character-level repair of existing rows, and
  // going through the module would fire product-updated events for 56 products and
  // re-index everything for a change no downstream consumer cares about.
  let titles = 0
  let descriptions = 0
  for (const p of dirty) {
    if (p.title && clean(p.title) !== p.title) {
      await pg.raw('update product set title = ? where id = ?', [clean(p.title), p.id])
      titles++
    }
    if (p.description && clean(p.description) !== p.description) {
      await pg.raw('update product set description = ? where id = ?', [
        clean(p.description),
        p.id,
      ])
      descriptions++
    }
  }

  // jersey_detail carries its own copies for SEO, and they are what the meta tags use.
  const seo = await pg.raw(
    `update jersey_detail
        set seo_title = regexp_replace(seo_title, ?, '', 'g'),
            seo_description = regexp_replace(seo_description, ?, '', 'g')
      where seo_title ~ ? or seo_description ~ ?`,
    [PATTERN.source, PATTERN.source, PATTERN.source, PATTERN.source]
  )

  logger.info(
    `Cleaned ${titles} title(s), ${descriptions} description(s), ` +
      `${seo?.rowCount ?? 0} jersey_detail row(s).`
  )
}
