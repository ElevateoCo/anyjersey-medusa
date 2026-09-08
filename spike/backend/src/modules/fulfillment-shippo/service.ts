import { AbstractFulfillmentProviderService } from '@medusajs/framework/utils'
import type { Logger } from '@medusajs/framework/types'
import { ZONES, type Zone } from '../../shipping-zones'

type Options = {
  /** Placeholder — empty until an account exists. See the no-key behaviour below. */
  apiKey?: string
  /** Shippo's own test mode still needs a key; this is our no-key mode. */
  testMode?: boolean
  /** Ship-from address, required on every label. */
  from?: {
    name?: string; street1?: string; city?: string; state?: string
    zip?: string; country?: string; phone?: string
  }
  /** Grams. A folded jersey in a poly mailer; used for rating and the customs form. */
  itemWeightGrams?: number
}

/**
 * Fulfilment.
 *
 * Two jobs, and they are worth separating because only one of them needs an account:
 *
 *  1. **Rating** — what shipping costs the customer. That is our own rate card
 *     (research.md §14.3): flat per zone, free over a threshold. It is a pricing decision,
 *     not a carrier quote, so it works today with no integration at all. Implementing it
 *     here rather than as static prices is what makes the free-shipping threshold actually
 *     apply — a flat shipping option cannot know the cart subtotal.
 *  2. **Labels and tracking** — what we pay a carrier. That needs Shippo.
 *
 * With no `SHIPPO_API_KEY`, rating is fully live and label purchase degrades to a recorded
 * intent: the fulfilment is created, the order moves, and `data.label_purchased` is false
 * with the request that *would* have been sent kept alongside it. So the warehouse step is
 * exercisable end to end before an account exists, and nothing silently claims a shipment
 * happened.
 */
export default class ShippoFulfillmentProvider extends AbstractFulfillmentProviderService {
  static identifier = 'shippo'

  private logger_: Logger
  private options_: Options

  constructor({ logger }: { logger: Logger }, options: Options = {}) {
    super()
    this.logger_ = logger
    this.options_ = options
  }

  getIdentifier(): string {
    return ShippoFulfillmentProvider.identifier
  }

  /**
   * One option per zone, derived from the rate card rather than restated.
   *
   * The id encodes the zone so `calculatePrice` can find its way back to the right row
   * without a second lookup table that could drift out of step.
   */
  async getFulfillmentOptions() {
    return ZONES.map((z) => ({
      id: `shippo-zone-${z.zone}-${z.name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      name: `${z.name} — ${z.leadTime.split(',')[0]}`,
      zone: z.zone,
      zone_name: z.name,
      rate: z.rate,
      free_over: z.freeOver,
    }))
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    return !!this.zoneFrom(data)
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: unknown
  ) {
    const zone = this.zoneFrom(optionData)
    if (!zone) throw new Error(`Unknown shipping zone in option ${JSON.stringify(optionData)}`)
    return { ...data, zone: zone.zone, zone_name: zone.name }
  }

  /** Calculated, not flat — otherwise the free-over threshold cannot be applied. */
  async canCalculate(): Promise<boolean> {
    return true
  }

  /**
   * The rate card, applied.
   *
   * Uses `item_total` rather than `total`: the threshold is a merchandise threshold, so
   * including the shipping already on the cart would make it self-referential, and
   * including tax would make whether shipping is free depend on the customer's state.
   */
  async calculatePrice(
    optionData: Record<string, unknown>,
    _data: Record<string, unknown>,
    context: Record<string, any>
  ) {
    const zone = this.zoneFrom(optionData) ?? ZONES[0]
    const subtotal = Number(context?.item_total ?? context?.subtotal ?? 0)
    const free = zone.freeOver > 0 && subtotal >= zone.freeOver
    return {
      calculated_amount: free ? 0 : zone.rate,
      // Both false: the rate card is quoted tax-exclusive, and whether shipping is itself
      // taxable is the tax provider's call, which varies by state (taxable in TX and NY,
      // not in CA when separately stated).
      is_calculated_price_tax_inclusive: false,
    }
  }

  /**
   * Buy a label, or record that we would have.
   *
   * Note what is *not* here: no retry loop. A label purchase is a charge, and retrying a
   * request whose response was lost buys two labels. Shippo's transaction endpoint is not
   * idempotent by default, so a failure surfaces to the operator instead of being
   * absorbed — see research.md §8.1.
   */
  async createFulfillment(
    data: Record<string, unknown>,
    items: any[],
    order: any,
    fulfillment: Record<string, unknown>
  ) {
    const zone = this.zoneFrom(data) ?? ZONES[0]
    const request = this.buildShipmentRequest(zone, items, order)

    if (!this.options_.apiKey) {
      this.logger_.warn(
        `[fulfillment] SHIPPO_API_KEY is empty — no label bought for fulfilment ` +
        `${String(fulfillment.id ?? 'new')}. Recorded as unpurchased.`
      )
      return {
        data: {
          ...data,
          label_purchased: false,
          reason: 'SHIPPO_API_KEY missing',
          // Kept so the request can be replayed by hand, and so a reviewer can see exactly
          // what would have gone to the carrier.
          would_have_sent: request,
        },
        labels: [],
      }
    }

    try {
      const shipment = await this.shippo('/shipments', request)
      // Cheapest rate that can actually deliver. Not the fastest: the rate card already
      // promised a lead time, and the customer has paid a flat fee regardless.
      const rates: any[] = shipment.rates ?? []
      const chosen = rates
        .filter((r) => r.amount && Number(r.amount) > 0)
        .sort((a, b) => Number(a.amount) - Number(b.amount))[0]
      if (!chosen) throw new Error('Shippo returned no purchasable rate')

      const tx = await this.shippo('/transactions', {
        rate: chosen.object_id,
        label_file_type: 'PDF_4x6',
        async: false,
      })
      if (tx.status !== 'SUCCESS') {
        throw new Error(`Shippo transaction ${tx.status}: ${JSON.stringify(tx.messages ?? [])}`)
      }

      return {
        data: {
          ...data,
          label_purchased: true,
          shippo_transaction_id: tx.object_id,
          carrier: chosen.provider,
          service: chosen.servicelevel?.name,
          cost: chosen.amount,
          currency: chosen.currency,
        },
        labels: [{
          tracking_number: tx.tracking_number,
          tracking_url: tx.tracking_url_provider,
          label_url: tx.label_url,
        }],
      }
    } catch (e) {
      // Deliberately re-thrown. A fulfilment that silently succeeds without a label sends
      // the customer a shipping notification for a parcel nobody posted.
      this.logger_.error(`[fulfillment] label purchase failed: ${(e as Error).message}`)
      throw e
    }
  }

  async cancelFulfillment(data: Record<string, unknown>) {
    const tx = data?.shippo_transaction_id as string | undefined
    if (!tx || !this.options_.apiKey) {
      // Same shape on both branches, so a caller never has to test for the field's
      // existence to find out whether a refund was even attempted.
      return { ...data, cancelled: true, refund_requested: false, refund_status: null }
    }
    // A purchased label is money. Refunds are asynchronous and can be refused if the label
    // has already been scanned, so the request is recorded rather than assumed.
    const refund = await this.shippo('/refunds', { transaction: tx }).catch((e) => {
      this.logger_.error(`[fulfillment] refund request failed: ${(e as Error).message}`)
      return null
    })
    return { ...data, cancelled: true, refund_requested: !!refund, refund_status: refund?.status }
  }

  /**
   * Commercial invoice fields for anything leaving the US.
   *
   * research.md §7.9: a jersey needs an HS code, country of origin and fibre composition on
   * the customs form, and the composition is the one field we do not have — it has to come
   * from the supplier. It is emitted as an explicit placeholder rather than a guess,
   * because a wrong declaration is a customs offence, not a data-quality issue.
   */
  private customs(zone: Zone, items: any[]) {
    if (zone.countries.includes('us')) return undefined
    return {
      contents_type: 'MERCHANDISE',
      non_delivery_option: 'RETURN',
      // 6109.10 = knitted T-shirts/singlets of cotton. Correct for most of the catalogue;
      // a polyester performance jersey is 6109.90.
      items: items.map((i) => ({
        description: String(i.title ?? 'Sports jersey').slice(0, 60),
        quantity: Number(i.quantity ?? 1),
        net_weight: (this.options_.itemWeightGrams ?? 200) / 1000,
        mass_unit: 'kg',
        value_amount: Number(i.unit_price ?? 0),
        value_currency: 'USD',
        origin_country: process.env.CUSTOMS_ORIGIN_COUNTRY || 'PLACEHOLDER_SUPPLIER_ORIGIN',
        tariff_number: process.env.CUSTOMS_HS_CODE || '610910',
      })),
      certify: true,
      certify_signer: this.options_.from?.name ?? 'PLACEHOLDER_SIGNER',
    }
  }

  private buildShipmentRequest(zone: Zone, items: any[], order: any) {
    const to = order?.shipping_address ?? {}
    const grams = items.reduce(
      (g, i) => g + (this.options_.itemWeightGrams ?? 200) * Number(i.quantity ?? 1),
      0
    )
    return {
      address_from: {
        name: this.options_.from?.name ?? 'PLACEHOLDER_WAREHOUSE',
        street1: this.options_.from?.street1 ?? 'PLACEHOLDER_STREET',
        city: this.options_.from?.city ?? 'PLACEHOLDER_CITY',
        state: this.options_.from?.state ?? 'FL',
        zip: this.options_.from?.zip ?? '00000',
        country: this.options_.from?.country ?? 'US',
        phone: this.options_.from?.phone ?? '',
      },
      address_to: {
        name: [to.first_name, to.last_name].filter(Boolean).join(' ') || 'Customer',
        street1: to.address_1 ?? '',
        street2: to.address_2 ?? '',
        city: to.city ?? '',
        state: (to.province ?? '').toUpperCase().replace(/^US-/, ''),
        zip: to.postal_code ?? '',
        country: (to.country_code ?? 'US').toUpperCase(),
        phone: to.phone ?? '',
      },
      parcels: [{
        // A folded jersey in a 12x9x2in poly mailer. Wrong dimensions mean a carrier
        // adjustment invoice weeks later, which is the most common surprise cost in §8.
        length: '30', width: '23', height: '5', distance_unit: 'cm',
        weight: String(Math.max(grams, 1) / 1000), mass_unit: 'kg',
      }],
      customs_declaration: this.customs(zone, items),
      async: false,
    }
  }

  private async shippo(path: string, body: unknown): Promise<any> {
    const res = await fetch(`https://api.goshippo.com${path}`, {
      method: 'POST',
      headers: {
        Authorization: `ShippoToken ${this.options_.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`Shippo ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
    return res.json()
  }

  /** Resolve an option payload back to its rate-card row, by zone number or by name. */
  private zoneFrom(data: Record<string, unknown> | undefined): Zone | undefined {
    if (!data) return undefined
    if (data.zone_name) return ZONES.find((z) => z.name === data.zone_name)
    if (data.zone != null) return ZONES.find((z) => z.zone === Number(data.zone))
    const id = String(data.id ?? '')
    const m = id.match(/^shippo-zone-(\d+)-(.+)$/)
    if (!m) return undefined
    // Zone 3 has two rows (UK and Europe) at the same rate, so the slug disambiguates.
    return ZONES.find(
      (z) => z.zone === Number(m[1]) && z.name.toLowerCase().replace(/[^a-z]+/g, '-') === m[2]
    )
  }
}
