import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { adminHeaders, seedWorld, storeHeaders, type World } from './fixtures'
import { CATALOG_MODULE } from '../../src/modules/catalog'
import { __reset as resetRateLimits } from '../../src/rate-limit'
import { isSuppressed, unsubscribeToken, addressFromToken } from '../../src/suppression'

jest.setTimeout(180 * 1000)

/**
 * Consent and unsubscribe on the one commercial email.
 *
 * Everything else this shop sends is transactional and needs neither. The cart-recovery email
 * goes to somebody who did *not* buy, to persuade them to — so it needs a lawful basis, and
 * PECR's soft opt-in gives it one only on condition that every message offers a simple means
 * of refusing. That condition is what these tests are about: the link has to be there, the
 * refusal has to stick, and a refusal must not be overridable by whoever is pressing the
 * button.
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

    beforeEach(() => resetRateLimits())

    const catalog = () => getContainer().resolve(CATALOG_MODULE) as any
    const fail = (e: any) => e.response

    describe('the token', () => {
      it('round-trips an address', () => {
        expect(addressFromToken(unsubscribeToken('Person@Example.com')))
          .toBe('person@example.com')
      })

      it('refuses a token whose address was edited', () => {
        // The whole point: somebody can unsubscribe themselves and nobody else.
        const token = unsubscribeToken('victim@example.com')
        const [, signature] = token.split('.')
        const forged = `${Buffer.from('someone-else@example.com').toString('base64url')}.${signature}`
        expect(addressFromToken(forged)).toBeNull()
      })

      it('refuses rubbish', () => {
        expect(addressFromToken('')).toBeNull()
        expect(addressFromToken('nonsense')).toBeNull()
        expect(addressFromToken('a.b')).toBeNull()
      })
    })

    describe('the public endpoint', () => {
      it('confirms a valid link without acting on it', async () => {
        const email = 'confirm-me@example.com'
        const res = await api.get(
          `/store/unsubscribe?token=${encodeURIComponent(unsubscribeToken(email))}`,
          storeHeaders(w))

        expect(res.data.valid).toBe(true)
        // Masked: enough to recognise your own address, not a disclosure.
        expect(res.data.email).not.toBe(email)
        expect(res.data.email).toMatch(/^c\*+@example\.com$/)

        // A GET must not unsubscribe — a corporate link-scanner follows every URL in an
        // incoming email, and would otherwise opt people out who never opened it.
        expect(await isSuppressed(getContainer() as never, email)).toBe(false)
      })

      it('unsubscribes on POST, from a token alone', async () => {
        const email = 'clicked@example.com'
        const res = await api.post('/store/unsubscribe',
          { token: unsubscribeToken(email) }, storeHeaders(w))

        expect(res.data.ok).toBe(true)
        expect(await isSuppressed(getContainer() as never, email)).toBe(true)
      })

      it('accepts the token in the query string, for one-click', async () => {
        // RFC 8058: Gmail and Yahoo POST to the List-Unsubscribe URL itself, with no body of
        // ours in it.
        const email = 'one-click@example.com'
        const res = await api.post(
          `/store/unsubscribe?token=${encodeURIComponent(unsubscribeToken(email))}`,
          {}, storeHeaders(w))

        expect(res.data.ok).toBe(true)
        expect(await isSuppressed(getContainer() as never, email)).toBe(true)
      })

      it('is idempotent', async () => {
        const email = 'twice@example.com'
        const token = unsubscribeToken(email)
        await api.post('/store/unsubscribe', { token }, storeHeaders(w))
        const again = await api.post('/store/unsubscribe', { token }, storeHeaders(w))
        expect(again.data.ok).toBe(true)

        const rows = await catalog().listInboundMessages({ email }, { take: 10 })
        expect(rows.filter((r: any) => r.kind === 'suppression')).toHaveLength(1)
      })

      it('answers the same for an address it has never seen', async () => {
        // "You were not subscribed" is both unhelpful and a way to test whether an address is
        // known to us.
        const res = await api.post('/store/unsubscribe',
          { token: unsubscribeToken('stranger@example.com') }, storeHeaders(w))
        expect(res.data.ok).toBe(true)
      })

      it('refuses an invalid token', async () => {
        const res = await api.post('/store/unsubscribe', { token: 'forged' }, storeHeaders(w))
          .catch(fail)
        expect(res.status).toBe(400)
      })

      it('stamps every list the address is on, not just one', async () => {
        const email = 'on-two-lists@example.com'
        await api.post('/store/newsletter', { email }, storeHeaders(w))
        await api.post('/store/unsubscribe',
          { token: unsubscribeToken(email) }, storeHeaders(w))

        // One click covers everything, rather than leaving somebody to discover a second
        // list later.
        const rows = await catalog().listInboundMessages({ email }, { take: 10 })
        expect(rows.every((r: any) => !!r.unsubscribed_at)).toBe(true)
      })
    })

    describe('cart recovery respects it', () => {
      const abandonedCart = async (email: string) => {
        const { data } = await api.post('/store/carts', {
          region_id: w.regionId, sales_channel_id: w.salesChannelId, email,
        }, storeHeaders(w))
        await api.post(`/store/carts/${data.cart.id}/line-items`,
          { variant_id: w.variantIds[0], quantity: 1 }, storeHeaders(w))
        return data.cart.id
      }

      const recover = (cartId: string) =>
        api.post(`/admin/abandoned-carts/${cartId}/recover`, {}, admin).catch(fail)

      it('refuses to email somebody who unsubscribed', async () => {
        const email = 'optedout@example.com'
        await api.post('/store/unsubscribe',
          { token: unsubscribeToken(email) }, storeHeaders(w))
        const cartId = await abandonedCart(email)

        process.env.SHOP_POSTAL_ADDRESS = '1 Example Street, Dallas TX 75201'
        try {
          const res = await recover(cartId)
          expect(res.status).toBe(409)
          expect(res.data.suppressed).toBe(true)
        } finally {
          delete process.env.SHOP_POSTAL_ADDRESS
        }
      })

      it('does not let force override a refusal', async () => {
        // `force` exists to resend to somebody who did not reply. It is not a way past
        // somebody who said no.
        const email = 'no-means-no@example.com'
        await api.post('/store/unsubscribe',
          { token: unsubscribeToken(email) }, storeHeaders(w))
        const cartId = await abandonedCart(email)

        process.env.SHOP_POSTAL_ADDRESS = '1 Example Street, Dallas TX 75201'
        try {
          const res = await api.post(
            `/admin/abandoned-carts/${cartId}/recover?force=true`, {}, admin).catch(fail)
          expect(res.status).toBe(409)
          expect(res.data.suppressed).toBe(true)
        } finally {
          delete process.env.SHOP_POSTAL_ADDRESS
        }
      })

      it('refuses to send without a postal address', async () => {
        const cartId = await abandonedCart('willing@example.com')
        delete process.env.SHOP_POSTAL_ADDRESS

        const res = await recover(cartId)
        expect(res.status).toBe(409)
        expect(res.data.outstanding).toBe('SHOP_POSTAL_ADDRESS')
      })

      it('sends when there is consent, an address and a link', async () => {
        const cartId = await abandonedCart('happy@example.com')
        process.env.SHOP_POSTAL_ADDRESS = '1 Example Street, Dallas TX 75201'
        try {
          const res = await recover(cartId)
          expect(res.status).toBe(200)
        } finally {
          delete process.env.SHOP_POSTAL_ADDRESS
        }
      })
    })
  },
})
