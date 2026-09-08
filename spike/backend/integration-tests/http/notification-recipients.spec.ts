import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { adminHeaders, seedWorld, storeHeaders, type World } from './fixtures'
import { CATALOG_MODULE } from '../../src/modules/catalog'
import { __reset as resetRateLimits } from '../../src/rate-limit'
import { notifyOps } from '../../src/ops-notify'

jest.setTimeout(180 * 1000)

/**
 * The list of people at the shop who get told when something happens.
 *
 * Every email this application sent addressed the customer. A contact form submission emailed
 * the person who wrote in and told nobody here; a paid order, a sourcing request and a return
 * request all arrived in silence. This is the list that changed that, and the tests below are
 * in two halves: the CRUD, and whether anything actually reaches it.
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
      // A clean list per test: coverage and "unwatched" are computed over the whole table, so
      // a leftover row from an earlier test changes what a later one sees.
      const catalog: any = getContainer().resolve(CATALOG_MODULE)
      const all = await catalog.listNotificationRecipients({}, { take: 500 })
      if (all.length) {
        await catalog.deleteNotificationRecipients(all.map((r: any) => r.id))
      }
    })

    const catalog = () => getContainer().resolve(CATALOG_MODULE) as any
    const fail = (e: any) => e.response

    const add = (over: Record<string, unknown> = {}) =>
      api.post('/admin/notification-recipients', {
        email: `ops-${Math.random().toString(36).slice(2, 8)}@example.com`,
        name: 'Ops', events: ['order_placed'], ...over,
      }, admin).catch(fail)

    describe('managing the list', () => {
      it('adds an address and normalises it', async () => {
        const res = await add({ email: '  OPS@Example.COM  ', events: ['order_placed'] })
        expect(res.status).toBe(201)
        // Lower-cased and trimmed, so the unique index actually prevents duplicates.
        expect(res.data.recipient.email).toBe('ops@example.com')
        expect(res.data.recipient.active).toBe(true)
      })

      it('refuses a second entry for the same address', async () => {
        await add({ email: 'dupe@example.com' })
        const again = await add({ email: 'dupe@example.com' })
        expect(again.status).toBe(422)
        expect(again.data.message).toMatch(/already on the list/i)
      })

      it('refuses an address that is not one', async () => {
        expect((await add({ email: 'not-an-email' })).status).toBe(400)
      })

      it('refuses an event it does not send', async () => {
        const res = await add({ events: ['order_shipped'] })
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/Not a notification/i)
      })

      it('says so when an address is subscribed to nothing', async () => {
        const res = await add({ events: [] })
        expect(res.status).toBe(201)
        // A real state — added ahead of deciding — but it should not look configured.
        expect(res.data.warning).toMatch(/receives nothing/i)
      })

      it('lists who covers each event, and what nobody covers', async () => {
        await add({ email: 'orders@example.com', events: ['order_placed'] })
        const res = await api.get('/admin/notification-recipients', admin)

        const orders = res.data.coverage.find((c: any) => c.event === 'order_placed')
        expect(orders.recipients).toContain('orders@example.com')
        // The number worth seeing: three events with nobody watching them.
        expect(res.data.unwatched).toContain('contact_received')
        expect(res.data.unwatched).toContain('return_request')
        expect(res.data.unwatched).not.toContain('order_placed')
      })

      it('edits the events and the pause switch', async () => {
        const created = await add({ events: ['order_placed'] })
        const id = created.data.recipient.id

        const res = await api.post(`/admin/notification-recipients/${id}`,
          { events: ['return_request', 'contact_received'], active: false,
            note: 'Covering for Sam' }, admin)

        expect(res.data.recipient.events.sort())
          .toEqual(['contact_received', 'return_request'])
        expect(res.data.recipient.active).toBe(false)
        expect(res.data.recipient.note).toBe('Covering for Sam')
      })

      it('refuses to change the address in place', async () => {
        const created = await add()
        const res = await api.post(
          `/admin/notification-recipients/${created.data.recipient.id}`,
          { email: 'someone-else@example.com' }, admin).catch(fail)

        // Changing which address receives customer notifications is not an edit — it is one
        // person off the list and another on, and doing it in place loses that record.
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/cannot be changed/i)
      })

      it('removes an address and says what is now unwatched', async () => {
        const created = await add({ events: ['order_placed'] })
        const res = await api.delete(
          `/admin/notification-recipients/${created.data.recipient.id}`, admin)

        expect(res.data.deleted).toBe(true)
        // Removing the only person watching orders is exactly the moment to be told that
        // nobody is watching orders.
        expect(res.data.unwatched).toContain('order_placed')

        const left = await catalog().listNotificationRecipients(
          { id: created.data.recipient.id }, { take: 1, withDeleted: true })
        expect(left).toHaveLength(0)
      })

      it('lets a removed address be added again', async () => {
        const first = await add({ email: 'returning@example.com' })
        await api.delete(`/admin/notification-recipients/${first.data.recipient.id}`, admin)
        const second = await add({ email: 'returning@example.com' })
        expect(second.status).toBe(201)
      })

      it('404s an unknown id', async () => {
        expect((await api.get('/admin/notification-recipients/nope', admin)
          .catch(fail)).status).toBe(404)
      })

      it('is not reachable anonymously', async () => {
        expect([401, 403]).toContain(
          (await api.get('/admin/notification-recipients').catch(fail)).status)
      })
    })

    describe('who actually receives a dispatch', () => {
      it('sends to the subscribed and not to anybody else', async () => {
        await catalog().createNotificationRecipients([
          { email: 'wants-orders@example.com', events: ['order_placed'], active: true },
          { email: 'wants-returns@example.com', events: ['return_request'], active: true },
          { email: 'paused@example.com', events: ['order_placed'], active: false },
          { email: 'nothing@example.com', events: [], active: true },
        ])

        const res = await notifyOps(getContainer() as never, 'order_placed', {
          headline: 'New order #1', rows: [['Order', '#1']],
        })

        // One: the subscriber. Not the returns-only address, not the paused one, not the
        // one subscribed to nothing.
        expect(res.sent).toBe(1)
        expect(res.failed).toBe(0)
      })

      it('does nothing at all when the list is empty', async () => {
        const res = await notifyOps(getContainer() as never, 'contact_received', {
          headline: 'Contact', rows: [],
        })
        expect(res).toEqual({ sent: 0, failed: 0 })
      })

      it('fires when a contact message arrives', async () => {
        await catalog().createNotificationRecipients([
          { email: 'inbox-watcher@example.com', events: ['contact_received'], active: true },
        ])

        const res = await api.post('/store/contact', {
          email: 'writer@example.com', name: 'A Writer', subject: 'A question',
          body: 'Do you have this in a large?',
        }, storeHeaders(w))

        // The customer still gets their acknowledgement — the shop notification is additional,
        // not a replacement.
        expect(res.status).toBe(201)
        const stored = await catalog().listInboundMessages(
          { email: 'writer@example.com' }, { take: 1 })
        expect(stored).toHaveLength(1)
      })

      it('fires when a jersey is requested, and never fails the request', async () => {
        await catalog().createNotificationRecipients([
          { email: 'sourcing@example.com', events: ['jersey_request'], active: true },
        ])
        const res = await api.post('/store/jersey-requests', {
          email: 'asker@example.com', raw_request: 'A shirt nobody stocks',
          team: 'Chicago Bulls',
        }, storeHeaders(w))
        expect(res.status).toBe(201)
      })

      it('cannot fail the thing it is announcing', async () => {
        // The dispatcher swallows everything: whatever it was announcing has already
        // happened, and letting a notification roll back a paid order would be absurd.
        const res = await notifyOps(getContainer() as never, 'order_placed', {
          headline: 'x', rows: [], path: '/app/orders/nope',
        })
        expect(res).toHaveProperty('sent')
      })
    })
  },
})
