'use client'
import { useState, useTransition } from 'react'
import { addToCartAction, addPersonalisedAction } from '@/app/actions'
import type { Selection } from './Personalise'

/**
 * Add to bag.
 *
 * When a personalisation is present the personalised path is used, and it can partially
 * succeed: the shirt goes in the bag, the printing is refused server-side. That case gets
 * its own message rather than a generic failure, because "we couldn't add that" over a
 * shirt that *was* added is the worse of the two lies.
 */
export default function AddToBag({
  variantId, label, disabled, personalisation, productId, included,
}: {
  variantId: string | null; label: string; disabled?: boolean
  personalisation?: Selection | null; productId?: string
  /** Custom jersey: the printing is already in the shirt's price, so no add-on is created. */
  included?: boolean
}) {
  const [pending, start] = useTransition()
  const [added, setAdded] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)

  return (
    <>
      <button
        className="btn block"
        disabled={disabled || !variantId || pending}
        onClick={() => {
          if (!variantId) return
          start(async () => {
            setWarning(null)
            if (personalisation && productId) {
              const r = await addPersonalisedAction(
                variantId, productId, personalisation, { included }
              )
              if (!r.personalised) {
                setWarning('Added — but we couldn’t apply the printing. Nothing was charged for it.')
              }
            } else {
              await addToCartAction(variantId)
            }
            setAdded(true)
            setTimeout(() => setAdded(false), 2500)
          })
        }}
      >
        {pending
          ? 'Adding…'
          : added
            ? 'Added to bag'
            : personalisation
              // "+$0.00" on a custom shirt reads as a bug. Nothing is being added to the
              // price, so the button says what is true instead of showing a zero.
              ? personalisation.total > 0
                ? `${label} — +$${(personalisation.total / 100).toFixed(2)}`
                : `${label} — printing included`
              : label}
      </button>
      {warning && (
        <p role="alert" style={{ fontSize: '.85rem', marginTop: '.5rem', color: '#B4342A' }}>
          {warning}
        </p>
      )}
      {added && (
        <p role="status" style={{ fontSize: '.85rem', marginTop: '.5rem' }}>
          <a href="/cart" style={{ borderBottom: '1px solid currentColor' }}>View bag →</a>
        </p>
      )}
    </>
  )
}
