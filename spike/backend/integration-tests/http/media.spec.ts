import { medusaIntegrationTestRunner } from '@medusajs/test-utils'
import { createHash } from 'crypto'
import sharp from 'sharp'
import { ensureTable, putAsset, assetUrl } from '../../src/media-store'

jest.setTimeout(120 * 1000)

/**
 * Image bytes out of Postgres.
 *
 * The first test here is the one that matters, and it exists because the suite was green
 * while every image on the site was broken. The route originally lived at
 * `/store/media/:sha`, and everything under /store requires an `x-publishable-api-key`
 * header. The tests fetched through the API client, which sets that header automatically,
 * so they passed; a browser's `<img src>` cannot set a header, so it got
 * `{"type":"not_allowed"}` and rendered nothing.
 *
 * So the assertion is not "the endpoint returns bytes" — it is "the endpoint returns bytes
 * *the way a browser asks for them*", with no headers at all.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let sha: string
    let raw: Buffer

    beforeAll(async () => {
      const container = getContainer()
      await ensureTable(container)
      // A real 1400px-wide WebP, so the resize path has something to narrow.
      raw = await sharp({
        create: { width: 1400, height: 1000, channels: 3, background: '#0E9E88' },
      }).webp({ quality: 78 }).toBuffer()
      sha = createHash('sha256').update(raw).digest('hex')
      await putAsset(container, {
        id: `mda_${sha.slice(0, 24)}`,
        sha256: sha,
        mime: 'image/webp',
        width: 1400,
        height: 1000,
        bytes: raw.length,
        data: raw,
      })
    })

    describe('media is reachable the way a browser reaches it', () => {
      it('serves bytes with no publishable key, because an <img> cannot send one', async () => {
        // Bare axios, deliberately not the api client: the client adds the header that
        // masked this bug for an entire build.
        const res = await api.get(assetUrl(sha), {
          responseType: 'arraybuffer',
          headers: { 'x-publishable-api-key': undefined },
          transformRequest: [(d: unknown) => d],
        })
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toBe('image/webp')
        expect(Buffer.from(res.data).length).toBe(raw.length)
      })

      it('proves the previous test is not vacuous', async () => {
        // If suppressing the header did nothing, the test above would pass whether or not
        // the route were gated, and we would be back where we started. So: send the same
        // suppressed request to a route that is definitely gated, and require a refusal.
        const res = await api.get('/store/products?limit=1', {
          headers: { 'x-publishable-api-key': undefined },
          transformRequest: [(d: unknown) => d],
          validateStatus: () => true,
        })
        expect(res.status).toBe(400)
        expect(JSON.stringify(res.data)).toMatch(/publishable/i)
      })

      it('lives outside the /store namespace', () => {
        // Guards the URL shape itself. If assetUrl ever moves back under /store, every
        // image breaks again and this fails immediately rather than at launch.
        expect(assetUrl(sha)).toBe(`/media/${sha}.webp`)
        expect(assetUrl(sha).startsWith('/store/')).toBe(false)
      })
    })

    describe('the format in the url', () => {
      it('serves a real PNG when the url asks for one', async () => {
        // The route already accepted `.png` and threw the extension away, answering with
        // WebP bytes under a WebP content type — a URL that lied about its own content.
        // Nothing noticed while every consumer was a browser, because browsers read the
        // content type and all of them decode WebP.
        const res = await api.get(`/media/${sha}.png`, { responseType: 'arraybuffer' })
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toBe('image/png')
        // The PNG magic number, so this cannot pass on the header alone.
        const bytes = Buffer.from(res.data as ArrayBuffer)
        expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
      })

      it('serves a real JPEG when the url asks for one', async () => {
        const res = await api.get(`/media/${sha}.jpg`, { responseType: 'arraybuffer' })
        expect(res.headers['content-type']).toBe('image/jpeg')
        const bytes = Buffer.from(res.data as ArrayBuffer)
        expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
      })

      it('still serves WebP by default', async () => {
        const res = await api.get(assetUrl(sha), { responseType: 'arraybuffer' })
        expect(res.headers['content-type']).toBe('image/webp')
      })

      it('keeps the ETag unchanged for a request whose bytes did not move', async () => {
        // The regression this pins: appending the format to the ETag unconditionally
        // changed it for every existing `.webp` URL, which invalidates every cached image
        // in every browser and CDN for a response that is byte-identical.
        const plain = await api.get(assetUrl(sha), { responseType: 'arraybuffer' })
        expect(plain.headers['etag']).toBe(`"${sha}"`)
      })

      it('varies the ETag when the format does change the bytes', async () => {
        // The other half: a PNG and a WebP at the same address must not share an ETag, or a
        // cache serves one for the other.
        const webp = await api.get(assetUrl(sha), { responseType: 'arraybuffer' })
        const png = await api.get(`/media/${sha}.png`, { responseType: 'arraybuffer' })
        expect(png.headers['etag']).not.toBe(webp.headers['etag'])
      })

      it('is what the Open Graph route needs, since Satori cannot decode WebP', async () => {
        // The consumer that found the bug: it fetched the shirt, silently got bytes it could
        // not read, and rendered a share card with a blank panel — no error, on a route only
        // crawlers request.
        const res = await api.get(`/media/${sha}.png?w=800`, { responseType: 'arraybuffer' })
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toBe('image/png')
      })
    })

    describe('caching', () => {
      it('is immutable for a year, because the URL is the content hash', async () => {
        const res = await api.get(assetUrl(sha), { responseType: 'arraybuffer' })
        expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
        expect(res.headers['etag']).toBe(`"${sha}"`)
      })

      it('answers 304 to a matching If-None-Match', async () => {
        const res = await api.get(assetUrl(sha), {
          headers: { 'If-None-Match': `"${sha}"` },
          validateStatus: () => true,
        })
        expect(res.status).toBe(304)
      })

      it('reports a second read as a cache hit, so the db is asked once', async () => {
        await api.get(assetUrl(sha), { responseType: 'arraybuffer' })
        const res = await api.get(assetUrl(sha), { responseType: 'arraybuffer' })
        expect(res.headers['x-media-cache']).toBe('hit')
      })
    })

    describe('derivatives', () => {
      it.each([200, 400, 800])('renders w=%i smaller than the original', async (w) => {
        const res = await api.get(`${assetUrl(sha)}?w=${w}`, { responseType: 'arraybuffer' })
        expect(res.status).toBe(200)
        const meta = await sharp(Buffer.from(res.data)).metadata()
        expect(meta.width).toBe(w)
        // The point of rendering on demand: nothing extra is stored, and the wire is
        // smaller than the canonical asset.
        expect(Buffer.from(res.data).length).toBeLessThan(raw.length)
      })

      it('varies the ETag per width, so a 400 is never served as a 1400', async () => {
        const a = await api.get(`${assetUrl(sha)}?w=200`, { responseType: 'arraybuffer' })
        const b = await api.get(`${assetUrl(sha)}?w=800`, { responseType: 'arraybuffer' })
        expect(a.headers['etag']).not.toBe(b.headers['etag'])
      })

      it('ignores a width outside the allow-list rather than rendering it', async () => {
        // An open resize parameter is a CPU amplification vector: ?w=1 through ?w=9999
        // is 9,999 encodes from one URL.
        const res = await api.get(`${assetUrl(sha)}?w=999`, { responseType: 'arraybuffer' })
        expect(res.status).toBe(200)
        expect((await sharp(Buffer.from(res.data)).metadata()).width).toBe(1400)
      })

      it('does not upscale', async () => {
        const res = await api.get(`${assetUrl(sha)}?w=1400`, { responseType: 'arraybuffer' })
        expect((await sharp(Buffer.from(res.data)).metadata()).width).toBe(1400)
      })
    })

    describe('bad input', () => {
      it('rejects anything that is not a content address', async () => {
        for (const key of ['not-a-sha.webp', '../../etc/passwd', 'abc.webp']) {
          const res = await api.get(`/media/${encodeURIComponent(key)}`, {
            validateStatus: () => true,
          })
          expect(res.status).toBe(400)
        }
      })

      it('404s a well-formed address that is not stored', async () => {
        const res = await api.get(`/media/${'0'.repeat(64)}.webp`, {
          validateStatus: () => true,
        })
        expect(res.status).toBe(404)
      })
    })
  },
})
