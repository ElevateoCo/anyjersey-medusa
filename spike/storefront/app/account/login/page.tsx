import { redirect } from 'next/navigation'
import AuthForm from '@/components/AuthForm'
import { loginAction } from '@/app/account/actions'
import { getCustomer } from '@/lib/account'

export const metadata = {
  title: 'Sign in',
  // Per-customer, so it must never be indexed. robots.txt also blocks /account, but a
  // crawl-level rule cannot deindex a URL reached from an external link — only this can.
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function LoginPage({ searchParams }:
  { searchParams: Promise<{ reset?: string }> }) {
  if (await getCustomer()) redirect('/account')
  const { reset } = await searchParams

  return (
    <section className="band">
      <div className="wrap" style={{ maxWidth: 480 }}>
        <p className="eyebrow">Account</p>
        <h1>Sign in</h1>
        <p style={{ margin: '.75rem 0 1.5rem' }}>
          An account is optional. You can buy as a guest and{' '}
          <a href="/track">track any order</a> with its number and your email.
        </p>

        {reset === 'done' && (
          <p className="callout" role="status">
            Your password has been changed. Sign in with the new one.
          </p>
        )}

        <AuthForm action={loginAction} submitLabel="Sign in" pendingLabel="Signing in…"
          footer={
            <p className="note" style={{ marginTop: '1rem' }}>
              <a href="/account/forgot">Forgotten your password?</a>
              {' · '}
              <a href="/account/register">Create an account</a>
            </p>
          }>
          <p>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" />
          </p>
          <p>
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required
                   autoComplete="current-password" />
          </p>
        </AuthForm>
      </div>
    </section>
  )
}
