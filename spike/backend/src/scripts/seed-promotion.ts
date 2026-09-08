import { Modules } from '@medusajs/framework/utils'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'

/**
 * Seed one discount code, so the cart's promo field can be exercised against a real
 * promotion rather than only against the rejection path.
 *
 *   npx medusa exec ./src/scripts/seed-promotion.ts
 *   CODE=WELCOME10 PERCENT=10 npx medusa exec ./src/scripts/seed-promotion.ts
 *
 * A fixture, not a marketing decision. research.md §9.1 argues against percentage codes for
 * this shop: the fixed $0.30 does not shrink with the discount, so a 20% code lifts the
 * effective card rate from 3.33% to 3.43% on top of the $13.00 it gives away — free-shipping
 * thresholds are the recommended mechanic and the cart leads with that. This exists so the
 * code path is tested, and so the number in `research.md` can be checked against a real
 * cart rather than asserted.
 */
export default async function seedPromotion({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const promotions = container.resolve(Modules.PROMOTION)

  const code = process.env.CODE || 'WELCOME10'
  const percent = Number(process.env.PERCENT || 10)

  const existing = await promotions.listPromotions({ code })
  if (existing.length) {
    logger.info(`Promotion ${code} already exists — nothing to do.`)
    return
  }

  const [created] = await promotions.createPromotions([
    {
      code,
      type: 'standard',
      is_automatic: false,
      // Promotions are created `draft` by default, and a draft promotion is accepted by
      // `POST /store/carts/:id/promotions` with **HTTP 200 and no effect** — no error, no
      // discount, an empty `promotions` array. That silent-success path is exactly why
      // `applyPromo` verifies by reading the cart back instead of trusting the status code.
      status: 'active',
      application_method: {
        type: 'percentage',
        target_type: 'items',
        allocation: 'across',
        value: percent,
        currency_code: 'usd',
      },
    } as never,
  ])

  logger.info(
    `Created promotion ${created.code}: ${percent}% off items. ` +
    'Apply it from the cart page. §9.1 is the argument against leaning on this.'
  )
}
