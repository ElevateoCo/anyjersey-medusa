import { getCart, getZone } from '@/lib/cart'
import { groupLines } from '@/lib/line-groups'
import { money } from '@/lib/medusa'
import CartLine from '@/components/CartLine'
import PromoCode from '@/components/PromoCode'
import RequestBlock from '@/components/RequestBlock'

// Transactional, and a crawler fetching it creates carts.
export const metadata = { title: 'Your bag', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function CartPage() {
  const cart = await getCart()
  const items = cart?.items ?? []
  const subtotal = cart?.subtotal ?? 0
  // Rate and threshold come from the zone this cart's region belongs to, never from a
  // constant in the storefront.
  const zone = await getZone()
  const promos = (cart?.promotions ?? [])
    .filter((p) => !!p.code)
    .map((p) => ({ code: p.code as string }))
  // Rounded to cents once, here, and every line below is derived from the rounded value.
  // Medusa returned 9.7485 for a 15% discount on $64.99; displaying money(9.7485) as $9.75
  // while summing the raw figure lets the column stop adding up on screen by a cent. §6.2
  // is about not doing arithmetic on floats — this is the display-layer corollary: show and
  // sum the same numbers.
  const cents = (n: number) => Math.round(n * 100) / 100
  const discount = cents(cart?.discount_total ?? 0)
  const threshold = zone?.freeOver ?? 0
  const rate = zone?.rate ?? 0
  const toFree = threshold ? Math.max(0, threshold - subtotal) : 0
  const pct = threshold ? Math.min(100, Math.round((subtotal / threshold) * 100)) : 0

  if (!items.length) {
    return (
      <>
        <section className="band">
          <div className="wrap">
            <h1>Your bag is empty</h1>
            <p style={{ marginTop: '.75rem' }}>
              <a href="/jerseys" className="btn" style={{ marginTop: '1rem' }}>Shop jerseys</a>
            </p>
          </div>
        </section>
        <RequestBlock source="homepage" />
      </>
    )
  }

  return (
    <section className="band">
      <div className="wrap" style={{ maxWidth: 900 }}>
        <h1>Your bag</h1>

        {/* Free shipping progress — the discount mechanic §9.1 recommends over % off,
            because it protects the processed amount and costs the freight, not 20%. */}
        {threshold > 0 && (
          <div className="freeship">
            {toFree > 0
              ? <p><strong>{money(toFree)}</strong> away from free shipping
                  {zone ? <> to {zone.name}</> : null}</p>
              : <p><strong>Free shipping unlocked</strong></p>}
            <div className="bar"><span style={{ width: `${pct}%` }} /></div>
          </div>
        )}

        <table className="cart">
          <caption className="visually-hidden">Items in your bag</caption>
          <thead>
            <tr>
              <th scope="col"><span className="visually-hidden">Image</span></th>
              <th scope="col">Item</th>
              <th scope="col">Qty</th>
              <th scope="col" style={{ textAlign: 'right' }}>Subtotal</th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {groupLines(items).map((l) => <CartLine key={l.id} line={l} />)}
          </tbody>
        </table>

        <div className="totals">
          <div><span>Subtotal</span><b>{money(subtotal)}</b></div>
          {discount > 0 && (
            <div>
              <span>Discount</span>
              {/* Medusa's promotion engine computed this. Nothing here derives a discount —
                  a client that can name one can name 100% (§5.2 rule 1). */}
              <b>&minus;{money(discount)}</b>
            </div>
          )}
          <div>
            <span>Shipping{zone ? ` — ${zone.name}` : ''}</span>
            <b>{toFree > 0 ? money(rate) : 'Free'}</b>
          </div>
          <div className="grand">
            <span>Total</span>
            <b>{money(cents(subtotal) - discount + (toFree > 0 ? cents(rate) : 0))}</b>
          </div>
          <p className="note">
            Tax calculated at checkout.
            {zone && zone.zone > 1 ? ' Import VAT and duties are added there too.' : ''}
          </p>

          <PromoCode applied={promos} />

          <a className="btn block" href="/checkout">Checkout</a>
        </div>
      </div>
    </section>
  )
}
