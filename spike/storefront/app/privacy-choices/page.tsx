import PrivacyChoices from '@/components/PrivacyChoices'
import { abs } from '@/lib/site'

export const metadata = {
  title: 'Your Privacy Choices',
  description:
    'Opt out of the sale or sharing of your personal information for targeted advertising.',
  alternates: { canonical: abs('/privacy-choices') },
}

/**
 * Your Privacy Choices — the US state opt-out page.
 *
 * The three paragraphs below are the live store's own text, unchanged. They are the standard
 * disclosure the state laws expect and there is no reason to rewrite them.
 *
 * What is added is the control they promise. The live page ends "please follow the
 * instructions below" and then has no instructions, which under the twelve states that
 * require an opt-out mechanism is worse than not having the page: it documents that the right
 * exists and then does not honour it.
 *
 * One paragraph is also *more* true here than on the live store: we do not sell or share
 * personal data for targeted advertising at all, and nothing non-essential loads before
 * consent. Saying so is not marketing, it is the material fact a reader of this page needs.
 */
export default function PrivacyChoicesPage() {
  return (
    <section className="band">
      <div className="wrap prose">
        <p className="eyebrow">Legal</p>
        <h1>Your Privacy Choices</h1>

        <div className="psec">
          <p>
            As described in our <a href="/policies/privacy">Privacy Policy</a>, we collect
            personal information from your interactions with us and our website, including
            through cookies and similar technologies. We may also share this personal
            information with third parties, including advertising partners. We do this in
            order to show you ads on other websites that are more relevant to your interests
            and for other reasons outlined in our privacy policy.
          </p>
          <p>
            Sharing of personal information for targeted advertising based on your interaction
            on different websites may be considered &ldquo;sales&rdquo;,
            &ldquo;sharing&rdquo;, or &ldquo;targeted advertising&rdquo; under certain U.S.
            state privacy laws. Depending on where you live, you may have the right to opt out
            of these activities. If you would like to exercise this opt-out right, please
            follow the instructions below.
          </p>
          <p>
            If you visit our website with the Global Privacy Control opt-out preference signal
            enabled, depending on where you are, we will treat this as a request to opt-out of
            activity that may be considered a &ldquo;sale&rdquo; or &ldquo;sharing&rdquo; of
            personal information or other uses that may be considered targeted advertising for
            the device and browser you used to visit our website.
          </p>
        </div>

        <div className="psec">
          <h2>Your choice</h2>
          <PrivacyChoices />
        </div>

        <div className="psec">
          <h2>What we actually do today</h2>
          {/* The material fact a reader of this page needs, and it is more favourable than
              the boilerplate above allows for. */}
          <p>
            We do not sell personal information, and we do not share it for cross-context
            behavioural advertising. There are no advertising partners receiving data from
            this site. The only optional technology is product analytics, which measures how
            the shop is used and loads nothing until you accept it.
          </p>
          <p>
            The paragraphs above describe rights that apply to us as a matter of law whether
            or not we exercise the practices they cover. They are kept in full rather than
            trimmed to what we happen to do this month.
          </p>
        </div>
      </div>
    </section>
  )
}
