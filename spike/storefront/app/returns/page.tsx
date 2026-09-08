import ReturnRequest from '@/components/ReturnRequest'
import { TERMS } from '@/lib/policies'
import { abs } from '@/lib/site'

export const metadata = {
  title: 'Returns',
  description:
    'All sales are final. If your item arrived faulty, damaged, or wrong, tell us within ' +
    '30 days and we will replace or refund it.',
  alternates: { canonical: abs('/returns') },
}

/**
 * Returns.
 *
 * The operative version of `/policies/refunds`, with the form attached. A policy the
 * customer has to read and then find a separate mechanism for is the shape that generates
 * support email.
 *
 * The copy is blunt about the exclusions rather than burying them, for one reason: under a
 * final-sale policy the moment that matters is *before* the order, not after it. A page that
 * leads with "start a return" and mentions the exclusions at the bottom is a page that
 * collects requests it is going to refuse.
 */
export default function ReturnsPage() {
  return (
    <section className="band">
      <div className="wrap prose">
        <p className="eyebrow">Help</p>
        <h1>Returns</h1>
        <p className="standfirst">
          All sales are final. If your item arrived faulty, damaged, or is not what you
          ordered, tell us within {TERMS.windowDays} days and we will put it right.
        </p>

        <div className="psec">
          <h2>What we can and cannot take back</h2>
          <table className="spec wide">
            <tbody>
              <tr>
                <th scope="row">Faulty or damaged</th>
                <td>
                  Replaced or refunded, and we pay the return postage. Send a photo and we
                  can usually act on it without the shirt coming back at all.
                </td>
              </tr>
              <tr>
                <th scope="row">Wrong item sent</th>
                <td>Our error. Replaced or refunded, postage on us.</td>
              </tr>
              <tr>
                <th scope="row">Wrong size ordered</th>
                <td>
                  <strong>Not accepted.</strong> This is the one that catches people, so:
                  read the <a href="/size-guide">size guide</a> first, and if you send us the
                  chest measurement of a shirt that fits you we will match it by hand before
                  dispatch.
                </td>
              </tr>
              <tr>
                <th scope="row">Changed your mind</th>
                <td>
                  <strong>Not accepted</strong> — except in the EU and UK, where you have a
                  statutory {TERMS.withdrawalDays}-day right to cancel and we honour it.
                </td>
              </tr>
              <tr>
                <th scope="row">Personalised or custom-printed</th>
                <td>
                  Made to your specification, so not returnable unless faulty or misprinted.
                  That exclusion applies to the EU right too.
                </td>
              </tr>
              <tr>
                <th scope="row">Sale items and gift cards</th>
                <td>Not accepted.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="psec">
          <h2>Why we work this way</h2>
          <p>
            Every jersey is sourced to order — obtained for you after you buy it, from
            suppliers who do not take stock back. That is what makes a shirt nobody else
            lists available at all, and it is the reason we cannot absorb a change of mind
            the way a warehouse retailer can.
          </p>
          <p>
            What we can do is make sure you order the right thing. Ask us before you buy and
            we will answer.
          </p>
        </div>

        <div className="psec">
          <h2>How it works</h2>
          <ol className="bullets">
            <li>Tell us the order number and the email you used. No account needed.</li>
            <li>Pick the item and what went wrong. Photos help and usually speed it up.</li>
            <li>
              We email you the next step.{' '}
              <strong>Do not post anything back before that</strong> — unauthorised returns
              are not accepted and the parcel arrives with nothing to match it to.
            </li>
          </ol>
          <p className="note">
            Approved refunds are processed within {TERMS.refundBusinessDays} business days to
            your original payment method. Your bank then takes as long as it takes. The full
            terms are at <a href="/policies/refunds">Refund policy</a>.
          </p>
        </div>

        <div className="psec">
          <h2>Start a return</h2>
          <ReturnRequest />
        </div>
      </div>
    </section>
  )
}
