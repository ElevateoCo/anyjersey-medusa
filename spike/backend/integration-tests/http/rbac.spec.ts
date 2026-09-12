import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { seedWorld, type World } from './fixtures'
import { ROLES } from '../../src/policies'
import { assignRole, ensureRbacSeed } from '../../src/rbac-seed'

jest.setTimeout(180 * 1000)

/**
 * Authorisation, with enforcement actually on.
 *
 * The unit suite proves every admin route declares a policy. It cannot prove the policies do
 * anything, because Medusa only wraps a handler with the permission check when the `rbac`
 * feature flag is set — with the flag off, every declaration in `middlewares.ts` is inert and
 * a suite that ran without it would pass whether or not the wiring worked.
 *
 * So this file turns the flag on. That is the only place in the repository where enforcement
 * is exercised, and without it the whole thing would be `assertConfigured()` again: declared,
 * documented, and called from nowhere.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: { MEDUSA_FF_RBAC: 'true' },
  testSuite: ({ api, getContainer }) => {
    let w: World
    const roleIds: Record<string, string> = {}

    /** Create a user, give them a role, sign in, and hand back their headers. */
    const userWithRole = async (email: string, roleKey?: keyof typeof ROLES) => {
      const container = getContainer()
      const userModule: any = container.resolve(Modules.USER)
      const authModule: any = container.resolve(Modules.AUTH)
      const password = 'supersecret'

      const registered = await api
        .post('/auth/user/emailpass/register', { email, password })
        .catch((e: any) => e.response)

      const existing = await userModule.listUsers({ email })
      const user = existing[0] ?? (await userModule.createUsers([{ email }]))[0]

      if (registered?.data?.token) {
        const claims = JSON.parse(
          Buffer.from(registered.data.token.split('.')[1], 'base64').toString()
        )
        await authModule.updateAuthIdentities([
          { id: claims.auth_identity_id, app_metadata: { user_id: user.id } },
        ])
      }

      if (roleKey) await assignRole(container, user.id, roleIds[roleKey])

      // Signed in *after* the link exists: generate-jwt-token reads roles at sign-in, so a
      // token issued before the assignment carries none.
      const login = await api.post('/auth/user/emailpass', { email, password })
      return { headers: { Authorization: `Bearer ${login.data.token}` } }
    }

    let owner: { headers: Record<string, string> }
    let staff: { headers: Record<string, string> }
    let roleless: { headers: Record<string, string> }

    beforeAll(async () => {
      w = await seedWorld(getContainer())

      // The same seeding the script runs, not a fixture that resembles it. Medusa's own
      // module loader has already created the Super Admin role and the `*:*` policy by this
      // point, which is exactly the condition the helper has to be idempotent against.
      const seeded = await ensureRbacSeed(getContainer())
      Object.assign(roleIds, seeded.roleIds)

      owner = await userWithRole('owner@test.local', 'owner')
      staff = await userWithRole('staff@test.local', 'staff')
      roleless = await userWithRole('nobody@test.local')
    })

    const fail = (e: any) => e.response

    describe('the owner wildcard', () => {
      it('reads what staff can read', async () => {
        const res = await api.get('/admin/catalog', owner)
        expect(res.status).toBe(200)
      })

      it('reaches the integrations screen', async () => {
        const res = await api.get('/admin/integrations', owner)
        expect(res.status).toBe(200)
      })

      it('can sweep the image store', async () => {
        const res = await api.get('/admin/media/orphans', owner)
        expect(res.status).toBe(200)
      })

      it('can create a product', async () => {
        const res = await api.post('/admin/jerseys', {
          title: 'Owner Created Jersey', handle: `owner-made-${Date.now()}`,
          price: '65.99', sizes: ['S'], team: 'Chicago Bulls',
        }, owner).catch(fail)
        expect(res.status).toBe(201)
      })
    })

    describe('staff can do the daily work', () => {
      it('reads the catalog', async () => {
        const res = await api.get('/admin/catalog', staff)
        expect(res.status).toBe(200)
      })

      it('corrects a product’s catalog fields', async () => {
        const res = await api.post(`/admin/catalog/${w.detailId}`,
          { colourway: 'grey' }, staff).catch(fail)
        expect(res.status).toBe(200)
      })

      it('works the inbox and the returns queue', async () => {
        expect((await api.get('/admin/inbound-messages', staff)).status).toBe(200)
        expect((await api.get('/admin/return-requests', staff)).status).toBe(200)
        expect((await api.get('/admin/jersey-requests', staff)).status).toBe(200)
        expect((await api.get('/admin/reviews', staff)).status).toBe(200)
      })

      it('reads orders and the revenue report', async () => {
        expect((await api.get('/admin/reports/overview', staff)).status).toBe(200)
      })

      it('reads the customer list, because finding a person is the job', async () => {
        // Answering "where is my order" starts with finding the customer. Denying the list
        // would make Staff a role that cannot do the thing Staff exists for.
        expect((await api.get('/admin/customer-list', staff)).status).toBe(200)
      })

      it('reads the order register, because working the queue is the job', async () => {
        // Gated on `order:read`, which Staff already has for the revenue report. A picker
        // who cannot see which orders are unfulfilled cannot pick.
        expect((await api.get('/admin/order-list', staff)).status).toBe(200)
      })
    })

    describe('staff cannot do the dangerous things', () => {
      it('is refused every delete', async () => {
        const created = await api.post('/admin/jerseys', {
          title: 'Undeletable By Staff', handle: `staff-cannot-${Date.now()}`,
          price: '65.99', sizes: ['S'], team: 'Chicago Bulls',
        }, owner)

        const res = await api.delete(`/admin/jerseys/${created.data.product.id}`, staff)
          .catch(fail)
        expect(res.status).toBe(403)
      })

      it('cannot create a product', async () => {
        const res = await api.post('/admin/jerseys', {
          title: 'Staff Created', handle: `staff-made-${Date.now()}`,
          price: '65.99', sizes: ['S'],
        }, staff).catch(fail)
        expect(res.status).toBe(403)
      })

      it('cannot export the customer list, though they can read it', async () => {
        /**
         * The finest-grained split in the whole role, and the most important one.
         *
         * Reading the list is daily work. Taking every customer's name, address, phone and
         * email off the system as a file is the same act subject access is owner-only for,
         * so the export is gated on `privacy:read` rather than `customer:read` — one answer
         * to "who can extract customer data in bulk" instead of two that drift apart.
         */
        const res = await api.get('/admin/customer-list/export', staff).catch(fail)
        expect(res.status).toBe(403)

        // And the owner can, or the split would just be a broken feature.
        expect((await api.get('/admin/customer-list/export', owner)).status).toBe(200)
      })

      it('cannot export the order register either, for the same reason', async () => {
        // A register carries every customer's name, address and phone arranged differently
        // — the same personal data, so the same lock. Gating it on `order:read`, which
        // Staff has, would give the bulk extract a second door with a weaker one.
        const res = await api.get('/admin/order-list/export', staff).catch(fail)
        expect(res.status).toBe(403)

        expect((await api.get('/admin/order-list/export', owner)).status).toBe(200)
      })

      it('cannot see which keys are configured', async () => {
        // That screen names every missing key, and the keys behind it are money.
        const res = await api.get('/admin/integrations', staff).catch(fail)
        expect(res.status).toBe(403)
      })

      it('cannot sweep the image store', async () => {
        const res = await api.delete('/admin/media/orphans',
          { ...staff, data: { sha256: [] } }).catch(fail)
        expect(res.status).toBe(403)
      })

      it('cannot erase the contact inbox', async () => {
        const res = await api.delete('/admin/inbound-messages/whatever', staff).catch(fail)
        // 403 before 404: authorisation is decided before the row is looked up, so a refused
        // caller learns nothing about what exists.
        expect(res.status).toBe(403)
      })

      it('cannot delete a collection but can edit one', async () => {
        const c = await api.post('/admin/curated-collections',
          { title: 'Staff Editable', handle: `staff-edit-${Date.now()}` }, owner)
        const handle = c.data.collection.handle

        const edit = await api.post(`/admin/curated-collections/${handle}`,
          { title: 'Edited By Staff' }, staff).catch(fail)
        expect(edit.status).toBe(200)

        const remove = await api.delete(`/admin/curated-collections/${handle}`, staff)
          .catch(fail)
        expect(remove.status).toBe(403)
      })
    })

    describe('a user with no roles', () => {
      it('is refused everything, even reads', async () => {
        // The check rejects an empty role list before consulting a single policy. This is
        // the behaviour that makes enabling the flag without seeding a lockout, and it is
        // why /health/ready refuses to report ready in that state.
        const res = await api.get('/admin/catalog', roleless).catch(fail)
        expect(res.status).toBe(403)
      })

      it('is still authenticated, which is the distinction', async () => {
        const anon = await api.get('/admin/catalog').catch(fail)
        expect([401, 403]).toContain(anon.status)
        // Authentication succeeded and authorisation failed — two different gates, and
        // before this work only the first one existed.
        const res = await api.get('/admin/catalog', roleless).catch(fail)
        expect(res.status).toBe(403)
      })
    })

    describe('readiness refuses to report ready without an owner', () => {
      it('is ready while an owner holds the wildcard', async () => {
        const res = await api.get('/health/ready').catch(fail)
        expect(res.data.rbac).toBe('enforced')
        expect(res.data.checks.rbac.ok).toBe(true)
      })
    })
  },
})
