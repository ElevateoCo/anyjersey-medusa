import { ImageResponse } from 'next/og'
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`

/**
 * The default share card, inherited by every route without its own.
 *
 * Drawn rather than photographed, for two reasons that matter here: there is no brand
 * artwork to embed, and a share card generated from the design tokens cannot drift out of
 * date the way a checked-in PNG does.
 *
 * No web font is loaded. `ImageResponse` needs font *bytes*, and fetching Oswald at render
 * time would put a network call — and a failure mode — on the OG route, which is requested
 * by crawlers rather than customers and so fails invisibly. A system stack renders the same
 * words in the same colours; the yellow block is what makes it recognisable, not the
 * typeface.
 */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: '#121212',
          color: '#ffffff',
          padding: '80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 92, fontWeight: 800,
                      letterSpacing: '-0.01em', textTransform: 'uppercase' }}>
          <span>Find&nbsp;</span>
          <span style={{ background: '#F9E806', color: '#121212', padding: '0 16px' }}>Any</span>
          <span>&nbsp;Jersey</span>
        </div>
        {/* `display: flex` is not decorative here. Satori — the renderer behind
            ImageResponse — throws on any div with more than one child node that has no
            explicit display, and a JSX line mixing text with an entity is several nodes.
            Without it the route 500s and the share card silently becomes a bare URL. */}
        <div style={{ display: 'flex', marginTop: 32, fontSize: 40, color: '#D6D6D2',
                      maxWidth: 900 }}>
          {`${SITE_TAGLINE}. Can’t find yours? Request it.`}
        </div>
      </div>
    ),
    size
  )
}
