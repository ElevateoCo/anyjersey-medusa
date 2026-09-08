import { redirect } from 'next/navigation'
import { getCustomer, getOrders } from '@/lib/account'
import { logoutAction } from '@/app/account/actions'
import { money, mediaUrl } from '@/lib/medusa'

export const metadata = { title: 'Your account', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

/**
 * The account home.
 *
 * Deliberately thin. The shop's proposition is that there is nothing to remember (§12.1), so
 * an account earns its place by showing order history and saved addresses — not by becoming
 * a dashboard. Anything that would work as well without a login stays outside it.
 *
 * Note what is *not* here: guest orders. Registering with the same email does not retro-claim
 * them, because that would let anyone read the order history of any address they can type.
 * `/track` is the route to a guest order and it requires the order number too.
 */
export default async function AccountPage() {
  const customer = await getCustomer()
  if (!customer) redirect('/account/login')
  const orders = await getOrders()

  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ')

  return (
    <section className="band">
      <div className="wrap" style={{ maxWidth: 860 }}>
        <p className="eyebrow">Account</p>
        <h1>{name || customer.email}</h1>
        <p style={{ margin: '.75rem 0 2rem' }}>
          {customer.email}
          {' · '}
          <form action={logoutAction} style={{ display: 'inline' }}>
            <button type="submit" className="linkbtn">Sign out</button>
          </form>
        </p>

        <div className="psec">
          <p style={{ margin: '0 0 1.5rem' }}>
            <a className="btn ghost" href="/account/addresses">Your addresses</a>{' '}
            <a className="btn ghost" href="/account/claim">Add a past order</a>
          </p>

          <h2>Orders</h2>
          {orders.length === 0 ? (
            <>
              <p className="note">
                Nothing here yet. Orders you place while signed in will appear here.
              </p>
              <p className="note">
                Bought as a guest? Those do not appear here by design — anyone could
                otherwise read the history of any email address. Use{' '}
                <a href="/track">Track your order</a> with the order number instead.
              </p>
            </>
          ) : (
            <ul className="orderlist">
              {orders.map((o) => (
                <li key={o.id}>
                  <div className="orow">
                    <div>
                      <a href={`/order/${o.id}`}><strong>#{o.display_id}</strong></a>
                      <span className="note">
                        {' '}
                        <time dateTime={o.created_at}>
                          {new Date(o.created_at).toLocaleDateString('en-US', {
                            year: 'numeric', month: 'short', day: 'numeric',
                          })}
                        </time>
                      </span>
                    </div>
                    <b>{money(o.total)}</b>
                  </div>
                  <div className="othumbs">
                    {(o.items ?? []).slice(0, 4).map((i, n) =>
                      i.thumbnail ? (
                        <img key={n} src={mediaUrl(i.thumbnail, 200) ?? undefined}
                             alt={i.title} width={48} height={48} />
                      ) : null
                    )}
                    <span className="note">
                      {(o.items ?? []).map((i) => i.title).join(', ')}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="psec">
          <h2>Addresses</h2>
          {(customer.addresses ?? []).length === 0 ? (
            <p className="note">
              No saved addresses. The address you use at checkout is saved to the order, and
              signing in there will offer it next time.
            </p>
          ) : (
            <ul className="bullets">
              {(customer.addresses ?? []).map((a) => (
                <li key={a.id}>
                  {[a.address_1, a.city, a.province, a.postal_code,
                    a.country_code?.toUpperCase()].filter(Boolean).join(', ')}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="psec">
          <h2>Your data</h2>
          <p className="note">
            You can ask us for a copy of everything we hold, or ask us to delete it. Both are
            in the <a href="/policies/privacy">privacy policy</a>, and neither needs an
            account. Deleting an account does not delete order records we are legally required
            to keep — it removes everything we are not.
          </p>
        </div>
      </div>
    </section>
  )
}
