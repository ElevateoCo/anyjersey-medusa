import { model } from '@medusajs/framework/utils'

/**
 * Reviews carried over from the marketplaces the shop traded on before this store existed.
 *
 * 84 published reviews, averaging 4.94, exported from Judge.me on 2026-08-18: 70 from eBay,
 * 7 from Depop, 7 from Facebook Marketplace. A separate table from `ProductReview`, and the
 * separation is the point rather than an inconvenience:
 *
 *  1. **`verified_purchase` cannot be derived for them.** `ProductReview` sets that flag by
 *     checking this store's own order history, which is the only way the FTC rule permits a
 *     "verified" badge to exist. These orders happened on eBay. Putting them in the same
 *     table would give them access to a mechanism that cannot truthfully evaluate them.
 *  2. **They are reviews of a different transaction.** An eBay purchase is not a review of
 *     this checkout, this shipping, or this returns process. Displaying them is fine;
 *     displaying them as if they were placed here is not.
 *  3. **Origin must be disclosed** (research.md §7.10), so `source` is a required column and
 *     the storefront renders it next to every card.
 *
 * `product_id` is **nullable, and that is the whole shape of the data**. 45 of the 84 name an
 * exact product title in the export's `item` field and are matched to a product on import;
 * 39 name nothing and are store reviews. Neither set is invented into the other. The 93
 * unpublished rows in the same export — Judge.me had flagged them all as spam, 54 of them
 * 1-star delivery complaints — are not imported at all, and the import script has no flag
 * that would let them in.
 */
export const StoreReview = model
  .define('store_review', {
    id: model.id().primaryKey(),

    /** Null when the review names no product. 39 of 84 — a fact, not a gap to fill. */
    product_id: model.text().nullable(),
    /** The exact title from the export, kept so a match can be audited or redone. */
    source_item: model.text().nullable(),

    rating: model.number(),
    title: model.text().nullable(),
    body: model.text(),
    author_name: model.text(),

    /** Disclosed on the storefront, per §7.10. Never blank. */
    source: model.text(),
    reviewed_at: model.dateTime(),

    /**
     * How `product_id` was arrived at, so an attribution can be reviewed later.
     * `exact_title` is the only automatic path; anything less certain stays unmatched
     * rather than guessed onto a product that would then carry someone else's rating.
     */
    match_method: model.enum(['exact_title', 'manual', 'unmatched']).default('unmatched'),

    /** Content address of the source row, so a re-run cannot duplicate it. */
    fingerprint: model.text(),
  })
  .indexes([
    { on: ['product_id'] },
    { on: ['reviewed_at'] },
    // Re-running the import must be a no-op, not a second copy of the corpus.
    { on: ['fingerprint'], unique: true },
  ])
