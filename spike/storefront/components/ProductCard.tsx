import type { Card } from '@/lib/medusa'
import { money, mediaUrl, mediaSrcSet } from '@/lib/medusa'

export default function ProductCard({ p }: { p: Card }) {
  const d = p.detail ?? {}
  const sub = [d.team, d.colourway].filter(Boolean).join(' · ')
  return (
    <a className="card" href={`/jerseys/${p.handle}`}>
      <figure>
        {p.thumbnail
          ? <img
              src={mediaUrl(p.thumbnail, 400) ?? undefined}
              srcSet={mediaSrcSet(p.thumbnail)}
              sizes="(max-width: 600px) 50vw, 240px"
              alt={[d.player, d.team, d.colourway, d.garment]
                .filter(Boolean).join(' ') || p.title}
              loading="lazy" decoding="async" />
          : <div className="noimg">No image</div>}
      </figure>
      <div className="meta">
        {/* A custom shirt has no player, so `d.player || p.title` correctly falls through
            to the title — but without the badge it sits next to a $65.99 shirt at $89.99
            with nothing on the card explaining why. */}
        {d.is_custom && <span className="custombadge">Printing included</span>}
        <p className="t">{d.player || p.title}</p>
        {sub && <p className="sub">{sub}</p>}
        <p className="p">{money(p.price)}</p>
      </div>
    </a>
  )
}
