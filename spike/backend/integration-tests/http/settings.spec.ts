import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { adminHeaders, seedWorld, storeHeaders, type World } from './fixtures'
import { CATALOG_MODULE } from '../../src/modules/catalog'
import { __reset as resetRateLimits } from '../../src/rate-limit'
import { isSettingEnabled } from '../../src/settings'

jest.setTimeout(180 * 1000)

/**
 * Switching the automatic emails off, and on again.
 *
 * The half worth testing hardest is not the switch — it is everything that must keep working
 * around it. A suppressed acknowledgement must not fail the request that triggered it, must
 * not abandon the HTTP response, and must not stop the row being written. All three are ways
 * this feature could quietly break the store while looking like it worked.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let w: World
    let admin: { headers: Record<string, string> }

    beforeAll(async () => {
      w = await seedWorld(getContainer())
      admin = await adminHeaders(getContainer(), api)
    })

    beforeEach(async () => {
      resetRateLimits()
      const catalog: any = getContainer().resolve(CATALOG_MODULE)
      const rows = await catalog.listStoreSettings({}, { take: 100 })
      if (rows.length) await catalog.deleteStoreSettings(rows.map((r: any) => r.id))
    })

    const fail = (e: any) => e.response
    const set = (key: string, enabled: boolean, reason?: string) =>
      api.post(`/admin/settings/${key}`, { enabled, reason }, admin).catch(fail)

    describe('the switches', () => {
      it('reports everything as on before anything is stored', async () => {
        const res = await api.get('/admin/settings', admin)
        expect(res.status).toBe(200)
        expect(res.data.settings.every((m: any) => m.enabled)).toBe(true)
        expect(res.data.disabled_count).toBe(0)
        // The default lives in code, not in a seed — a fresh database sends everything.
        expect(res.data.settings.length).toBeGreaterThanOrEqual(5)
      })

      it('refuses to switch something off without a reason', async () => {
        const res = await set('contact_received', false)
        expect(res.status).toBe(400)
        // The consequence is in the refusal, so a caller that skipped the UI still reads it.
        expect(res.data.message).toMatch(/needs a reason/i)
        expect(res.data.message).toMatch(/auto-reply/i)
      })

      it('switches off with a reason, and records who and when', async () => {
        const res = await set('contact_received', false, 'Testing the switch')
        expect(res.status).toBe(200)
        expect(res.data.setting.enabled).toBe(false)
        expect(res.data.setting.reason).toBe('Testing the switch')
        expect(res.data.setting.disabled_at).toBeTruthy()
        // "Off since Tuesday, by whom" is the question this table exists to answer.
        expect(res.data.setting.disabled_by).toBeTruthy()
        expect(res.data.warning).toBeTruthy()
      })

      it('switches back on without asking for anything', async () => {
        await set('contact_received', false, 'Testing')
        const res = await set('contact_received', true)
        expect(res.status).toBe(200)
        expect(res.data.setting.enabled).toBe(true)
        // Restoring the default is never the harder direction, and the audit fields clear.
        expect(res.data.setting.disabled_at).toBeNull()
        expect(res.data.setting.reason).toBeNull()
      })

      it('surfaces a critical message being off, distinctly', async () => {
        await set('order_placed', false, 'Migrating provider')
        const res = await api.get('/admin/settings', admin)
        expect(res.data.disabled_count).toBe(1)
        expect(res.data.critical_disabled).toEqual(['order_placed'])
      })

      it('refuses a key that is not switchable', async () => {
        // Manual sends have no switch: pressing the button is the switch.
        const res = await set('request_sourced', false, 'x')
        expect(res.status).toBe(404)
        expect(res.data.message).toMatch(/not a switchable setting/i)
      })

      it('refuses a non-boolean', async () => {
        const res = await api.post('/admin/settings/contact_received',
          { enabled: 'maybe' }, admin).catch(fail)
        expect(res.status).toBe(400)
      })

      it('is owner-only', async () => {
        expect([401, 403]).toContain(
          (await api.get('/admin/settings').catch(fail)).status)
      })
    })

    describe('what happens when one is off', () => {
      it('still writes the row, still answers 201, just does not send', async () => {
        await set('contact_received', false, 'Testing')

        const res = await api.post('/store/contact', {
          email: 'quiet@example.com', name: 'Quiet', subject: 'Hello',
          body: 'A message that should still be recorded.',
        }, storeHeaders(w))

        // The three things that must survive a suppressed send. The response is the one that
        // would have broken first: an early return inside the send block would have skipped
        // res.json() and hung the request.
        expect(res.status).toBe(201)
        expect(res.data.id).toBeTruthy()

        const catalog: any = getContainer().resolve(CATALOG_MODULE)
        const stored = await catalog.listInboundMessages(
          { email: 'quiet@example.com' }, { take: 1 })
        expect(stored).toHaveLength(1)
      })

      it('does not stop a jersey request being taken', async () => {
        await set('request_received', false, 'Testing')
        const res = await api.post('/store/jersey-requests', {
          email: 'silent@example.com', raw_request: 'A shirt, quietly',
        }, storeHeaders(w))
        expect(res.status).toBe(201)
      })

      it('leaves every other message alone', async () => {
        await set('contact_received', false, 'Testing')
        expect(await isSettingEnabled(getContainer() as never, 'order_placed')).toBe(true)
        expect(await isSettingEnabled(getContainer() as never, 'contact_received')).toBe(false)
      })

      it('groups the settings, and reports both groups', async () => {
        const res = await api.get('/admin/settings', admin)
        const groups = res.data.groups.map((g: any) => g.group)
        expect(groups).toContain('message')
        expect(groups).toContain('checkout')
        // One table, one audit trail, one dialog — the alternative was a second table with
        // the same five columns the moment a non-message switch appeared.
        expect(res.data.settings.some((s: any) => s.group === 'checkout')).toBe(true)
      })

      it('treats an unknown key as on', async () => {
        // Fails open by design: not sending a receipt because a settings lookup missed is a
        // customer who paid and heard nothing, caused by something unrelated to them.
        expect(await isSettingEnabled(getContainer() as never, 'no_such_message')).toBe(true)
      })
    })
    describe('requiring a phone number at checkout', () => {
      const cartWithAddress = async (phone?: string) => {
        const { data } = await api.post('/store/carts', {
          region_id: w.regionId, sales_channel_id: w.salesChannelId,
          email: `phone-${Math.random().toString(36).slice(2, 8)}@example.com`,
        }, storeHeaders(w))
        const id = data.cart.id
        await api.post(`/store/carts/${id}/line-items`,
          { variant_id: w.variantIds[0], quantity: 1 }, storeHeaders(w))
        await api.post(`/store/carts/${id}`, {
          shipping_address: {
            first_name: 'P', last_name: 'T', address_1: '1 St', city: 'Dallas',
            province: 'TX', postal_code: '75201', country_code: 'us',
            ...(phone ? { phone } : {}),
          },
        }, storeHeaders(w))
        const opts = await api.get(`/store/shipping-options?cart_id=${id}`, storeHeaders(w))
        await api.post(`/store/carts/${id}/shipping-methods`,
          { option_id: opts.data.shipping_options[0].id }, storeHeaders(w))
        const pc = await api.post('/store/payment-collections', { cart_id: id }, storeHeaders(w))
        await api.post(
          `/store/payment-collections/${pc.data.payment_collection.id}/payment-sessions`,
          { provider_id: 'pp_system_default' }, storeHeaders(w))
        return id
      }

      const complete = (id: string) =>
        api.post(`/store/carts/${id}/complete`, {}, storeHeaders(w)).catch(fail)

      it('starts on, with no row in the table', async () => {
        // The default lives in the code. A fresh database requires a phone number without
        // anything having been seeded.
        const res = await api.get('/store/checkout-settings', storeHeaders(w))
        expect(res.data.phone_required).toBe(true)
      })

      it('refuses to complete an order without one', async () => {
        const id = await cartWithAddress()
        const res = await complete(id)

        // Enforced at completion rather than by the form's `required` attribute — a rule that
        // only holds for people using the form is not a rule.
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/phone number is required/i)
        expect(res.data.field).toBe('shipping_address.phone')
      })

      it('completes when one is given', async () => {
        const id = await cartWithAddress('+1 214 555 0142')
        const res = await complete(id)
        expect(res.status).toBe(200)
      })

      it('refuses something that is not a phone number', async () => {
        const id = await cartWithAddress('n/a')
        const res = await complete(id)
        expect(res.status).toBe(400)
      })

      it('accepts an international format', async () => {
        // Loose on format, strict on presence: a regex that rejects a valid international
        // number costs an order, and the five regions this ships to format them a dozen ways.
        const id = await cartWithAddress('+44 (0)20 7946 0958')
        const res = await complete(id)
        expect(res.status).toBe(200)
      })

      it('lets an order through once the requirement is switched off', async () => {
        await set('phone_required', false, 'Too much checkout friction')
        try {
          const store = await api.get('/store/checkout-settings', storeHeaders(w))
          expect(store.data.phone_required).toBe(false)

          const id = await cartWithAddress()
          const res = await complete(id)
          expect(res.status).toBe(200)
        } finally {
          await set('phone_required', true)
        }
      })

      it('needs a reason to switch off, and names the cost', async () => {
        const res = await set('phone_required', false)
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/undeliverable parcels/i)
      })
    })
  },
})
