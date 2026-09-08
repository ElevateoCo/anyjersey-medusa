import { model } from '@medusajs/framework/utils'

/**
 * An editorial grouping — "Best Sellers", "World Cup 2026", "Rookie Draft Class 2026".
 *
 * **Not Medusa's `product_collection`, and the reason is a hard constraint rather than a
 * preference: a product belongs to at most one Medusa collection.** The live store's
 * groupings overlap heavily by design — a World Cup shirt is frequently also a best seller —
 * and importing 1,564 memberships into a one-of relationship resolved to first-wins,
 * which took 80 products out of Football 2026 and 22 of the 49 in Rookie Draft Class
 * because Best Sellers had claimed them first. The pages that produces are wrong, and
 * silently so.
 *
 * So membership is its own table and a product can be in as many as it belongs to.
 *
 * What this deliberately does *not* replace is the facet navigation. `football`,
 * `basketball`, `baseball` and `college-football` exist as collections on the live store but
 * are league facets in disguise — `/jerseys?league=NFL` answers them from data rather than
 * from a list somebody has to maintain, and two navigation systems over the same products
 * drift apart with the hand-maintained one going stale.
 */
export const CuratedCollection = model
  .define('curated_collection', {
    id: model.id().primaryKey(),
    handle: model.text(),
    title: model.text(),
    description: model.text().nullable(),
    /** Display order in the navigation. Lower first. */
    position: model.number().default(0),
    /** A collection can be emptied for a season without losing its membership. */
    active: model.boolean().default(true),
    source: model.text().nullable(),
  })
  .indexes([
    { on: ['handle'], unique: true, where: 'deleted_at IS NULL' },
    { on: ['active', 'position'] },
  ])

/**
 * One row per product per collection.
 *
 * `product_id` is a plain text column rather than a module link. A link would be the
 * idiomatic choice for a one-to-one, but membership here is many-to-many and re-importing a
 * collection means replacing its rows wholesale — which is a delete-and-insert on a flat
 * table and a considerably more delicate operation on a link.
 */
export const CollectionMembership = model
  .define('collection_membership', {
    id: model.id().primaryKey(),
    collection_handle: model.text(),
    product_id: model.text(),
    /** Position within the collection, preserving the source's own ordering. */
    position: model.number().default(0),
  })
  .indexes([
    { on: ['collection_handle', 'position'] },
    { on: ['product_id'] },
    // A product appears once in a given collection. Re-running the import is then a
    // replace rather than a duplicate.
    { on: ['collection_handle', 'product_id'], unique: true, where: 'deleted_at IS NULL' },
  ])
