import RequestForm from './RequestForm'

export default function RequestBlock({ source = 'homepage', prefill = '' }:
  { source?: string; prefill?: string }) {
  return (
    <section className="request">
      <div className="wrap">
        <p className="eyebrow" style={{ color: '#8A8A86' }}>The bit nobody else does</p>
        <h2>Can&rsquo;t find your <em>jersey?</em></h2>
        <ol className="steps">
          <li>Tell us what you want</li>
          <li>We find it and confirm details</li>
          <li>We ship it to your door</li>
        </ol>
        <RequestForm source={source} prefill={prefill} />
      </div>
    </section>
  )
}
