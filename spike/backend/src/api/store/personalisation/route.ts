import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { limited } from '../../../rate-limit'
import {
  PRICES, cheapestAddOn, eligibility, priceSelection, typefaceFor, validate,
} from '../../../personalisation'

/**
 * GET /store/personalisation?product_id=…
 *
 * What this shirt offers, and at what price. The storefront needs it to decide whether to
 * render the control at all, and to render "from $7.99" without hardcoding a number that
 * would drift from the server's.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const productId = String(req.query.product_id ?? '')
  if (!productId) return res.status(400).json({ message: 'product_id is required.' })

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'product',
    fields: ['id', 'title', 'jersey_detail.garment', 'jersey_detail.team',
             'jersey_detail.league', 'jersey_detail.needs_review',
             'jersey_detail.is_custom'],
    filters: { id: productId },
  })
  const product = (data as any[])[0]
  if (!product) return res.status(404).json({ message: 'No such product.' })

  const detail = product.jersey_detail
  const elig = eligibility(detail)
  const patches = patchesFor(detail?.league)
  // A blank sold to be printed: the name and number are already in the shirt's price.
  const included = !!detail?.is_custom

  res.json({
    eligible: elig.eligible,
    included,
    // The reason is returned, not swallowed. 262 products are excluded for unreviewed
    // taxonomy and that is a fixable state — an unexplained missing control is not.
    reason: elig.reason ?? null,
    // Zeroed on a custom shirt so the storefront cannot quote an add-on price for
    // something already paid for — the price table is the server's answer, not a constant
    // the page keeps its own copy of.
    prices: included
      ? { name: 0, number: 0, bundle: 0, patch: PRICES.patch }
      : PRICES,
    // Over what is offered, not over the whole price table: with no patch list, the
    // cheapest thing available is the $9.99 number, not the $7.99 patch.
    from: included ? 0 : cheapestAddOn({ patches }),
    typeface: typefaceFor(detail?.league),
    // Spec §2: a fixed set, never a free upload. Empty until the patch list is decided
    // (decision 4 in the spec), which is why the storefront must not assume patches exist.
    patches,
    // Spec §7: disclosure must come *before* purchase, so it ships with the offer rather
    // than being left to the storefront to remember.
    notice: {
      // The exclusion applies to a custom shirt exactly as it does to a printed regular
      // one — arguably more so, since a custom blank with a name on it is unsellable to
      // anyone else. Saying so before purchase is the §7 requirement.
      non_returnable: included
        ? 'Custom jerseys are printed to your specification, so they can’t be returned or ' +
          'exchanged, including for size. Check the size guide before ordering — leave the ' +
          'name and number blank and it ships as a plain shirt you can exchange.'
        : 'Personalised items are made to order and can’t be returned or exchanged, ' +
          'including for size. Please check the size guide before ordering.',
      lead_time: 'Personalised orders ship 2–4 business days later than plain shirts.',
    },
  })
}

/** PATCHES_<LEAGUE> placeholders — the curated list is still an open decision (spec §5.4). */
function patchesFor(league?: string | null): string[] {
  const key = `PATCHES_${(league ?? '').toUpperCase().replace(/[^A-Z]/g, '')}`
  return (process.env[key] || '').split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * POST /store/personalisation — validate and price, without committing anything.
 *
 * Called as the customer types (spec §4.5). It exists as a server endpoint rather than
 * client-only validation for one reason: the client copy is a convenience, and the server
 * is the one that decides. Duplicating the blocklist into the bundle would also publish it,
 * which tells anyone reading the JS exactly what to work around.
 *
 * Rate limited generously rather than tightly: this fires per keystroke behind a debounce,
 * so the budget has to cover a customer typing "MAHOMES" and still stop a script mining the
 * blocklist by bisection — which is the actual abuse case, since the server's refusal is the
 * only place the word list is observable.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (await limited(req, res, 'personalisation-validate', 120, 60_000)) return

  const body = (req.body ?? {}) as {
    product_id?: string
    name?: string
    number?: string | number
    patch?: string
  }
  if (!body.product_id) return res.status(400).json({ message: 'product_id is required.' })

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'product',
    fields: ['id', 'jersey_detail.garment', 'jersey_detail.team', 'jersey_detail.league',
             'jersey_detail.needs_review', 'jersey_detail.is_custom'],
    filters: { id: body.product_id },
  })
  const detail = (data as any[])[0]?.jersey_detail
  const elig = eligibility(detail)
  if (!elig.eligible) {
    // 409, not 400: the request is well-formed, the product just cannot take it.
    return res.status(409).json({ eligible: false, reason: elig.reason })
  }

  const result = validate({
    name: body.name,
    number: body.number,
    patch: body.patch,
    availablePatches: patchesFor(detail?.league),
  })
  const priced = priceSelection({
    name: result.name,
    number: result.number,
    patch: result.patch,
  }, { included: !!detail?.is_custom })

  // 200 even when invalid: this endpoint answers "what is wrong and what would it cost",
  // and a 422 would make an ordinary keystroke look like a failure in the client.
  res.json({
    ok: result.ok,
    errors: result.errors,
    normalised: { name: result.name ?? null, number: result.number ?? null, patch: result.patch ?? null },
    lines: priced.lines,
    total: priced.total,
    included: !!detail?.is_custom,
    typeface: typefaceFor(detail?.league),
  })
}
