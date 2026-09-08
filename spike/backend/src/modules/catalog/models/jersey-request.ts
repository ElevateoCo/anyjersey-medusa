import { model } from '@medusajs/framework/utils'

/**
 * "Can't find your jersey? Request it — we'll source it for you fast."
 *
 * The store's actual differentiator (research.md §12.1), so it is a first-class object
 * rather than a contact form. Every row is a customer naming what to source next, with an
 * email attached — a demand signal no competitor can copy.
 */
export const JerseyRequest = model
  .define('jersey_request', {
    id: model.id().primaryKey(),
    email: model.text(),
    raw_request: model.text(),

    // parsed with the same vocabulary as the catalog, so the queue sorts by demand
    // rather than by arrival order
    team: model.text().nullable(),
    player: model.text().nullable(),
    colourway: model.text().nullable(),
    season: model.text().nullable(),
    size_code: model.text().nullable(),
    garment: model.text().nullable(),

    source: model.enum(['homepage', 'product', 'search_empty', 'collection']).default('homepage'),
    source_product_id: model.text().nullable(),
    status: model.enum(['new', 'sourcing', 'quoted', 'fulfilled', 'declined']).default('new'),
    notes: model.text().nullable(),
  })
  .indexes([
    { on: ['status'] },
    { on: ['team', 'player'] },
    { on: ['email'] },
  ])
