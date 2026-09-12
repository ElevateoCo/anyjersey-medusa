import ShippoFulfillmentProvider from '../service'
import { ZONES } from '../../../shipping-zones'

const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() } as any
const make = (o: any = {}) => new ShippoFulfillmentProvider({ logger }, o)

const items = (n = 1, price = 64.99) =>
  Array.from({ length: n }, (_, i) => ({ title: `Jersey ${i}`, quantity: 1, unit_price: price }))
const order = (country = 'us', province = 'fl') => ({
  shipping_address: {
    first_name: 'A', last_name: 'B', address_1: '1 Main St', city: 'Miami',
    province, postal_code: '33101', country_code: country,
  },
})

beforeEach(() => jest.clearAllMocks())

describe('options come from the rate card', () => {
  it('emits exactly one option per zone row', async () => {
    const opts = await make().getFulfillmentOptions()
    expect(opts).toHaveLength(ZONES.length)
  })

  it('gives zone 3 two distinguishable ids, since UK and Europe share a rate', async () => {
    const opts = await make().getFulfillmentOptions()
    const z3 = opts.filter((o) => o.zone === 3)
    expect(z3).toHaveLength(2)
    expect(new Set(z3.map((o) => o.id)).size).toBe(2)
  })

  it('round-trips every option id back to its own zone', async () => {
    const p = make()
    for (const o of await p.getFulfillmentOptions()) {
      // A slug that cannot be resolved back means checkout charges the wrong zone's rate.
      expect(await p.validateOption({ id: o.id })).toBe(true)
      const validated = await p.validateFulfillmentData({ id: o.id }, {}, {})
      expect(validated.zone_name).toBe(o.zone_name)
    }
  })

  it('refuses an option it does not recognise', async () => {
    await expect(make().validateFulfillmentData({ id: 'shippo-zone-9-atlantis' }, {}, {}))
      .rejects.toThrow(/Unknown shipping zone/)
  })
})

describe('what shipping costs', () => {
  const p = make()
  const us = ZONES.find((z) => z.name === 'United States')!

  it('charges the US flat rate', async () => {
    const r = await p.calculatePrice({ zone_name: 'United States' }, {}, { item_total: 64.99 })
    expect(r.calculated_amount).toBe(4.99)
    expect(r.calculated_amount).toBe(us.rate)
  })

  /**
   * Every zone, every order value.
   *
   * Three tests here used to assert free shipping at a threshold, which is the right thing
   * to check for a rate card that offers one and meaningless for this one. They are
   * replaced rather than deleted, because "shipping is always charged" is itself a claim
   * worth pinning — the provider still contains the `freeOver > 0` branch, and nothing
   * should be able to take that path by accident.
   */
  it('charges the zone rate at every order value, in every zone', async () => {
    for (const z of ZONES) {
      for (const itemTotal of [0, 0.01, 64.99, 75, 200, 5000]) {
        const r = await p.calculatePrice({ zone_name: z.name }, {}, { item_total: itemTotal })
        expect(r.calculated_amount).toBe(z.rate)
      }
    }
  })

  it('never flat-rates international at the domestic price', async () => {
    for (const z of ZONES.filter((x) => x.zone > 1)) {
      const r = await p.calculatePrice({ zone_name: z.name }, {}, { item_total: 64.99 })
      expect(r.calculated_amount).toBeGreaterThan(us.rate)
    }
  })

  /**
   * The threshold branch is dormant, not removed — `freeOver > 0` still guards it, and
   * `research.md` §9.1 argues for bringing the mechanic back over percentage discounts.
   *
   * **It is deliberately not tested here.** `calculatePrice` resolves its zone by name out
   * of `ZONES`, so with every threshold at zero there is no way to reach the branch through
   * the public API, and a test that cannot distinguish the two outcomes is worse than none —
   * it passes whether the code works or not. `shipping-zones.unit.spec.ts` pins the values
   * instead; restoring a threshold means restoring a test that can actually fail.
   */

  it('never quotes shipping as tax-inclusive', async () => {
    const r = await p.calculatePrice({ zone_name: 'Europe' }, {}, { item_total: 10 })
    expect(r.is_calculated_price_tax_inclusive).toBe(false)
  })
})

describe('with no api key', () => {
  it('records an unpurchased label instead of claiming a shipment', async () => {
    const p = make()
    const r = await p.createFulfillment({ zone_name: 'United States' }, items(), order(), { id: 'ful_1' })
    expect(r.labels).toEqual([])
    expect((r.data as any).label_purchased).toBe(false)
    expect((r.data as any).reason).toMatch(/SHIPPO_API_KEY/)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('keeps the request it would have sent, so it can be replayed', async () => {
    const r = await make().createFulfillment(
      { zone_name: 'United States' }, items(2), order(), { id: 'ful_2' }
    )
    const req = (r.data as any).would_have_sent
    expect(req.address_to.city).toBe('Miami')
    expect(req.address_to.state).toBe('FL')
    // 2 jerseys at the default 200 g each.
    expect(Number(req.parcels[0].weight)).toBeCloseTo(0.4, 3)
  })
})

describe('customs', () => {
  const p = make({ from: { name: 'Warehouse' } })

  it('is omitted for a domestic parcel', async () => {
    const r = await p.createFulfillment({ zone_name: 'United States' }, items(), order(), {})
    expect((r.data as any).would_have_sent.customs_declaration).toBeUndefined()
  })

  it('is attached for anything leaving the US', async () => {
    const r = await p.createFulfillment(
      { zone_name: 'Europe' }, items(), order('de', null as any), {}
    )
    const cd = (r.data as any).would_have_sent.customs_declaration
    expect(cd.contents_type).toBe('MERCHANDISE')
    // Return rather than abandon: an abandoned parcel is a total loss plus a chargeback.
    expect(cd.non_delivery_option).toBe('RETURN')
    expect(cd.items[0].tariff_number).toBe('610910')
  })

  it('marks the fields only the supplier can provide, rather than guessing', async () => {
    const r = await p.createFulfillment({ zone_name: 'Canada' }, items(), order('ca'), {})
    const cd = (r.data as any).would_have_sent.customs_declaration
    // A guessed country of origin on a customs form is a false declaration.
    expect(cd.items[0].origin_country).toMatch(/PLACEHOLDER/)
  })
})

describe('with an api key', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  const p = make({ apiKey: 'shippo_test_x', from: { name: 'W', state: 'FL' } })

  const stub = (byPath: Record<string, any>) => {
    global.fetch = jest.fn(async (url: string) => {
      const key = Object.keys(byPath).find((k) => String(url).includes(k))!
      const payload = byPath[key]
      return {
        ok: payload.__status !== 'error',
        status: payload.__status === 'error' ? 400 : 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      }
    }) as any
  }

  it('buys the cheapest purchasable rate and returns tracking', async () => {
    stub({
      '/shipments': { rates: [
        { object_id: 'r_expensive', amount: '18.20', provider: 'FedEx', servicelevel: { name: '2Day' } },
        { object_id: 'r_cheap', amount: '6.10', provider: 'USPS', servicelevel: { name: 'Ground' } },
        { object_id: 'r_zero', amount: '0', provider: 'Broken' },
      ] },
      '/transactions': {
        status: 'SUCCESS', object_id: 'tx_1', tracking_number: '9400111',
        tracking_url_provider: 'https://tools.usps.com/x', label_url: 'https://shippo/label.pdf',
      },
    })
    const r = await p.createFulfillment({ zone_name: 'United States' }, items(), order(), {})
    expect((r.data as any).label_purchased).toBe(true)
    expect((r.data as any).carrier).toBe('USPS')
    expect((r.data as any).cost).toBe('6.10')
    expect(r.labels[0].tracking_number).toBe('9400111')
    // A zero-amount rate is a malformed quote, not a bargain.
    const txBody = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)
    expect(txBody.rate).toBe('r_cheap')
  })

  it('throws rather than fulfilling without a label', async () => {
    stub({ '/shipments': { rates: [] } })
    // Otherwise the customer gets a shipping notification for a parcel nobody posted.
    await expect(p.createFulfillment({ zone_name: 'United States' }, items(), order(), {}))
      .rejects.toThrow(/no purchasable rate/)
    expect(logger.error).toHaveBeenCalled()
  })

  it('treats a non-SUCCESS transaction as a failure', async () => {
    stub({
      '/shipments': { rates: [{ object_id: 'r1', amount: '6.10', provider: 'USPS' }] },
      '/transactions': { status: 'ERROR', messages: [{ text: 'invalid zip' }] },
    })
    await expect(p.createFulfillment({ zone_name: 'United States' }, items(), order(), {}))
      .rejects.toThrow(/ERROR/)
  })

  it('does not retry a label purchase', async () => {
    stub({ '/shipments': { __status: 'error' } })
    await expect(p.createFulfillment({ zone_name: 'United States' }, items(), order(), {}))
      .rejects.toThrow()
    // Retrying a charge whose response was lost buys two labels.
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('requests a refund when a fulfilment is cancelled', async () => {
    stub({ '/refunds': { status: 'QUEUED' } })
    const r = await p.cancelFulfillment({ shippo_transaction_id: 'tx_1' })
    expect(r.refund_requested).toBe(true)
    expect(r.refund_status).toBe('QUEUED')
  })

  it('still cancels when the refund is refused', async () => {
    stub({ '/refunds': { __status: 'error' } })
    const r = await p.cancelFulfillment({ shippo_transaction_id: 'tx_1' })
    // A scanned label cannot be refunded, but the fulfilment must still cancel.
    expect(r.cancelled).toBe(true)
    expect(r.refund_requested).toBe(false)
  })
})
