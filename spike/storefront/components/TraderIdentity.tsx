import { ENTITY, SITE_NAME, entityValue, pendingEntityFields } from '@/lib/site'

/**
 * Who the customer is buying from, on every page rather than only in the policies.
 *
 * The trader has to be identifiable — FTC guidance and the EU's UCPD both say so, and the
 * EU Consumer Rights Directive wants the address and a contact route before the order, not
 * after it. The policy pages already enumerate these fields; a shopper reading a product
 * page has not been to the policy pages.
 *
 * Two details worth not tidying away:
 *
 *  1. **The trading name and the brand differ.** The storefront trades as Find Any Jersey
 *     and the trader is Crux Christi. That split is normal and lawful, and it is the
 *     *trader* the law wants named — so both appear, rather than the prettier one.
 *  2. **Missing fields are shown as missing.** `pendingEntityFields()` drives a visible
 *     line naming what is outstanding. The alternative to a visible gap is not a complete
 *     footer, it is a footer that quietly omits a required disclosure — and the registered
 *     address is genuinely not known yet. Filling `NEXT_PUBLIC_LEGAL_ADDRESS` removes the
 *     line with no code change.
 */
export default function TraderIdentity() {
  const legal = entityValue('legal_name')
  const address = entityValue('address')
  const email = entityValue('support_email')
  const phone = entityValue('phone')
  const pending = pendingEntityFields().filter((f) => shownHere.includes(f.key))

  return (
    <div className="trader">
      <p>
        © {new Date().getFullYear()} {legal || SITE_NAME}
        {legal && legal !== SITE_NAME ? <> · trading as {SITE_NAME}</> : null}
        {address ? <> · {address}</> : null}
      </p>
      <p>
        {email ? <a href={`mailto:${email}`}>{email}</a> : null}
        {email && phone ? ' · ' : null}
        {phone ? <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{phone}</a> : null}
      </p>
      {pending.length > 0 && (
        <p className="pending">
          Still to publish:{' '}
          {pending.map((f, i) => (
            <span key={f.key}>
              {i > 0 ? ', ' : ''}
              <abbr title={f.why}>{f.label.toLowerCase()}</abbr>
            </span>
          ))}
          . <a href="/policies/terms">Why these are required</a>
        </p>
      )}
    </div>
  )
}

/**
 * Only the fields this block would have rendered are reported as outstanding here.
 *
 * The EU appointments — Article 27 representative, GPSR responsible person, IOSS — are also
 * unset, and they are disclosed where they bite: the region picker refuses EU destinations
 * and names the missing appointment. Repeating them in the footer of a US storefront would
 * bury the two gaps a US customer can act on.
 */
const shownHere = ENTITY.filter((f) =>
  ['address', 'privacy_email'].includes(f.key)
).map((f) => f.key)
