import { getZones, money } from '@/lib/medusa'
import RequestBlock from '@/components/RequestBlock'
import { abs, euBlocked, euGateLifted, euGatesOutstanding } from '@/lib/site'

export const revalidate = 3600

export const metadata = {
  title: 'Shipping & delivery',
  description: 'Where we ship, what it costs, how long it takes, and who pays the duty.',
  alternates: { canonical: abs('/shipping') },
}

const COUNTRY_NAMES: Record<string, string> = {
  us: 'United States', ca: 'Canada', gb: 'United Kingdom', ie: 'Ireland',
  de: 'Germany', fr: 'France', es: 'Spain', it: 'Italy', nl: 'Netherlands',
  be: 'Belgium', dk: 'Denmark', se: 'Sweden', fi: 'Finland', at: 'Austria',
  pt: 'Portugal', pl: 'Poland', cz: 'Czechia', gr: 'Greece', hu: 'Hungary',
  ro: 'Romania', sk: 'Slovakia', si: 'Slovenia', hr: 'Croatia', bg: 'Bulgaria',
  ee: 'Estonia', lv: 'Latvia', lt: 'Lithuania', lu: 'Luxembourg', mt: 'Malta',
  cy: 'Cyprus', au: 'Australia', nz: 'New Zealand', jp: 'Japan', kr: 'South Korea',
  sg: 'Singapore', hk: 'Hong Kong',
}

/**
 * Shipping and delivery.
 *
 * Every number on this page comes from `/store/shipping-zones`, which is the same module
 * checkout charges from. That is not tidiness: the cart used to hardcode $4.99 and a $75
 * free-shipping threshold, which was right for the US and silently wrong everywhere else —
 * it promised free shipping over $75 on an order that costs $24.99 to ship. A public page
 * making that promise is worse than a cart making it, because it is the page a customer
 * quotes back at you.
 */
export default async function ShippingPage() {
  const zones = await getZones()
  const gates = euBlocked()
  // What is still unappointed, whether or not the gate is currently enforcing it.
  const outstanding = euGatesOutstanding()
  // Shipping is charged on every order today, so the rate card has no threshold column.
  const anyFree = zones.some((z) => z.freeOver > 0)
  const lifted = euGateLifted() && outstanding.length > 0
  const euZone = zones.find((z) => z.name === 'Europe')

  return (
    <>
      <section className="band">
        <div className="wrap prose">
          <p className="eyebrow">Help</p>
          <h1>Shipping &amp; delivery</h1>
          <p className="standfirst">
            Where we ship, what it costs, how long it takes, and who pays the duty.
          </p>

          {/* Development only — `euGateLifted()` is compiled out of a production build.
              Said on the page rather than left to a variable somebody has to remember,
              because a storefront that looks compliant while the appointments are
              outstanding is the failure this whole gate exists to prevent. */}
          {lifted && (
            <div className="todo">
              <b>EU/UK gate lifted &mdash; development only</b>
              <code>NEXT_PUBLIC_LIFT_EU_GATE</code> is set, so EU and UK regions are
              selectable here even though{' '}
              {outstanding.map((g) => g.label).join(', ')}{' '}
              {outstanding.length === 1 ? 'is' : 'are'} still outstanding. This flag has no
              effect in a production build. Nothing below is a statement about what may
              lawfully be sold into the EU.
            </div>
          )}

          <div className="psec">
            <h2>Rates and lead times</h2>
            {zones.length === 0 ? (
              <p className="callout warn">
                We could not load the rate card just now. The rates you are charged at
                checkout are always the ones that apply &mdash; please check there, or ask
                us.
              </p>
            ) : (
              <table className="spec wide ratetable">
                <caption className="visually-hidden">
                  Shipping rates, free-shipping thresholds and delivery estimates by zone
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Zone</th>
                    <th scope="col">Rate</th>
                    {/* The column appears only if some zone actually offers a threshold.
                        A "Free over" column of dashes advertises a mechanic this shop does
                        not have, on the page a customer quotes back at you. */}
                    {anyFree && <th scope="col">Free over</th>}
                    <th scope="col">Delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {zones.map((z) => (
                    <tr key={`${z.zone}-${z.name}`}>
                      <th scope="row">{z.name}</th>
                      <td>{money(z.rate)}</td>
                      {anyFree && (
                        <td>{z.freeOver > 0 ? money(z.freeOver) : '—'}</td>
                      )}
                      <td>{z.leadTime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="note">
              Lead times start when your order is dispatched, not when you place it. Jerseys
              are sourced to order, so the shirt is obtained first &mdash; that is the shop,
              not a delay.
            </p>
          </div>

          <div className="psec">
            <h2>Countries we ship to</h2>
            {zones.map((z) => {
              const names = z.country_codes.map((c) => COUNTRY_NAMES[c] ?? c.toUpperCase())
              // A zone that is one country already says so in the rate card above; listing
              // it again reads as "United States — United States".
              if (names.length === 1 && names[0] === z.name) return null
              return (
                <p key={`${z.zone}-${z.name}-list`}>
                  <strong>{z.name}</strong>{' — '}{names.join(', ')}
                </p>
              )
            })}
            <p className="note">
              Zones not listed here cover a single country, named in the rate card above.
            </p>
            <p className="note">
              Not on the list? <a href="/request">Ask us</a> &mdash; adding a country is a
              rate-card change, not a technical one, and we would rather quote you than turn
              you away.
            </p>
          </div>

          <div className="psec">
            <h2>Tax, VAT and customs duty</h2>
            <p>
              Sales tax, import VAT and duty are calculated at checkout from your delivery
              address and included in the total you approve. Nothing is collected from you on
              delivery, and there is no brokerage fee to pay at the door.
            </p>
            <p>
              For orders into the EU that means the import VAT is charged here rather than by
              your own customs authority. A $65.99 jersey therefore lands meaningfully higher
              than its ticket price once VAT and duty are added &mdash; the checkout total is
              the honest number, and we would rather show it there than surprise you at the
              door.
            </p>
            {gates.length > 0 && (
              <p className="callout warn">
                <strong>We are not shipping to the EU yet.</strong>{' '}
                {gates.length === 1 ? 'One appointment is' : `${gates.length} appointments are`}{' '}
                outstanding before we lawfully can:{' '}
                {gates.map((g) => g.label).join(', ')}. Until then, EU addresses are not
                offered at checkout
                {euZone ? ' even though the rate card above lists the zone' : ''}. We would
                rather say so here than let you fill in an address we cannot ship to.
              </p>
            )}
          </div>

          <div className="psec">
            <h2>Tracking</h2>
            <p>
              Every order ships tracked. The tracking number is emailed when the label is
              bought, and you can look an order up at any time from{' '}
              <a href="/track">Track your order</a> using the order number and your email.
              There is no account to remember.
            </p>
          </div>

          <div className="psec">
            <h2>If it does not arrive</h2>
            <p>
              Tell us. If tracking has not moved for ten working days we treat the parcel as
              lost and either resend or refund &mdash; your choice, and we do not ask you to
              chase the carrier on our behalf.
            </p>
          </div>
        </div>
      </section>
      <RequestBlock source="homepage" />
    </>
  )
}
