import AuthForm from '@/components/AuthForm'
import { requestResetAction } from '@/app/account/actions'

export const metadata = {
  title: 'Reset your password',
  robots: { index: false, follow: false },
}

export default function ForgotPage() {
  return (
    <section className="band">
      <div className="wrap" style={{ maxWidth: 480 }}>
        <p className="eyebrow">Account</p>
        <h1>Reset your password</h1>
        <p style={{ margin: '.75rem 0 1.5rem' }}>
          Enter your email and we will send you a link. It works once and expires in 15
          minutes.
        </p>

        <AuthForm action={requestResetAction} submitLabel="Send the link"
          pendingLabel="Sending…"
          footer={
            <p className="note" style={{ marginTop: '1rem' }}>
              {/* Says the same thing whether or not the account exists — see the action.
                  A reset form that confirms an address is an enumeration oracle, and this
                  shop's customer list is its email list. */}
              We answer the same way whether or not there is an account with that address.
              That is deliberate. <a href="/account/login">Back to sign in</a>.
            </p>
          }>
          <p>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" />
          </p>
        </AuthForm>
      </div>
    </section>
  )
}
