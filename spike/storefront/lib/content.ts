import type { Doc } from './prose'
import { TERMS } from './policies'

/**
 * The help pages: shipping, returns, size guide.
 *
 * These are the three links that were dead text in the footer. Two of them could not be
 * written as static prose without lying, so they are not:
 *
 *  - **Shipping** reads the zone rate card from `/store/shipping-zones` at request time.
 *    It is the same source checkout charges from (backend `src/shipping-zones.ts`), which
 *    is the whole reason the cart stopped hardcoding $4.99 and a $75 threshold.
 *  - **Size guide** needs chest and length measurements that only the supplier has. The
 *    table is therefore rendered from `MEASUREMENTS` — empty today — and the page says
 *    plainly that the numbers are missing rather than printing a generic apparel chart.
 *    That matters more under a final-sale policy than it did under the free-exchange model:
 *    a customer who orders the wrong size cannot send it back, so a guessed chart would not
 *    cost us a return, it would cost them the shirt.
 *
 * `CONTENT_PAGES` is the registry the footer and the sitemap both read, so a page cannot
 * exist without being linked or be linked without existing.
 */
export const CONTENT_PAGES = [
  {
    path: '/shipping',
    title: 'Shipping & delivery',
    summary: 'Where we ship, what it costs, how long it takes, and who pays the duty.',
  },
  {
    path: '/returns',
    title: 'Returns & exchanges',
    summary:
      `Faulty, damaged or wrong item? Tell us within ${TERMS.windowDays} days and we will ` +
      'put it right. Start it here.',
  },
  {
    path: '/size-guide',
    title: 'Size guide',
    summary: 'How jersey sizing runs, and how to pick between two sizes.',
  },
  {
    path: '/contact',
    title: 'Contact',
    summary: 'Email us or fill out the form. A person reads every message.',
  },
] as const

/**
 * Legal pages that are not policy documents.
 *
 * `/privacy-choices` is the US state opt-out page. It sits with the policies in the footer
 * because that is where a reader looks for it, but it is a page with a control on it rather
 * than a document, so it is not in `POLICIES`.
 */
export const LEGAL_PAGES = [
  {
    path: '/privacy-choices',
    title: 'Your Privacy Choices',
    summary: 'Opt out of the sale or sharing of your personal information.',
  },
] as const

/**
 * Garment measurements, in inches, laid flat.
 *
 * **Empty on purpose.** research.md §13.5 and the README's open-items list both name this
 * as one supplier email. Until it arrives the size guide shows what it does know — how
 * sizing behaves, and how to choose between two sizes — and marks the numbers as
 * outstanding. A guessed chart on a store that pays for size exchanges converts a data gap
 * into a return.
 */
export type Measurement = { size: string; chest: number | null; length: number | null }
export const MEASUREMENTS: Measurement[] = []

export const SIZE_GUIDE: Doc = {
  slug: 'size-guide',
  title: 'Size guide',
  summary: 'How jersey sizing runs, and how to pick between two sizes.',
  updated: '2026-08-28',
  sections: [
    {
      title: 'How to choose',
      blocks: [
        {
          p: 'Football and basketball jerseys are cut to be worn over other layers, so they run large. Soccer shirts are cut closer to the body, and a "player issue" or "authentic" version is closer still than the replica. If you are between two sizes, the rule that is right more often than not: size down on an American football or basketball jersey, size up on an authentic soccer shirt.',
        },
        {
          p: 'Retro and reissue shirts follow the sizing of the year they reproduce, which for most 1990s kits means noticeably boxier than a modern shirt of the same nominal size.',
        },
      ],
    },
    {
      title: 'If you are between two sizes',
      blocks: [
        {
          p: 'All sales are final, and an incorrect size ordered is not something we can take back — so it is worth a minute here. If you tell us the chest measurement of a shirt that already fits you, we will match it by hand before dispatch rather than leaving you to guess from a size letter.',
        },
      ],
    },
    {
      title: 'Measuring what you already own',
      blocks: [
        {
          p: 'The most reliable method is to measure a shirt you already like rather than measuring yourself. Lay it flat and measure the chest straight across from one underarm seam to the other — a half-measurement, which is the convention garment charts use. Measure the length from the highest point of the shoulder straight down to the hem. Send us those two numbers and we will match them by hand before dispatch.',
        },
      ],
    },
  ],
}
