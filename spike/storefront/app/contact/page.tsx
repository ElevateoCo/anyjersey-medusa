import ContactForm from '@/components/ContactForm'
import { ENTITY, abs, entityValue } from '@/lib/site'

export const metadata = {
  title: 'Contact',
  description: 'Email us or fill out the form. A person reads every message.',
  alternates: { canonical: abs('/contact') },
}

/**
 * Contact.
 *
 * Copy taken from the live store's own contact page and its contact-information policy,
 * which is the trader identity consumer law requires to be published — and which was one of
 * the four outstanding entity details on `/policies/privacy` until now.
 *
 * The live version emails a mailbox and stores nothing. This one writes the message first and
 * emails second, which is the difference between "we never received it" being arguable and
 * being checkable.
 */
export default function ContactPage() {
  const email = entityValue('support_email')
  const phone = entityValue('phone')
  const trader = entityValue('legal_name')

  return (
    <section className="band">
      <div className="wrap prose">
        <p className="eyebrow">Help</p>
        <h1>Contact</h1>
        <p className="standfirst">
          {email
            ? <>Email us: <a href={`mailto:${email}`}>{email}</a> — or fill out the form below.</>
            : <>Fill out the form below and a person will reply.</>}
        </p>

        <div className="psec">
          <h2>Send us a message</h2>
          <ContactForm />
        </div>

        <div className="psec">
          <h2>Before you write</h2>
          <ul className="bullets">
            <li>
              <strong>Where is my order?</strong>{' '}
              <a href="/track">Track it</a> with your order number and email — faster than
              asking us.
            </li>
            <li>
              <strong>Something wrong with what arrived?</strong>{' '}
              <a href="/returns">Start a return</a>. Include photos and we can act on it
              straight away.
            </li>
            <li>
              <strong>Looking for a jersey we do not list?</strong>{' '}
              <a href="/request">Request it</a> — that goes to the sourcing queue rather than
              the inbox.
            </li>
          </ul>
        </div>

        <div className="psec">
          <h2>Contact information</h2>
          {/* The trader identity, published because it has to be. */}
          <table className="spec wide">
            <tbody>
              <tr><th scope="row">Trade name</th><td>{trader || '—'}</td></tr>
              <tr>
                <th scope="row">Email</th>
                <td>{email ? <a href={`mailto:${email}`}>{email}</a> : '—'}</td>
              </tr>
              <tr>
                <th scope="row">Phone</th>
                <td>{phone ? <a href={`tel:${phone}`}>{phone}</a> : '—'}</td>
              </tr>
            </tbody>
          </table>
          {!ENTITY.find((e) => e.key === 'address')?.value && (
            <p className="note">
              A registered postal address is still outstanding. It is required on the
              storefront and on every invoice — see{' '}
              <a href="/policies/privacy">the privacy policy</a>.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
