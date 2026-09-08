import StripeTaxProvider, { effectiveRate } from '../service'
import type { TaxTypes } from '@medusajs/framework/types'

const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() } as any

const item = (id: string, price = 64.99, qty = 1) =>
  ({ line_item: { id, product_id: 'prod_1', unit_price: price, quantity: qty, currency_code: 'usd' }, rates: [] })
const ship = (id = 'sm_1', price = 4.99) =>
  ({ shipping_line: { id, shipping_option_id: 'so_1', unit_price: price }, rates: [] })
const ctx = (country: string, province?: string | null) =>
  ({ address: { country_code: country, province_code: province ?? null } }) as TaxTypes.TaxCalculationContext

const lines = (r: any[]) => r as Array<TaxTypes.ItemTaxLineDTO & TaxTypes.ShippingTaxLineDTO & { data: any }>

beforeEach(() => jest.clearAllMocks())

describe('nexus', () => {
  const p = new StripeTaxProvider({ logger }, { homeState: 'FL', nexusStates: ['CA', 'NY'] })

  it('collects in the home state', async () => {
    const r = lines(await p.getTaxLines([item('li_1')], [], ctx('US', 'fl')))
    expect(r[0].code).not.toBe('NO_NEXUS')
  })

  it('collects in a threshold state', async () => {
    const r = lines(await p.getTaxLines([item('li_1')], [], ctx('US', 'ny')))
    expect(r[0].code).not.toBe('NO_NEXUS')
  })

  it('returns a *correct* zero where there is no nexus, and says why', async () => {
    const r = lines(await p.getTaxLines([item('li_1')], [ship()], ctx('US', 'tx')))
    expect(r).toHaveLength(2)
    for (const l of r) {
      expect(l.rate).toBe(0)
      expect(l.code).toBe('NO_NEXUS')
      // The distinction this whole provider exists for: a lawful zero is calculated.
      expect(l.data.calculated).toBe(true)
      expect(l.data.reason).toMatch(/no economic nexus in TX/i)
    }
  })

  it('accepts the ISO 3166-2 "us-ca" form as well as "ca"', async () => {
    const r = lines(await p.getTaxLines([item('li_1')], [], ctx('US', 'us-ca')))
    expect(r[0].code).not.toBe('NO_NEXUS')
  })

  it('never treats a non-US destination as out of nexus', async () => {
    // Outside the US the question is VAT registration, which is Stripe's call, not ours.
    const r = lines(await p.getTaxLines([item('li_1')], [], ctx('DE', null)))
    expect(r[0].code).not.toBe('NO_NEXUS')
  })
})

describe('unconfigured', () => {
  it('stamps calculated=false rather than passing a silent zero', async () => {
    const p = new StripeTaxProvider({ logger }, { homeState: 'FL', enabled: false })
    const r = lines(await p.getTaxLines([item('li_1')], [ship()], ctx('US', 'fl')))
    expect(r).toHaveLength(2)
    for (const l of r) {
      expect(l.rate).toBe(0)
      expect(l.code).toBe('UNCALCULATED')
      // This is the flag an order report can query on. Without it, "no tax owed" and
      // "we forgot to switch tax on" look identical in the database.
      expect(l.data.calculated).toBe(false)
    }
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('warns once, not once per cart recalculation', async () => {
    const p = new StripeTaxProvider({ logger }, { homeState: 'FL', enabled: false })
    for (let i = 0; i < 5; i++) await p.getTaxLines([item('li_1')], [], ctx('US', 'fl'))
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('distinguishes "switched off" from "key missing" in the reason', async () => {
    const off = new StripeTaxProvider({ logger }, { homeState: 'FL', enabled: false, apiKey: 'sk_x' })
    const nokey = new StripeTaxProvider({ logger }, { homeState: 'FL', enabled: true })
    expect(lines(await off.getTaxLines([item('li_1')], [], ctx('US', 'fl')))[0].data.reason)
      .toMatch(/STRIPE_TAX_ENABLED off/)
    expect(lines(await nokey.getTaxLines([item('li_1')], [], ctx('US', 'fl')))[0].data.reason)
      .toMatch(/STRIPE_API_KEY missing/)
  })

  it('never omits a line — every item and shipping method gets one', async () => {
    const p = new StripeTaxProvider({ logger }, { homeState: 'FL' })
    const r = lines(await p.getTaxLines(
      [item('li_1'), item('li_2'), item('li_3')], [ship('sm_1'), ship('sm_2')], ctx('US', 'fl')
    ))
    expect(r.filter((l) => l.line_item_id)).toHaveLength(3)
    expect(r.filter((l) => l.shipping_line_id)).toHaveLength(2)
  })
})

describe('live calculation', () => {
  // NY must be in nexus or these cases fall through the no-nexus branch instead of
  // reaching Stripe — which is how the breakdown test first "passed" on a flat zero line.
  const p = new StripeTaxProvider(
    { logger },
    { homeState: 'FL', nexusStates: ['NY'], enabled: true, apiKey: 'sk_test_x' }
  )
  const originalFetch = global.fetch

  afterEach(() => { global.fetch = originalFetch })

  const stubFetch = (payload: any, ok = true) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok, status: ok ? 200 : 402,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }) as any
  }

  it('sends integer minor units, not the decimal Medusa hands us', async () => {
    stubFetch({ id: 'taxcalc_1', line_items: { data: [] } })
    await p.getTaxLines([item('li_1', 64.99, 2)], [ship('sm_1', 4.99)], ctx('US', 'fl'))
    const body = (global.fetch as jest.Mock).mock.calls[0][1].body as URLSearchParams
    // 64.99 * 2 = 12998 cents. Sending 129.98 would be a 100x overcharge.
    expect(body.get('line_items[0][amount]')).toBe('12998')
    expect(body.get('shipping_cost[amount]')).toBe('499')
    expect(body.get('customer_details[address][state]')).toBe('FL')
  })

  it('carries the jurisdiction breakdown, because an audit asks for the split', async () => {
    stubFetch({
      id: 'taxcalc_2',
      line_items: { data: [{
        reference: 'li_1', amount: 6499, amount_tax: 577,
        tax_breakdown: [
          { jurisdiction: { display_name: 'New York', level: 'state' }, amount: 260,
            tax_rate_details: { tax_type: 'sales_tax' } },
          { jurisdiction: { display_name: 'New York City', level: 'city' }, amount: 317 },
        ],
      }] },
      shipping_cost: { amount: 499, amount_tax: 44 },
    })
    const r = lines(await p.getTaxLines([item('li_1')], [ship()], ctx('US', 'ny')))
    const li = r.find((l) => l.line_item_id)!
    // Assert the code, not just calculated=true: a no-nexus line is *also* calculated,
    // so checking that flag alone cannot tell the two paths apart.
    expect(li.code).toBe('sales_tax')
    expect(li.data.calculation_id).toBe('taxcalc_2')
    expect(li.data.amount_tax).toBe(577)
    expect(li.data.breakdown).toHaveLength(2)
    expect(li.name).toBe('New York')
    // 577/6499 = 8.8783% — NYC's 8.875% plus rounding. Must not collapse to 8.88.
    expect(li.rate).toBeCloseTo(8.8783, 3)
    expect(r.find((l) => l.shipping_line_id)!.data.calculated).toBe(true)
  })

  it('keeps checkout alive when the tax API fails, but marks the claim', async () => {
    stubFetch({ error: { message: 'rate limited' } }, false)
    const r = lines(await p.getTaxLines([item('li_1')], [], ctx('US', 'fl')))
    // Fail open on the sale...
    expect(r).toHaveLength(1)
    expect(r[0].rate).toBe(0)
    // ...closed on the claim.
    expect(r[0].code).toBe('PROVIDER_ERROR')
    expect(r[0].data.calculated).toBe(false)
    expect(logger.error).toHaveBeenCalled()
  })

  it('does not call Stripe at all where there is no nexus', async () => {
    stubFetch({ id: 'x' })
    await p.getTaxLines([item('li_1')], [], ctx('US', 'wy'))
    // 0.5% of volume is billed per calculation. Not asking is also the cheaper answer.
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('effectiveRate', () => {
  it('is zero when either side is missing, never NaN', () => {
    expect(effectiveRate(undefined, 100)).toBe(0)
    expect(effectiveRate(10, undefined)).toBe(0)
    expect(effectiveRate(10, 0)).toBe(0)
  })

  it('keeps four decimal places', () => {
    expect(effectiveRate(887, 10000)).toBe(8.87)
    expect(effectiveRate(8875, 100000)).toBe(8.875)
  })
})
