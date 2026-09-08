'use client'
import { groupLines } from '@/lib/line-groups'
import { useEffect, useState, useTransition } from 'react'
import { setQtyAction, removeLineAction } from '@/app/actions'
import { mediaUrl } from '@/lib/medusa'

/**
 * Cart drawer.
 *
 * §12.4 lists the cart drawer with a free-shipping progress bar as one of the reference
 * store's mechanics. The point is not the animation: adding to bag currently means either
 * losing the page or trusting a toast, and the free-shipping threshold — the discount
 * mechanic §9.1 prefers over percentage codes — only works if the customer can see how
 * close they are while they shop.
 *
 * /cart stays. This is the fast path, not a replacement.
 */
type Line = {
  id: string; title: string; quantity: number; subtotal: number
  thumbnail: string | null
  variant?: { title: string; sku: string; product?: { handle: string } } | null
}
type Data = {
  items: Line[]; subtotal: number
  zone: { name: string; rate: number; freeOver: number } | null
}

export default function CartDrawer({ open, onClose, data }:
  { open: boolean; onClose: () => void; data: Data }) {
  const [pending, start] = useTransition()

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.removeEventListener('keydown', key)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const money = (n: number) => `$${n.toFixed(2)}`
  const threshold = data.zone?.freeOver ?? 0
  const rate = data.zone?.rate ?? 0
  const toFree = threshold ? Math.max(0, threshold - data.subtotal) : 0
  const pct = threshold ? Math.min(100, Math.round((data.subtotal / threshold) * 100)) : 0

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <div className="drawer cart-drawer" role="dialog" aria-modal="true" aria-label="Your bag">
        <div className="drawer-head">
          <strong>Your bag{data.items.length ? ` (${data.items.length})` : ''}</strong>
          <button onClick={onClose} aria-label="Close bag">✕</button>
        </div>

        {threshold > 0 && data.items.length > 0 && (
          <div className="freeship in-drawer">
            {toFree > 0
              ? <p><strong>{money(toFree)}</strong> away from free shipping
                  {data.zone ? <> to {data.zone.name}</> : null}</p>
              : <p><strong>Free shipping unlocked</strong></p>}
            <div className="bar"><span style={{ width: `${pct}%` }} /></div>
          </div>
        )}

        <div className="drawer-body">
          {!data.items.length ? (
            <p style={{ fontSize: '.9rem', color: 'var(--ink-2)' }}>
              Nothing in here yet. <a href="/jerseys" onClick={onClose}
                style={{ borderBottom: '2px solid var(--yellow)' }}>Shop jerseys</a>
            </p>
          ) : (
            <ul className="drawerlines" style={{ opacity: pending ? 0.55 : 1 }}>
              {groupLines(data.items).map((l) => (
                <li key={l.id}>
                  {l.thumbnail
                    ? <img src={mediaUrl(l.thumbnail, 200) ?? undefined} alt=""
                           width={56} height={56} loading="lazy" />
                    : <span className="ph" />}
                  <div className="dl-meta">
                    <p className="dl-title">
                      {l.variant?.product?.handle
                        ? <a href={`/jerseys/${l.variant.product.handle}`} onClick={onClose}>
                            {l.title}
                          </a>
                        : l.title}
                    </p>
                    <p className="dl-sub">
                      {l.variant?.title}
                      {/* One physical item, one row — same reason as the cart page. */}
                      {l.addOns.length > 0 && ` · ${l.addOns.map((a) => a.variant?.title).join(', ')}`}
                    </p>
                    <div className="dl-qty">
                      <button aria-label="Decrease quantity" disabled={pending}
                              onClick={() => start(() => { setQtyAction(l.id, l.quantity - 1).then() })}>
                        −
                      </button>
                      <span>{l.quantity}</span>
                      <button aria-label="Increase quantity" disabled={pending}
                              onClick={() => start(() => { setQtyAction(l.id, l.quantity + 1).then() })}>
                        +
                      </button>
                      <button className="dl-remove" disabled={pending}
                              onClick={() => start(() => { removeLineAction(l.id).then() })}>
                        Remove
                      </button>
                    </div>
                  </div>
                  <span className="dl-price">{money(l.subtotal)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {data.items.length > 0 && (
          <div className="drawer-foot">
            <div className="dl-totals">
              <span>Subtotal</span><b>{money(data.subtotal)}</b>
            </div>
            <div className="dl-totals muted">
              <span>Shipping{data.zone ? ` — ${data.zone.name}` : ''}</span>
              <b>{toFree > 0 ? money(rate) : 'Free'}</b>
            </div>
            <a className="btn block" href="/checkout">Checkout</a>
            <a className="dl-view" href="/cart">View full bag</a>
          </div>
        )}
      </div>
    </>
  )
}
