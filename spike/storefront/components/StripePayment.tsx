'use client'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { useState } from 'react'
import { completeAction } from '@/app/actions'

const PK = process.env.NEXT_PUBLIC_STRIPE_PK ?? ''
const stripePromise = PK ? loadStripe(PK) : null

/**
 * Medusa's Stripe provider is PaymentIntents + Elements, not Checkout Sessions — the
 * Phase 0 spike finding (research.md §5.1). Consequence: the card fields are an iframe on
 * our domain, so PCI scope is SAQ A-EP and the script controls in §7.5 are mandatory.
 */
function Inner() {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pay(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setBusy(true); setError(null)

    const submit = await elements.submit()
    if (submit.error) { setError(submit.error.message ?? 'Check your card details.'); setBusy(false); return }

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    })

    if (confirmError) {
      const pi = confirmError.payment_intent
      if (!pi || !['succeeded', 'requires_capture'].includes(pi.status ?? '')) {
        setError(confirmError.message ?? 'Payment failed.')
        setBusy(false)
        return
      }
    }
    if (paymentIntent && !['succeeded', 'requires_capture'].includes(paymentIntent.status)) {
      setError(`Payment status: ${paymentIntent.status}`)
      setBusy(false)
      return
    }

    // The order is created by the webhook (§5.2 rule 2). Completing the cart is what
    // hands the customer their confirmation; if this call never happens — closed tab,
    // dropped connection — the webhook still produces the order.
    const res = await completeAction()
    if (res && !res.ok) { setError(res.message ?? 'Could not complete the order.'); setBusy(false) }
  }

  return (
    <form onSubmit={pay}>
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && <p className="rmsg err" role="alert" style={{ color: '#B3261E' }}>{error}</p>}
      <button className="btn block" type="submit" disabled={busy} style={{ marginTop: '1rem' }}>
        {busy ? 'Processing…' : 'Pay now'}
      </button>
      <p className="note" style={{ marginTop: '.75rem' }}>
        Test mode. Use card <code>4242 4242 4242 4242</code>, any future expiry, any CVC.
      </p>
    </form>
  )
}

export default function StripePayment({ clientSecret }: { clientSecret: string | null }) {
  if (!PK) {
    return (
      <div className="todo">
        <b>Blocked — Stripe publishable key missing</b>
        Add <code>NEXT_PUBLIC_STRIPE_PK=pk_test_…</code> to <code>storefront/.env.local</code>
        and <code>STRIPE_API_KEY=sk_test_…</code> to <code>backend/.env</code>, then restart
        both. Everything up to this step already works.
      </div>
    )
  }
  if (!clientSecret) {
    return (
      <div className="todo">
        <b>No payment session</b>
        Medusa returned no <code>client_secret</code>, which almost always means
        <code> STRIPE_API_KEY</code> is missing in <code>backend/.env</code>.
      </div>
    )
  }
  return (
    <Elements stripe={stripePromise}
              options={{ clientSecret, appearance: { theme: 'flat', variables: {
                colorPrimary: '#121212', borderRadius: '0px', fontFamily: 'Inter, sans-serif',
              } } }}>
      <Inner />
    </Elements>
  )
}
