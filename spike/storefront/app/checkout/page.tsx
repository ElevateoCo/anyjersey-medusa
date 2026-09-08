import { getCart, getZone, initPayment, shippingOptions, checkoutSettings } from '@/lib/cart'
import { setCustomerAction } from '@/app/actions'
import { money } from '@/lib/medusa'
import { getRegion, getRegionCountries } from '@/lib/region'
import StripePayment from '@/components/StripePayment'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Checkout', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function Checkout({ searchParams }:
  { searchParams: Promise<{ step?: string }> }) {
  const { step } = await searchParams
  const cart = await getCart()
  if (!cart || !cart.items?.length) redirect('/cart')

  const onPayment = step === 'payment' && !!cart.shipping_methods?.length
  let secret: string | null = null
  if (onPayment) {
    try { secret = await initPayment() } catch { secret = null }
  }
  const options = onPayment ? [] : await shippingOptions()
  // The countries this region will actually accept, and the zone that prices it. Both come
  // from the backend; neither is a constant in this file any more.
  const [countries, region, zone, checkout] = await Promise.all([
    getRegionCountries(), getRegion(), getZone(), checkoutSettings(),
  ])
  const discount = cart.discount_total ?? 0
  const promos = (cart.promotions ?? []).filter((p) => !!p.code)
  // One country means one set of labels; more than one and "ZIP"/"State" stop being right.
  const isUS = countries.length === 1 && countries[0]?.code === 'us'

  return (
    <section className="band">
      <div className="wrap checkout">
        <div>
          <h1>Checkout</h1>
          <ol className="steps-inline">
            <li className={!onPayment ? 'on' : 'done'}>1. Details</li>
            <li className={onPayment ? 'on' : ''}>2. Payment</li>
          </ol>

          {!onPayment ? (
            <form action={setCustomerAction} className="cform">
              <h2>Where is it going?</h2>
              <p>
                <label htmlFor="email">Email</label>
                <input id="email" name="email" type="email" required
                       autoComplete="email" defaultValue={cart.email ?? ''} />
              </p>
              <p>
                <label htmlFor="phone">
                  Phone {checkout.phone_required ? '' : <span className="optional">(optional)</span>}
                </label>
                {/* `type="tel"` rather than `text`: it brings up the right keypad on a phone,
                    which is where most of this traffic is. No pattern — numbers are formatted
                    a dozen ways across the five regions this ships to, and a regex that
                    rejects a valid international number costs an order. */}
                <input id="phone" name="phone" type="tel"
                       required={checkout.phone_required}
                       autoComplete="tel" inputMode="tel"
                       defaultValue={(cart.shipping_address as { phone?: string } | null)?.phone ?? ''}
                       aria-describedby="phone-why" />
                <span id="phone-why" className="fieldnote">
                  For the courier, if there is a problem with your delivery. We do not call you
                  about anything else.
                </span>
              </p>
              <div className="two">
                <p>
                  <label htmlFor="first_name">First name</label>
                  <input id="first_name" name="first_name" required autoComplete="given-name" />
                </p>
                <p>
                  <label htmlFor="last_name">Last name</label>
                  <input id="last_name" name="last_name" required autoComplete="family-name" />
                </p>
              </div>
              <p>
                <label htmlFor="address_1">Address</label>
                <input id="address_1" name="address_1" required autoComplete="address-line1" />
              </p>
              <div className="two">
                <p>
                  <label htmlFor="city">City</label>
                  <input id="city" name="city" required autoComplete="address-level2" />
                </p>
                <p>
                  <label htmlFor="province">{isUS ? 'State' : 'State / province / county'}</label>
                  <input id="province" name="province" required autoComplete="address-level1" />
                </p>
              </div>
              <div className="two">
                <p>
                  <label htmlFor="postal_code">
                    {/* "ZIP" is wrong everywhere except the US, and the form now offers
                        more than one country. */}
                    {isUS ? 'ZIP' : 'Postal code'}
                  </label>
                  <input id="postal_code" name="postal_code" required
                         inputMode={isUS ? 'numeric' : 'text'}
                         autoComplete="postal-code" />
                </p>
                <p>
                  <label htmlFor="country_code">Country</label>
                  {/* Was hardcoded to 'us' in the server action. Every non-US order was
                      therefore labelled domestic — wrong on the customs declaration and
                      wrong for tax. */}
                  <select id="country_code" name="country_code" required
                          defaultValue={countries[0]?.code ?? 'us'}>
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </p>
              </div>
              <p className="note">
                Shipping:{' '}
                {options[0]
                  ? `${options[0].name} — ${money(options[0].amount)}`
                  : zone
                    ? `${money(zone.rate)} to ${zone.name}, free over ${money(zone.freeOver)}`
                    : 'calculated next'}
                .{' '}
                {region
                  ? <>Delivering to <strong>{region.name}</strong>. Change it in the footer.</>
                  : null}
                {zone && zone.zone > 1
                  ? ' Import VAT and duty are calculated on the next step and included in the total you approve.'
                  : ''}
              </p>
              <button className="btn block" type="submit">Continue to payment</button>
            </form>
          ) : (
            <div className="cform">
              <h2>Payment</h2>
              <StripePayment clientSecret={secret} />
            </div>
          )}
        </div>

        <aside className="summary">
          <h2>Order</h2>
          <ul>
            {cart.items.map((l) => (
              <li key={l.id}>
                <span>{l.quantity}× {l.variant?.title} — {l.title}</span>
                <b>{money(l.subtotal)}</b>
              </li>
            ))}
          </ul>
          <div className="totals">
            <div><span>Subtotal</span><b>{money(cart.subtotal)}</b></div>
            {discount > 0 && (
              <div>
                <span>
                  Discount
                  {promos.length ? ` (${promos.map((p) => p.code).join(', ')})` : ''}
                </span>
                <b>&minus;{money(discount)}</b>
              </div>
            )}
            <div><span>Shipping</span><b>{money(cart.shipping_total)}</b></div>
            <div><span>Tax</span><b>{money(cart.tax_total)}</b></div>
            <div className="grand"><span>Total</span><b>{money(cart.total)}</b></div>
          </div>
          <p className="note">
            {/* Stated where the money is, not only on the policy page. */}
            All sales are final except faults &mdash;{' '}
            <a href="/policies/refunds">refund policy</a>. Check the{' '}
            <a href="/size-guide">size guide</a> before you pay; size is the one thing we
            cannot take back.
          </p>
        </aside>
      </div>
    </section>
  )
}
