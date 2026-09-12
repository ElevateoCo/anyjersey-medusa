/**
 * Set one price across the whole sellable catalogue.
 *
 *   npx medusa exec ./src/scripts/set-catalog-price.ts            # report only
 *   npx medusa exec ./src/scripts/set-catalog-price.ts write      # apply 64.99
 *   npx medusa exec ./src/scripts/set-catalog-price.ts write 59.99
 *
 * **Two things are deliberately out of scope, and a blanket UPDATE over `price` would take
 * both of them with it.**
 *
 * *Shipping rates.* $4.99, $19.99, $24.99 and $29.99 are rows in the same table, reached
 * through `shipping_option_price_set` rather than `product_variant_price_set`. Repricing
 * shipping to the price of a shirt is the kind of mistake that is obvious in hindsight and
 * invisible in a diff, so the join is the guard rather than a `WHERE amount = 65.99`.
 *
 * *The personalisation add-on.* It is a real product with real variants — a name at
 * $14.99, a number at $9.99, both at $19.99 — so it is inside the variant join and has to
 * be excluded by id. `PERSONALISATION_PRODUCT_ID` is the same variable `lib/cart.ts` reads
 * when it attaches the add-on to a line.
 *
 * Dry by default. It prints what it would change and touches nothing until told.
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

const DEFAULT_AMOUNT = 64.99

export default async function setCatalogPrice({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const write = args?.includes('write')
  const amountArg = args?.find((a) => /^\d+(\.\d{1,2})?$/.test(a))
  const amount = amountArg ? Number(amountArg) : DEFAULT_AMOUNT

  const addOn = process.env.PERSONALISATION_PRODUCT_ID ?? ''
  if (!addOn) {
    logger.warn(
      'PERSONALISATION_PRODUCT_ID is not set. Refusing rather than repricing the ' +
      'name-and-number add-on to the price of a shirt.'
    )
    return
  }

  /**
   * Every price reached through a variant, minus the add-on's own variants.
   *
   * Written as one predicate reused by the report and the update, so the rows counted and
   * the rows changed cannot be different sets — which is the failure a dry run is supposed
   * to rule out and would not, if the two queries were written twice.
   */
  const scope = (qb: any) =>
    qb.from('price as p')
      .join('product_variant_price_set as vps', function (this: any) {
        this.on('vps.price_set_id', '=', 'p.price_set_id').andOnNull('vps.deleted_at')
      })
      .join('product_variant as v', function (this: any) {
        this.on('v.id', '=', 'vps.variant_id').andOnNull('v.deleted_at')
      })
      .whereNull('p.deleted_at')
      .whereNot('v.product_id', addOn)

  const before = await scope(knex.queryBuilder())
    .select('p.amount')
    .count('* as n')
    .groupBy('p.amount')
    .orderBy('n', 'desc')

  const total = before.reduce((s: number, r: any) => s + Number(r.n), 0)
  const changing = before
    .filter((r: any) => Number(r.amount) !== amount)
    .reduce((s: number, r: any) => s + Number(r.n), 0)

  logger.info(`Catalogue prices in scope: ${total}`)
  for (const r of before) {
    logger.info(`  $${Number(r.amount).toFixed(2)} × ${r.n}` +
      (Number(r.amount) === amount ? '  (already)' : ''))
  }

  // Named, so the log says what was protected rather than leaving it to be inferred.
  const excluded = await knex('price as p')
    .join('product_variant_price_set as vps', 'vps.price_set_id', 'p.price_set_id')
    .join('product_variant as v', 'v.id', 'vps.variant_id')
    .where('v.product_id', addOn)
    .whereNull('p.deleted_at')
    .select('p.amount')
  const shipping = await knex('price as p')
    .join('shipping_option_price_set as sps', 'sps.price_set_id', 'p.price_set_id')
    .whereNull('p.deleted_at')
    .select('p.amount')

  logger.info(
    `Untouched: ${excluded.length} personalisation add-on prices ` +
    `(${excluded.map((e: any) => '$' + Number(e.amount).toFixed(2)).join(', ')}), ` +
    `${shipping.length} shipping rates ` +
    `(${shipping.map((e: any) => '$' + Number(e.amount).toFixed(2)).join(', ')})`
  )

  if (!changing) {
    logger.info(`Nothing to do — every catalogue price is already $${amount.toFixed(2)}.`)
    return
  }
  if (!write) {
    logger.info(`\n${changing} price(s) would become $${amount.toFixed(2)}. ` +
      `Re-run with \`write\` to apply.`)
    return
  }

  const updated = await knex('price')
    .whereIn('id', scope(knex.queryBuilder()).select('p.id'))
    .update({ amount, updated_at: new Date() })

  logger.info(`Updated ${updated} price(s) to $${amount.toFixed(2)}.`)
}
