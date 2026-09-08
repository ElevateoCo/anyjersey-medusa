import { model } from '@medusajs/framework/utils'

/**
 * Everything about a jersey that Medusa's product model has no place for.
 *
 * These are real columns, not metadata, for two reasons: metadata is not indexable, so
 * facets built on it cannot scale past a few hundred products; and the regulatory fields
 * gate whether a product may lawfully be sold into the EU, which is not something to
 * bury in a JSON blob (research.md §13.5).
 */
export const JerseyDetail = model
  .define('jersey_detail', {
    id: model.id().primaryKey(),

    // derived taxonomy — parsed from titles, because the source catalog has none.
    // This is what navigation and faceted search are built on (research.md §13.3).
    sport: model.text().nullable(),
    league: model.text().nullable(),
    team: model.text().nullable(),
    player: model.text().nullable(),
    colourway: model.text().nullable(),
    season: model.text().nullable(),
    edition: model.text().nullable(),
    garment: model.text().default('jersey'),

    /**
     * A blank shirt sold to be printed, rather than a player's shirt.
     *
     * The live store runs these as their own product line — 69 of them, one per team and
     * colourway, at **$89.99 against a $65.99 base** — with the name and number **included
     * in the price** rather than sold as an add-on. Regular player jerseys there carry no
     * personalisation control at all.
     *
     * That is a different commercial shape from the add-on model in
     * `personalisation-spec.md` §1, and both now exist: this flag is what tells the pricing
     * function which one applies. It is a column rather than a title match because
     * "CUSTOM" appears in plenty of titles that are not blanks — City Connect, Customized
     * throwbacks — and because a mispriced shirt is the expensive way to find that out.
     */
    is_custom: model.boolean().default(false),

    /**
     * Accent-folded, lowercased haystack: team + player + colourway + season.
     *
     * Postgres ILIKE does not match "romario" against "Romário", and nobody types the
     * accent — searches for José Altuve, Julio Rodríguez, Ronald Acuña Jr. and Romário
     * all returned nothing. Folding once at write time is cheaper and more predictable
     * than folding at query time.
     */
    search_text: model.text().nullable(),

    // SEO — Medusa's product model has no fields for these
    seo_title: model.text().nullable(),
    seo_description: model.text().nullable(),

    // regulatory. Required information, not required naming (research.md §7.8, §13.5).
    // All null after import; null here blocks EU sales.
    manufacturer_name: model.text().nullable(),
    manufacturer_address: model.text().nullable(),
    eu_responsible_person: model.text().nullable(),
    country_of_origin: model.text().nullable(),
    fibre_composition: model.text().nullable(),
    care_instructions: model.text().nullable(),
    safety_information: model.text().nullable(),
    hs_code: model.text().nullable(),

    // data quality
    needs_review: model.boolean().default(false),
    review_notes: model.json().nullable(),

    // provenance
    source_platform: model.text().default('shopify'),
    source_handle: model.text().nullable(),
  })
  .indexes([
    { on: ['team'] },
    { on: ['league'] },
    { on: ['player'] },
    { on: ['sport'] },
    { on: ['garment'] },
    { on: ['needs_review'] },
    { on: ['search_text'] },
  ])
