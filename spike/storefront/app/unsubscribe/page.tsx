import Unsubscribe from '@/components/Unsubscribe'

export const metadata = {
  title: 'Unsubscribe',
  // Never indexed: the URL carries a token, and a search engine holding one is a way to
  // unsubscribe a stranger.
  robots: { index: false, follow: false },
}

export default async function UnsubscribePage(
  { searchParams }: { searchParams: Promise<{ token?: string }> }
) {
  const { token } = await searchParams

  return (
    <>
      <section className="band">
        <div className="wrap">
          <p className="eyebrow">Email</p>
          <h1>Unsubscribe</h1>
          <p style={{ maxWidth: '54ch', marginTop: '.75rem' }}>
            This stops the one marketing email we send &mdash; the reminder about a basket you
            left behind. Receipts, replies and anything about an order you have placed keep
            coming, because those are not marketing.
          </p>
        </div>
      </section>
      <div className="wrap" style={{ padding: '2rem 0 3rem' }}>
        <Unsubscribe token={token ?? ''} />
      </div>
    </>
  )
}
