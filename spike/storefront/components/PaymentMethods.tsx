/**
 * What we actually accept, at the bottom of every page.
 *
 * The live store shows nine payment badges. This shows four, and the difference is the
 * point: those nine include PayPal and Shop Pay, which are Shopify's, and Apple Pay and
 * Google Pay, which need a registered domain this deployment does not have yet. A badge for
 * a method that is not offered at checkout is a false claim in the same family as a
 * compare-at price we cannot substantiate — the customer picks the site *because* of it and
 * finds out at the payment step.
 *
 * So this lists the card networks Stripe processes on a standard account and nothing else.
 * Wallets get a sentence rather than a badge, because whether they appear genuinely depends
 * on the customer's device — the Payment Element decides that at render time, and a static
 * footer cannot honestly promise it.
 *
 * The marks are set in type rather than reproduced as artwork. Card network logos are
 * trademarks with their own usage rules and asset packs; the networks' merchant agreements
 * permit naming what you accept, and a wordmark drawn from the brand's own font is the part
 * that needs a licence. Names in a bordered chip say the same thing and need nothing.
 */
const NETWORKS = ['Visa', 'Mastercard', 'American Express', 'Discover']

export default function PaymentMethods() {
  return (
    <div className="paymethods">
      <h2 className="display">Payment</h2>
      <ul aria-label="Accepted payment methods">
        {NETWORKS.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p>
        <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true" focusable="false">
          <path d="M2 6V4a4 4 0 0 1 8 0v2h.5A1.5 1.5 0 0 1 12 7.5v5A1.5 1.5 0 0 1 10.5 14h-9A1.5 1.5 0 0 1 0 12.5v-5A1.5 1.5 0 0 1 1.5 6H2Zm1.5 0h5V4a2.5 2.5 0 0 0-5 0v2Z"
                fill="currentColor" />
        </svg>{' '}
        Card details are entered into fields hosted by Stripe and never reach our servers.
        Apple&nbsp;Pay and Google&nbsp;Pay appear at checkout on devices that support them.
      </p>
    </div>
  )
}
