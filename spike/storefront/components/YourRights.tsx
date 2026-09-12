import {
  RIGHT_LABEL, deadlineSentence, type Jurisdiction,
} from '@/lib/jurisdiction'
import { RETENTION } from '@/lib/policies'
import { ENTITY } from '@/lib/site'

/**
 * "Your rights where you are" — the panel that makes a global policy legible to one person.
 *
 * It sits **above** the policy rather than instead of it. The document below stays complete
 * and identical for every reader, because a regulator reads the same page a customer does;
 * what this adds is the reader's own law, named, with the deadline that actually applies to
 * them and the route to complain over our head.
 *
 * Two details worth keeping:
 *
 * - **The deadline is either the statute's number or an admission.** Where we have not
 *   confirmed a jurisdiction's period, the panel says we are confirming it. A published
 *   deadline is a promise a regulator can hold us to, so a plausible-looking guess is worse
 *   than an honest gap — the same call `lib/policies.ts` makes about a controller address.
 * - **Missing appointments are named, not omitted.** A reader in the EU is told whether an
 *   Article 27 representative exists, because the absence of one is itself the disclosure.
 */
export default function YourRights({ j }: { j: Jurisdiction }) {
  // Only the fields this jurisdiction's disclosure needs, and only the ones still empty.
  const missing = j.pending
    .map((k) => ENTITY.find((e) => e.key === k))
    .filter((e): e is (typeof ENTITY)[number] => !!e && !e.value)
  const local = RETENTION.filter((r) => j.retentionSetLocally.includes(r.label))

  return (
    <section className="rights" aria-labelledby="rights-h">
      <p className="eyebrow">Where you are</p>
      <h2 id="rights-h">Your rights in {j.name}</h2>
      <p className="rights-law">
        You are covered by <strong>{j.law}</strong>. The policy below applies to everyone;
        this is the part of it that is yours.
      </p>

      <ul className="rights-list">
        {j.rights.map((r) => (
          <li key={r}>{RIGHT_LABEL[r]}</li>
        ))}
      </ul>

      <div className="rights-rows">
        <p><strong>How long we take.</strong> {deadlineSentence(j)}</p>
        <p>
          <strong>How to ask.</strong> Email us and say what you want. We will ask you to
          confirm the address on the order rather than making you create an account — a
          right you have to sign up for is one we have made harder than the law intends.
        </p>
        {j.rights.includes('optout') && (
          <p>
            <strong>Opt out.</strong> Use <a href="/privacy-choices">Your Privacy Choices</a>.
            If your browser sends Global Privacy Control we act on it automatically and you
            do not need to ask.
          </p>
        )}
        {j.complaint && (
          <p>
            <strong>If we get it wrong.</strong> You can complain to us first, and you can
            go to {j.complaint} whether or not you do.
          </p>
        )}
      </div>

      {local.length > 0 && (
        <div className="rights-note">
          <p>
            <strong>One period is set by your country, not by us.</strong>{' '}
            {local.map((r) => r.label).join(' and ')} must be kept for as long as the tax law
            where you bought requires, which differs from country to country. The table below
            shows what we apply today; we are confirming the figure for {j.name} with an
            accountant before publishing it as yours, rather than restating the US period and
            calling it universal.
          </p>
        </div>
      )}

      {missing.length > 0 && (
        <div className="rights-note warn">
          <p>
            <strong>Not yet in place.</strong> These are required before we can lawfully
            take orders from {j.name}, and they are not engineering work:
          </p>
          <ul>
            {missing.map((f) => <li key={f.key}>{f.label} &mdash; {f.why}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}
