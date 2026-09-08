import { redirect } from 'next/navigation'
import AuthForm from '@/components/AuthForm'
import { registerAction } from '@/app/account/actions'
import { getCustomer } from '@/lib/account'

export const metadata = {
  title: 'Create an account',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function RegisterPage() {
  if (await getCustomer()) redirect('/account')

  return (
    <section className="band">
      <div className="wrap" style={{ maxWidth: 480 }}>
        <p className="eyebrow">Account</p>
        <h1>Create an account</h1>
        <p style={{ margin: '.75rem 0 1.5rem' }}>
          You do not need one to buy. It keeps your order history and addresses in one place
          — nothing else changes.
        </p>

        <AuthForm action={registerAction} submitLabel="Create account"
          pendingLabel="Creating…"
          footer={
            <p className="note" style={{ marginTop: '1rem' }}>
              Already have one? <a href="/account/login">Sign in</a>. By creating an account
              you accept our <a href="/policies/terms">terms</a> and{' '}
              <a href="/policies/privacy">privacy policy</a>.
            </p>
          }>
          <div className="two">
            <p>
              <label htmlFor="first_name">First name</label>
              <input id="first_name" name="first_name" autoComplete="given-name" />
            </p>
            <p>
              <label htmlFor="last_name">Last name</label>
              <input id="last_name" name="last_name" autoComplete="family-name" />
            </p>
          </div>
          <p>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" />
          </p>
          <p>
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required minLength={8}
                   autoComplete="new-password" aria-describedby="pwhint" />
            <span id="pwhint" className="note">At least 8 characters.</span>
          </p>
          <p>
            <label htmlFor="confirm">Confirm password</label>
            <input id="confirm" name="confirm" type="password" required minLength={8}
                   autoComplete="new-password" />
          </p>
        </AuthForm>
      </div>
    </section>
  )
}
