import RequestBlock from '@/components/RequestBlock'
export const metadata = { title: 'Request a jersey' }
export default function RequestPage() {
  return (
    <>
      <section className="band">
        <div className="wrap">
          <p className="eyebrow">Request</p>
          <h1>Tell us what you&rsquo;re looking for</h1>
          <p style={{ maxWidth: '52ch', marginTop: '.75rem' }}>
            Sold out, discontinued, a specific season, or a name and number nobody stocks.
            Describe it and we&rsquo;ll source it.
          </p>
        </div>
      </section>
      <RequestBlock source="homepage" />
    </>
  )
}
