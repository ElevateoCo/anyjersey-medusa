import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import sharp from 'sharp'
import { seedWorld, storeHeaders, adminHeaders, type World } from './fixtures'

jest.setTimeout(180 * 1000)

/**
 * Creating a jersey from the admin, end to end.
 *
 * The assertion this file exists for is the storefront one. Everything else here —
 * the product row, the variants, the images — is visible in the admin whether or not it is
 * correct, and the failure this endpoint prevents is *invisible* there: a Medusa product
 * with no `jersey_detail` has no team and no `search_text`, and `/store/jerseys` filters
 * through the product↔detail link, so the product exists, looks healthy, and no customer
 * can reach it by any route. So a create is not asserted to have worked until the shop can
 * find it by team and by free text.
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

    /** A real image, generated rather than committed as a fixture. */
    const png = (r: number, g: number, b: number) =>
      sharp({ create: { width: 24, height: 16, channels: 3, background: { r, g, b } } })
        .png().toBuffer()

    const upload = async (buffers: Buffer[], names?: string[]) => {
      const form = new FormData()
      buffers.forEach((b, i) => {
        form.append('files', new Blob([new Uint8Array(b)]), names?.[i] ?? `shot-${i}.png`)
      })
      return api.post('/admin/media/upload', form, admin).catch((e: any) => e.response)
    }

    const create = (over: Record<string, unknown> = {}) =>
      api.post('/admin/jerseys', {
        title: 'Chicago Bulls Derrick Rose Red Jersey',
        price: '65.99',
        sizes: ['S', 'M', 'L'],
        status: 'published',
        team: 'Chicago Bulls',
        player: 'Derrick Rose',
        league: 'nba',
        sport: 'basketball',
        colourway: 'Red',
        season: '2011',
        ...over,
      }, admin).catch((e: any) => e.response)

    // ------------------------------------------------------------------ upload
    describe('POST /admin/media/upload', () => {
      it('optimises an upload to WebP and content-addresses it', async () => {
        const res = await upload([await png(200, 20, 20)])
        expect(res.status).toBe(200)

        const [file] = res.data.uploaded
        // The URL is the content address, which is what makes it safe to serve immutable
        // for a year.
        expect(file.url).toMatch(/^\/media\/[0-9a-f]{64}\.webp$/)
        expect(file.deduped).toBe(false)
        expect(res.data.failed).toHaveLength(0)
      })

      it('serves the bytes back through the media route', async () => {
        const res = await upload([await png(20, 200, 20)])
        const { url } = res.data.uploaded[0]

        const img = await api.get(url, { responseType: 'arraybuffer' })
        expect(img.status).toBe(200)
        expect(img.headers['content-type']).toBe('image/webp')
        // Content-addressed, so it can never change at this URL.
        expect(img.headers['cache-control']).toContain('immutable')
      })

      it('dedupes the same image rather than storing it twice', async () => {
        const bytes = await png(20, 20, 200)
        const first = await upload([bytes])
        const second = await upload([bytes])

        expect(second.data.uploaded[0].url).toBe(first.data.uploaded[0].url)
        expect(second.data.uploaded[0].deduped).toBe(true)
      })

      it('takes several files in one drop', async () => {
        // Visibly different colours on purpose. Two near-identical solids encode to the
        // same WebP bytes and therefore to the same content address, which would make this
        // a test of deduplication wearing the wrong name.
        const res = await upload([await png(240, 10, 10), await png(10, 10, 240)])
        expect(res.data.uploaded).toHaveLength(2)
        expect(new Set(res.data.uploaded.map((u: any) => u.url)).size).toBe(2)
      })

      it('refuses a file that is not an image, whatever it claims to be', async () => {
        const form = new FormData()
        // Named .png and typed as an image. The check is on the decoded bytes, because the
        // declared type is whatever the caller felt like sending.
        form.append('files', new Blob([new Uint8Array(Buffer.from('not an image'))],
          { type: 'image/png' }), 'lies.png')
        const res = await api.post('/admin/media/upload', form, admin)
          .catch((e: any) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.failed[0].error).toMatch(/not an image/i)
      })

      it('reports a mixed batch as 207 rather than as success', async () => {
        const form = new FormData()
        form.append('files', new Blob([new Uint8Array(await png(9, 9, 9))]), 'good.png')
        form.append('files', new Blob([new Uint8Array(Buffer.from('junk'))]), 'bad.png')
        const res = await api.post('/admin/media/upload', form, admin)
          .catch((e: any) => e.response)

        // A 200 here would let a caller that only checks the status code report two
        // successes when one file was rejected.
        expect(res.status).toBe(207)
        expect(res.data.uploaded).toHaveLength(1)
        expect(res.data.failed).toHaveLength(1)
      })

      it('refuses an unauthenticated upload', async () => {
        const form = new FormData()
        form.append('files', new Blob([new Uint8Array(await png(7, 7, 7))]), 'x.png')
        const res = await api.post('/admin/media/upload', form)
          .catch((e: any) => e.response)
        expect([401, 403]).toContain(res.status)
      })
    })

    // ------------------------------------------------------------------ create
    describe('POST /admin/jerseys', () => {
      it('creates the product and its catalog row together', async () => {
        const img = await upload([await png(180, 30, 40)])
        const res = await create({
          handle: 'bulls-rose-red-create',
          images: [img.data.uploaded[0].url],
        })

        expect(res.status).toBe(201)
        expect(res.data.product.handle).toBe('bulls-rose-red-create')
        expect(res.data.product.variants).toHaveLength(3)
        expect(res.data.detail.team).toBe('Chicago Bulls')
        // Folded at write time, which is what makes the trigram index usable.
        expect(res.data.detail.search_text)
          .toBe('chicago bulls derrick rose red 2011 basketball jersey')
      })

      it('makes it findable on the storefront by team and by search', async () => {
        const img = await upload([await png(30, 60, 180)])
        await create({
          handle: 'bulls-rose-visible',
          title: 'Chicago Bulls Scottie Pippen Red Jersey',
          player: 'Scottie Pippen',
          images: [img.data.uploaded[0].url],
        })

        // region_id is not optional in practice: the listing selects
        // `variants.calculated_price`, and Medusa refuses to price without a context.
        const byTeam = await api.get(
          `/store/jerseys?team=${encodeURIComponent('Chicago Bulls')}` +
          `&region_id=${w.regionId}&limit=100`, storeHeaders(w))
        expect(byTeam.data.products.map((p: any) => p.handle))
          .toContain('bulls-rose-visible')

        // Free text goes through search_text. This is the assertion that a stock-admin
        // product would fail while looking perfectly correct in the dashboard.
        const byQuery = await api.get(
          `/store/jerseys?q=pippen&region_id=${w.regionId}&limit=100`, storeHeaders(w))
        expect(byQuery.data.products.map((p: any) => p.handle))
          .toContain('bulls-rose-visible')
      })

      it('derives a handle from the title when none is given', async () => {
        const res = await create({ title: 'Miami Heat Jimmy Butler Black Jersey' })
        expect(res.data.product.handle).toBe('miami-heat-jimmy-butler-black-jersey')
      })

      it('refuses a handle that is already taken', async () => {
        await create({ handle: 'taken-handle' })
        const again = await create({ handle: 'taken-handle' })
        // 422, because Medusa maps DUPLICATE_ERROR there. Asserted rather than assumed:
        // the admin screen shows `message`, so the code matters less than the sentence —
        // but a test that expects the wrong code hides a change in either.
        expect(again.status).toBe(422)
        expect(again.data.message).toMatch(/already in use/)
      })

      it('refuses an image URL that did not come from the upload endpoint', async () => {
        const res = await create({
          handle: 'foreign-image',
          images: ['https://cdn.example.com/shirt.jpg'],
        })
        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/not an uploaded image/)
      })

      it('refuses a price with a comma decimal rather than truncating it', async () => {
        const res = await create({ handle: 'comma-price', price: '65,99' })
        expect(res.status).toBe(400)
      })

      it('refuses an unauthenticated create', async () => {
        const res = await api.post('/admin/jerseys', { title: 'x', price: '1' })
          .catch((e: any) => e.response)
        expect([401, 403]).toContain(res.status)
      })
    })

    // ------------------------------------------------------------------ read
    describe('GET /admin/jerseys/:id', () => {
      it('returns the product, its price, its sizes and its detail', async () => {
        const img = await upload([await png(11, 22, 33)])
        const created = await create({
          handle: 'read-me', images: [img.data.uploaded[0].url],
        })

        const res = await api.get(`/admin/jerseys/${created.data.product.id}`, admin)
        expect(res.data.price).toBe(65.99)
        expect(res.data.sizes).toEqual(['S', 'M', 'L'])
        expect(res.data.images).toHaveLength(1)
        expect(res.data.detail.player).toBe('Derrick Rose')
        expect(res.data.storefront_visible).toBe(true)
      })

      it('404s an unknown id', async () => {
        const res = await api.get('/admin/jerseys/prod_nope', admin)
          .catch((e: any) => e.response)
        expect(res.status).toBe(404)
      })
    })

    // ------------------------------------------------------------------ update
    describe('POST /admin/jerseys/:id', () => {
      it('edits product fields and catalog fields in one call', async () => {
        const created = await create({ handle: 'edit-me' })
        const id = created.data.product.id

        const res = await api.post(`/admin/jerseys/${id}`, {
          title: 'Chicago Bulls Michael Jordan Red Jersey',
          player: 'Michael Jordan',
          status: 'draft',
        }, admin)

        expect(res.data.title).toBe('Chicago Bulls Michael Jordan Red Jersey')
        expect(res.data.status).toBe('draft')
        expect(res.data.detail.player).toBe('Michael Jordan')
        // Re-derived, never taken from the caller — otherwise a renamed player stays
        // searchable only under the old name.
        expect(res.data.detail.search_text).toContain('michael jordan')
        expect(res.data.detail.search_text).not.toContain('derrick rose')
      })

      it('changes the price on every variant', async () => {
        const created = await create({ handle: 'reprice-me' })
        const id = created.data.product.id

        await api.post(`/admin/jerseys/${id}`, { price: '89.99' }, admin)
        const after = await api.get(`/admin/jerseys/${id}`, admin)
        expect(after.data.price).toBe(89.99)
      })

      it('keeps the thumbnail in step with the image order', async () => {
        const a = (await upload([await png(120, 0, 0)])).data.uploaded[0].url
        const b = (await upload([await png(0, 120, 0)])).data.uploaded[0].url
        const created = await create({ handle: 'reorder-me', images: [a, b] })
        const id = created.data.product.id

        const res = await api.post(`/admin/jerseys/${id}`, { images: [b, a] }, admin)
        // Without this the listing card and the gallery lead with different images.
        expect(res.data.thumbnail).toBe(b)
        expect(res.data.images).toEqual([b, a])
      })

      it('leaves untouched fields alone', async () => {
        const created = await create({ handle: 'partial-me' })
        const id = created.data.product.id

        await api.post(`/admin/jerseys/${id}`, { status: 'draft' }, admin)
        const after = await api.get(`/admin/jerseys/${id}`, admin)
        expect(after.data.title).toBe('Chicago Bulls Derrick Rose Red Jersey')
        expect(after.data.detail.team).toBe('Chicago Bulls')
        expect(after.data.price).toBe(65.99)
      })

      it('refuses a handle that another product already has', async () => {
        await create({ handle: 'occupied' })
        const other = await create({ handle: 'wants-occupied' })
        const res = await api.post(`/admin/jerseys/${other.data.product.id}`,
          { handle: 'occupied' }, admin).catch((e: any) => e.response)
        expect(res.status).toBe(422)
        expect(res.data.message).toMatch(/already in use/)
      })
    })

    // ------------------------------------------------------------------ delete
    describe('DELETE /admin/jerseys/:id', () => {
      it('removes it from the storefront and keeps the image', async () => {
        const img = await upload([await png(66, 33, 99)])
        const url = img.data.uploaded[0].url
        const created = await create({
          handle: 'delete-me', team: 'Detroit Pistons', images: [url],
        })
        const id = created.data.product.id

        const before = await api.get(
          `/store/jerseys?team=${encodeURIComponent('Detroit Pistons')}` +
          `&region_id=${w.regionId}&limit=100`, storeHeaders(w))
        expect(before.data.products.map((p: any) => p.handle)).toContain('delete-me')

        const res = await api.delete(`/admin/jerseys/${id}`, admin)
        expect(res.data.deleted).toBe(true)

        const after = await api.get(
          `/store/jerseys?team=${encodeURIComponent('Detroit Pistons')}` +
          `&region_id=${w.regionId}&limit=100`, storeHeaders(w))
        expect(after.data.products.map((p: any) => p.handle)).not.toContain('delete-me')

        // Images are shared by content address, so deleting a product must not blank an
        // unrelated one that happens to use identical bytes.
        const still = await api.get(url, { responseType: 'arraybuffer' })
        expect(still.status).toBe(200)
      })

      it('404s an unknown id', async () => {
        const res = await api.delete('/admin/jerseys/prod_nope', admin)
          .catch((e: any) => e.response)
        expect(res.status).toBe(404)
      })
    })
  },
})
