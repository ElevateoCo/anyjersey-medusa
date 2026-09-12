import { mediaUrl } from '@/lib/medusa'
import TileRail from './TileRail'

/**
 * Band E — the sport rail.
 *
 * Two revisions, and the second is the one worth explaining.
 *
 * **It is a rail, not a grid.** The `anyjersey_files/demo` concept lays these out 4 × 2. As
 * a grid that is two screens of tiles before a product appears and the second row is below
 * the fold on every laptop, so the sports at the bottom of the catalogue end up at the
 * bottom of the page too. One scrolling row keeps every sport the same distance from the
 * top and gives the band a fixed height whatever the catalogue grows to.
 *
 * **The label sits under the photograph, not on it.** The first version bled the images
 * edge to edge and set the label over them under a dark scrim. That is what nflshop.com
 * does in its hero, and it costs something this catalogue cannot easily pay: type over a
 * photograph nobody art-directed has no guaranteed contrast, so the scrim has to be heavy
 * enough for the worst case — a white shirt on a white wall — which darkens every image
 * that did not need it. Their *editorial* rail puts the caption underneath on the page
 * ground instead, and that is the pattern here now.
 *
 * What it buys, beyond looking less muddy:
 *
 * - The label is ink on paper, which is a colour pair `contrast_check.py` can actually
 *   evaluate. Text over an image is not, and the previous version had to be argued about in
 *   a comment instead of measured.
 * - The photographs are shown rather than dimmed. `DEFERRED.md` §6: two products in three
 *   have exactly one photograph and none of it is lifestyle work, so the little there is
 *   should be legible.
 * - The count stops being a pill floating over a corner and becomes part of the sentence
 *   under the tile, where it reads as information rather than as a badge.
 */
export type Tile = {
  label: string
  sub: string
  href: string
  /** A product thumbnail from the catalogue. No placeholder: a tile without one goes dark. */
  image?: string | null
  /** Folded into the caption line rather than shown as a badge. */
  count?: number
  /** One tile may carry the yellow. More than one and none of them is the emphasis. */
  accent?: boolean
}

export default function Mosaic({ tiles, label = 'Shop by sport' }: {
  tiles: Tile[]
  label?: string
}) {
  if (!tiles.length) return null
  return (
    <section className="mosaic" aria-label={label}>
      {/* Inside `.wrap`, so the first tile's edge and its caption line up with every
          heading above and below it. An earlier version bled the row to the viewport and
          computed the gutter back with `100vw` arithmetic — which is off by the scrollbar
          width, and was visibly off: the row started at 0 while the section under it
          started at 96. The row still overflows its container, so the peek that tells a
          thumb there is more survives. */}
      <div className="wrap">
        <TileRail label={label}>
          {tiles.map((t, i) => (
            <a key={t.href} className={t.accent ? 'tile accent' : 'tile'} href={t.href}>
            <figure>
              {t.image && (
                <img
                  src={mediaUrl(t.image, 800) ?? undefined}
                  alt=""
                  aria-hidden="true"
                  // The first two are above the fold on every viewport; the rest are off to
                  // the right of it, and eager-loading nine 800px images on 4G is the
                  // failure `layout-plan.md` §6 item 9 warns about.
                  loading={i < 2 ? 'eager' : 'lazy'}
                  decoding="async"
                  sizes="(max-width: 700px) 70vw, 320px"
                />
              )}
            </figure>
            <span className="tiletext">
              <strong>{t.label}</strong>
              <span>
                {t.sub}
                {t.count !== undefined && (
                  <> &middot; {t.count.toLocaleString()} shirts</>
                )}
              </span>
            </span>
          </a>
        ))}
        </TileRail>
      </div>
    </section>
  )
}
