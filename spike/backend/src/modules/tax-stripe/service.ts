import type { ITaxProvider, TaxTypes, Logger } from '@medusajs/framework/types'

type Options = {
  /** Placeholder. Empty until a Stripe account exists — see behaviour note below. */
  apiKey?: string
  /** Master switch. Stripe Tax bills 0.5% of volume, so it is off until deliberately on. */
  enabled?: boolean
  /**
   * States where we have economic nexus and therefore a duty to collect.
   * Comma-separated two-letter codes, e.g. "CA,NY,TX".
   */
  nexusStates?: string[]
  /** Home state — always nexus, by physical presence. */
  homeState?: string
}

/**
 * Tax provider.
 *
 * research.md §7.1: US sales tax is not one tax. There are ~13,000 jurisdictions, rates
 * change monthly, and jersey apparel is specifically exempt or partially exempt in several
 * states (MN, NJ, PA fully; NY under $110; MA under $175). Nobody should hand-maintain
 * that, which is why §4 picks Stripe Tax and §9 budgets 0.5% of volume for it.
 *
 * Until that account exists, this provider has to decide what to do with no rate source.
 * There are two wrong answers and one right one:
 *
 *   - **Wrong:** guess a flat rate. Under-collecting is a liability that compounds
 *     silently; over-collecting is a refund obligation and, in several states, an offence.
 *   - **Wrong:** return zero and say nothing. That is indistinguishable from a correct
 *     zero, so the day the account is meant to be live and isn't, nothing surfaces.
 *   - **Right:** distinguish the two zeros. A zero because there is no nexus in the
 *     destination state is *correct and final*. A zero because we could not calculate is a
 *     defect, and it is stamped as one on the tax line's `data` so it is visible in the
 *     order, queryable in the database, and assertable in a test.
 *
 * That distinction is the whole point of this file. `data.calculated === false` on a
 * shipped order means revenue was recognised without a tax decision, and that is a
 * reportable condition rather than a shrug.
 */
export default class StripeTaxProvider implements ITaxProvider {
  static identifier = 'stripe-tax'

  private logger_: Logger
  private options_: Options
  private warned_ = false

  constructor({ logger }: { logger: Logger }, options: Options = {}) {
    this.logger_ = logger
    this.options_ = options
  }

  getIdentifier(): string {
    return StripeTaxProvider.identifier
  }

  private nexus(): Set<string> {
    const states = [
      ...(this.options_.nexusStates ?? []),
      this.options_.homeState ?? '',
    ]
    return new Set(states.map((s) => s.trim().toUpperCase()).filter(Boolean))
  }

  /**
   * Whether we owe a collection duty at this destination at all.
   *
   * §7.1: after *South Dakota v. Wayfair*, the duty follows economic nexus — typically
   * $100k of sales or 200 transactions into a state — not physical presence. A new store
   * has nexus only in its home state, so most US destinations legitimately get zero tax,
   * and rising through a threshold is a business event that has to be noticed.
   */
  private hasNexus(countryCode?: string, provinceCode?: string | null): boolean {
    const country = (countryCode ?? '').toUpperCase()
    if (country !== 'US') {
      // Outside the US the question is VAT/GST registration, not nexus, and it is always
      // Stripe Tax's call — never ours.
      return true
    }
    // province_code arrives lower-cased and sometimes as "us-ca".
    const state = (provinceCode ?? '').toUpperCase().replace(/^US-/, '')
    return this.nexus().has(state)
  }

  async getTaxLines(
    itemLines: TaxTypes.ItemTaxCalculationLine[],
    shippingLines: TaxTypes.ShippingTaxCalculationLine[],
    context: TaxTypes.TaxCalculationContext
  ): Promise<(TaxTypes.ItemTaxLineDTO | TaxTypes.ShippingTaxLineDTO)[]> {
    const address = context.address ?? { country_code: '', province_code: null }
    const active = this.options_.enabled && !!this.options_.apiKey

    if (!this.hasNexus(address.country_code, address.province_code)) {
      return this.flatLines(itemLines, shippingLines, {
        rate: 0,
        name: 'No tax collected',
        code: 'NO_NEXUS',
        calculated: true,
        reason: `no economic nexus in ${address.province_code ?? address.country_code}`,
      })
    }

    if (!active) {
      if (!this.warned_) {
        this.warned_ = true
        this.logger_.warn(
          '[tax] STRIPE_TAX_ENABLED is off or STRIPE_API_KEY is empty — tax lines are ' +
          'being stamped calculated=false. Orders will show zero tax where tax is owed. ' +
          'See research.md §7.1.'
        )
      }
      return this.flatLines(itemLines, shippingLines, {
        rate: 0,
        name: 'Tax not calculated',
        code: 'UNCALCULATED',
        calculated: false,
        reason: this.options_.enabled ? 'STRIPE_API_KEY missing' : 'STRIPE_TAX_ENABLED off',
      })
    }

    try {
      return await this.calculateWithStripe(itemLines, shippingLines, context)
    } catch (e) {
      // A tax API outage must not take checkout down — but it must not silently pass as
      // zero tax either. Fail *open on the sale, closed on the claim*: the order completes
      // and carries an explicit marker that its tax needs recalculating.
      this.logger_.error(
        `[tax] Stripe Tax call failed, stamping calculated=false: ${(e as Error).message}`
      )
      return this.flatLines(itemLines, shippingLines, {
        rate: 0,
        name: 'Tax not calculated',
        code: 'PROVIDER_ERROR',
        calculated: false,
        reason: (e as Error).message,
      })
    }
  }

  /**
   * Stripe Tax calculation.
   *
   * Deliberately a bare `fetch` against the REST endpoint rather than the Stripe SDK: this
   * runs inside the cart totals path on every address change, the payload is small, and one
   * form-encoded POST is easier to reason about than an SDK version pin. It is untested
   * against the live API because no key exists yet, so it is the one part of this file
   * that must be verified the day a key lands — the tests cover the surrounding decisions,
   * not this call.
   */
  private async calculateWithStripe(
    itemLines: TaxTypes.ItemTaxCalculationLine[],
    shippingLines: TaxTypes.ShippingTaxCalculationLine[],
    context: TaxTypes.TaxCalculationContext
  ): Promise<(TaxTypes.ItemTaxLineDTO | TaxTypes.ShippingTaxLineDTO)[]> {
    const address = context.address
    const currency = (itemLines[0]?.line_item.currency_code ?? 'usd').toLowerCase()
    const body = new URLSearchParams()
    body.set('currency', currency)
    body.set('customer_details[address][country]', (address.country_code ?? '').toUpperCase())
    if (address.province_code) {
      body.set(
        'customer_details[address][state]',
        address.province_code.toUpperCase().replace(/^US-/, '')
      )
    }
    if (address.postal_code) body.set('customer_details[address][postal_code]', address.postal_code)
    if (address.city) body.set('customer_details[address][city]', address.city)
    if (address.address_1) body.set('customer_details[address][line1]', address.address_1)
    body.set('customer_details[address_source]', 'shipping')

    itemLines.forEach((l, i) => {
      // Stripe wants integer minor units. unit_price arrives as a decimal string.
      const unit = Math.round(Number(l.line_item.unit_price ?? 0) * 100)
      const qty = Number(l.line_item.quantity ?? 1)
      body.set(`line_items[${i}][amount]`, String(unit * qty))
      body.set(`line_items[${i}][reference]`, l.line_item.id)
      body.set(`line_items[${i}][quantity]`, String(qty))
      // txcd_99999999 = general tangible goods. Apparel has its own codes and several
      // states exempt it, so the tax code is what makes MN/NJ/PA come back correct
      // instead of over-collected — see the note in shipping-zones/README.
      body.set(`line_items[${i}][tax_code]`, process.env.STRIPE_TAX_CODE_APPAREL || 'txcd_30070000')
    })

    const shipCost = shippingLines.reduce(
      (sum, l) => sum + Math.round(Number(l.shipping_line.unit_price ?? 0) * 100),
      0
    )
    if (shipCost > 0) body.set('shipping_cost[amount]', String(shipCost))

    const res = await fetch('https://api.stripe.com/v1/tax/calculations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options_.apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    if (!res.ok) {
      throw new Error(`Stripe Tax ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
    const calc = (await res.json()) as StripeTaxCalculation

    const byRef = new Map(calc.line_items?.data?.map((li) => [li.reference, li]) ?? [])
    const lines: (TaxTypes.ItemTaxLineDTO | TaxTypes.ShippingTaxLineDTO)[] = itemLines.map(
      (l) => {
        const li = byRef.get(l.line_item.id)
        return {
          rate: effectiveRate(li?.amount_tax, li?.amount),
          name: li?.tax_breakdown?.[0]?.jurisdiction?.display_name ?? 'Sales tax',
          code: li?.tax_breakdown?.[0]?.tax_rate_details?.tax_type ?? 'SALES_TAX',
          line_item_id: l.line_item.id,
          provider_id: this.getIdentifier(),
          // The aggregate rate loses the state/county/city split, and that split is what
          // a state audit asks for. Keep the raw breakdown on the line.
          data: {
            calculated: true,
            calculation_id: calc.id,
            amount_tax: li?.amount_tax ?? 0,
            breakdown: li?.tax_breakdown ?? [],
          },
        }
      }
    )

    const shipTax = calc.shipping_cost
    for (const l of shippingLines) {
      lines.push({
        rate: effectiveRate(shipTax?.amount_tax, shipTax?.amount),
        name: 'Sales tax (shipping)',
        code: 'SALES_TAX',
        shipping_line_id: l.shipping_line.id,
        provider_id: this.getIdentifier(),
        // Whether shipping is itself taxable varies by state — it is in TX and NY, it
        // isn't in CA when separately stated. Stripe decides; we record the decision.
        data: { calculated: true, calculation_id: calc.id },
      })
    }
    return lines
  }

  /** One rate applied uniformly to every line, with the reason attached to each. */
  private flatLines(
    itemLines: TaxTypes.ItemTaxCalculationLine[],
    shippingLines: TaxTypes.ShippingTaxCalculationLine[],
    spec: { rate: number; name: string; code: string; calculated: boolean; reason: string }
  ): (TaxTypes.ItemTaxLineDTO | TaxTypes.ShippingTaxLineDTO)[] {
    const data = { calculated: spec.calculated, reason: spec.reason }
    return [
      ...itemLines.map((l) => ({
        rate: spec.rate,
        name: spec.name,
        code: spec.code,
        line_item_id: l.line_item.id,
        provider_id: this.getIdentifier(),
        data,
      })),
      ...shippingLines.map((l) => ({
        rate: spec.rate,
        name: spec.name,
        code: spec.code,
        shipping_line_id: l.shipping_line.id,
        provider_id: this.getIdentifier(),
        data,
      })),
    ]
  }
}

/**
 * Stripe returns tax as an *amount*; Medusa's tax line wants a *percentage*, and then
 * multiplies it back out itself. Converting amount → rate → amount can round differently
 * from the amount Stripe computed, so the authoritative figure is kept in `data.amount_tax`
 * and this rate is what the totals engine displays.
 */
export function effectiveRate(amountTax?: number, amount?: number): number {
  if (!amountTax || !amount) return 0
  // Percent, to four places: 8.875% (NYC) must not round to 8.88.
  return Math.round((amountTax / amount) * 1_000_000) / 10_000
}

type StripeTaxBreakdown = {
  jurisdiction?: { display_name?: string; level?: string }
  tax_rate_details?: { tax_type?: string; percentage_decimal?: string }
  amount?: number
}
type StripeTaxCalculation = {
  id: string
  line_items?: {
    data?: Array<{
      reference: string
      amount: number
      amount_tax: number
      tax_breakdown?: StripeTaxBreakdown[]
    }>
  }
  shipping_cost?: { amount?: number; amount_tax?: number }
}
