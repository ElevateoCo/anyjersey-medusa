import AuthForm from '@/components/AuthForm'
import { completeResetAction } from '@/app/account/actions'

export const metadata = {
  title: 'Set a new password',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

/**
 * The landing page for the emailed reset link.
 *
 * The token and email arrive as query parameters and are carried through as hidden fields.
 * They are *not* rendered as visible text: this URL is the credential, and a reset page that
 * prints the token invites it into a screenshot or a support ticket.
 */
export default async function ResetPage({ searchParams }:
  { searchParams: Promise<{ token?: string; email?: string }> }) {
  const { token, email } = await searchParams

  if (!token || !email) {
    return (
      <section className="band">
        <div className="wrap" style={{ maxWidth: 480 }}>
          <h1>This link is incomplete</h1>
          <p style={{ margin: '.75rem 0 1.5rem' }}>
            Some email clients truncate long links. Request a new one and open it directly
            from the message.
          </p>
          <p><a className="btn" href="/account/forgot">Request a new link</a></p>
        </div>
      </section>
    )
  }

  return (
    <section className="band">
      <div className="wrap" style={{ maxWidth: 480 }}>
        <p className="eyebrow">Account</p>
        <h1>Set a new password</h1>
        <p style={{ margin: '.75rem 0 1.5rem' }}>
          Choose a password for <strong>{email}</strong>.
        </p>

        <AuthForm action={completeResetAction} submitLabel="Save new password"
          pendingLabel="Saving…">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="email" value={email} />
          <p>
            <label htmlFor="password">New password</label>
            <input id="password" name="password" type="password" required minLength={8}
                   autoComplete="new-password" aria-describedby="pwhint" />
            <span id="pwhint" className="note">At least 8 characters.</span>
          </p>
          <p>
            <label htmlFor="confirm">Confirm new password</label>
            <input id="confirm" name="confirm" type="password" required minLength={8}
                   autoComplete="new-password" />
          </p>
        </AuthForm>
      </div>
    </section>
  )
}
