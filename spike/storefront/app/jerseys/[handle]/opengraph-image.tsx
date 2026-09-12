import { ImageResponse } from 'next/og'
import { getProduct, mediaUrl } from '@/lib/medusa'
import { SITE_NAME } from '@/lib/site'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * A per-product share card: the shirt, and what it is.
 *
 * The product image is referenced by URL and fetched by the renderer. It can fail — the
 * backend may be down, or a product may have no image at all — so the layout is built to
 * work without it rather than to depend on it. A share card that 500s is a link that unfurls
 * as a bare URL, which is worse than one without a photograph.
 */
export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const p = await getProduct(handle).catch(() => null)

  const title = p?.title ?? SITE_NAME
  const detail = p?.jersey_detail
  const eyebrow = [detail?.league, detail?.team].filter(Boolean).join(' · ')
  // PNG, not the default WebP: Satori cannot decode WebP and fails silently, which is how
  // this shipped once already with a blank panel where the shirt should be.
  const img = mediaUrl(p?.images?.[0]?.url ?? p?.thumbnail, 800, 'png')

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#121212',
                    color: '#fff', fontFamily: 'sans-serif' }}>
        {img && (
          <div style={{ width: 500, height: '100%', display: 'flex', background: '#F7F7F5' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} width={500} height={630} alt=""
                 style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
          </div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
                      justifyContent: 'center', padding: 64 }}>
          {eyebrow && (
            <div style={{ fontSize: 26, letterSpacing: '0.14em', textTransform: 'uppercase',
                          color: '#F9E806', marginBottom: 24 }}>
              {eyebrow}
            </div>
          )}
          <div style={{ fontSize: img ? 52 : 68, fontWeight: 800, lineHeight: 1.1,
                        textTransform: 'uppercase' }}>
            {title}
          </div>
          <div style={{ marginTop: 32, fontSize: 26, color: '#D6D6D2' }}>
            Sourced to order at {SITE_NAME}
          </div>
        </div>
      </div>
    ),
    size
  )
}
