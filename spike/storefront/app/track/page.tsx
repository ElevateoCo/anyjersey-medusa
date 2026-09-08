import OrderLookup from '@/components/OrderLookup'
import RequestBlock from '@/components/RequestBlock'

// Per-customer once submitted, and no value in the index — /shipping is the page that
// explains tracking and is indexable.
export const metadata = {
  title: 'Track your order',
  robots: { index: false, follow: true },
}

export default function TrackPage() {
  return (
    <>
      <section className="band">
        <div className="wrap" style={{ maxWidth: 620 }}>
          <p className="eyebrow">Track</p>
          <h1>Where is my order?</h1>
          <p style={{ margin: '.75rem 0 1.5rem', maxWidth: '52ch' }}>
            Enter your order number and the email you used. There are no accounts to
            remember.
          </p>
          <OrderLookup />
        </div>
      </section>
      <RequestBlock source="homepage" />
    </>
  )
}
