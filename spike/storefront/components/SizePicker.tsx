'use client'
import { useState } from 'react'
import type { Variant } from '@/lib/medusa'
import AddToBag from './AddToBag'
import NotifyMe from './NotifyMe'
import Personalise, { type Offer, type Selection } from './Personalise'

/**
 * Size buttons, not a dropdown — research.md §12.8 block 3.
 *
 * Combinations that have no variant are disabled rather than hidden. A product offering
 * Unisex S–2XL plus Youth YS–Y2XL lists all ten values on the Size option, so a
 * Unisex/YS pairing is selectable in the UI and does not exist in the catalog. Hiding it
 * makes the grid jump; disabling it explains itself.
 */
export default function SizePicker({ variants, fits, product, offer }:
  { variants: (Variant & { size: string; fit?: string })[]; fits: string[]; offer?: Offer | null
    product: { id: string; title: string; team?: string | null; player?: string | null
               colourway?: string | null; colour_hex?: string | null } }) {
  const multiFit = fits.length > 1
  const [fit, setFit] = useState(fits[0] ?? '')
  const [size, setSize] = useState<string | null>(null)
  // Held here rather than inside Personalise so add-to-cart can send it. The control owns
  // validation; the buy box owns the purchase.
  const [pers, setPers] = useState<Selection | null>(null)

  const forFit = multiFit ? variants.filter((v) => v.fit === fit) : variants
  const available = new Set(forFit.map((v) => v.size))
  const allSizes = [...new Set(variants.map((v) => v.size))]
  const chosen = forFit.find((v) => v.size === size)

  return (
    <>
      {multiFit && (
        <>
          <p className="eyebrow" id="fit-label" style={{ marginTop: '1rem' }}>Fit</p>
          <div className="sizes" role="group" aria-labelledby="fit-label">
            {fits.map((f) => (
              <button key={f} aria-pressed={f === fit}
                      onClick={() => { setFit(f); setSize(null) }}>{f}</button>
            ))}
          </div>
        </>
      )}

      <p className="eyebrow" id="size-label">Size</p>
      <div className="sizes" role="group" aria-labelledby="size-label">
        {allSizes.map((s) => (
          <button key={s} aria-pressed={s === size} disabled={!available.has(s)}
                  aria-label={available.has(s) ? `Size ${s}` : `Size ${s}, unavailable${multiFit ? ` in ${fit}` : ''}`}
                  title={available.has(s) ? undefined : `Not available in ${fit}`}
                  onClick={() => setSize(s)}>{s}</button>
        ))}
      </div>
      <p aria-live="polite" className="visually-hidden">
        {size ? `Size ${size} selected` : 'No size selected'}
      </p>

      {/* Between size and add-to-cart, per spec §4 — the decision order a customer
          actually follows: which shirt, what size, then what goes on it. */}
      <Personalise
        productId={product.id}
        colour={product.colour_hex}
        offer={offer ?? null}
        onChange={setPers}
      />

      <AddToBag
        variantId={chosen?.id ?? null}
        label={chosen ? 'Add to bag' : 'Select a size'}
        personalisation={pers}
        productId={product.id}
        included={!!offer?.included}
      />

      <NotifyMe productId={product.id} title={product.title} team={product.team}
                player={product.player} colourway={product.colourway} size={size} />

      <div className="promise">
        <b>Delivery &amp; returns</b>
        <span>
          Tracked shipping. All sales are final except faults &mdash;{' '}
          <a href="/shipping">rates and lead times</a> ·{' '}
          <a href="/policies/refunds">refund policy</a>.
        </span>
      </div>
    </>
  )
}
