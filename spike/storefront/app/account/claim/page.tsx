import { getCustomer } from '@/lib/account'
import ClaimOrder from '@/components/ClaimOrder'
import { redirect } from 'next/navigation'

export const metadata = {
  title: 'Add a past order',
  // The URL carries a one-time token when arriving from the confirmation email.
  robots: { index: false, follow: false },
}

/**
 * Attaching an order placed as a guest to an account.
 *
 * Two ways in, and the page handles both: starting the request from the account, or arriving
 * from the confirmation email with a token in the URL.
 *
 * The safety is that those are different people's inboxes. Anybody can *ask* for an order to
 * be moved; only whoever receives mail at the address on that order can confirm it.
 */
export default async function ClaimPage(
  { searchParams }: { searchParams: Promise<{ order?: string; token?: string }> }
) {
  const customer = await getCustomer()
  const { order, token } = await searchParams

  if (!customer) {
    // Come back here after signing in, token and all — the link in the email is single-use
    // and asking somebody to find it twice is how a confirmation gets abandoned.
    const next = `/account/claim${order ? `?order=${order}&token=${token ?? ''}` : ''}`
    redirect(`/account/login?next=${encodeURIComponent(next)}`)
  }

  return (
    <>
      <section className="band">
        <div className="wrap">
          <p className="eyebrow">Account</p>
          <h1>Add a past order</h1>
          <p style={{ maxWidth: '54ch', marginTop: '.75rem' }}>
            Ordered before you had an account? Add it here and it joins your order history,
            with its tracking and its returns.
          </p>
        </div>
      </section>
      <div className="wrap" style={{ padding: '2rem 0 3rem' }}>
        <ClaimOrder orderId={order ?? ''} token={token ?? ''} email={customer.email} />
      </div>
    </>
  )
}
