import { getOrder } from '@/lib/cart'
import { money } from '@/lib/medusa'

// Somebody's order. Indexing one would publish it.
export const metadata = {
  title: 'Order confirmed',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let order: Record<string, any> | null = null
  try { order = await getOrder(id) } catch { order = null }

  if (!order) {
    return (
      <section className="band"><div className="wrap">
        <h1>Order not found</h1>
        <p style={{ marginTop: '.75rem' }}>We couldn&rsquo;t load <code>{id}</code>.</p>
      </div></section>
    )
  }

  return (
    <section className="band">
      <div className="wrap" style={{ maxWidth: 720 }}>
        <p className="eyebrow">Confirmed</p>
        <h1>Thanks — order #{order.display_id}</h1>
        <p style={{ marginTop: '.75rem' }}>
          A confirmation is on its way to <strong>{order.email}</strong>.
        </p>

        <table className="spec" style={{ marginTop: '2rem' }}>
          <tbody>
            {(order.items ?? []).map((i: any) => (
              <tr key={i.id}>
                <th>{i.quantity}× {i.variant?.title} — {i.title}</th>
                <td style={{ textAlign: 'right' }}>{money(i.subtotal)}</td>
              </tr>
            ))}
            <tr><th>Shipping</th><td style={{ textAlign: 'right' }}>{money(order.shipping_total)}</td></tr>
            <tr><th>Tax</th><td style={{ textAlign: 'right' }}>{money(order.tax_total)}</td></tr>
            <tr><th style={{ fontWeight: 600, color: 'var(--ink)' }}>Total</th>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(order.total)}</td></tr>
          </tbody>
        </table>

        <div className="promise" style={{ marginTop: '2rem' }}>
          <b>What happens now</b>
          This order was created by the Stripe webhook, not by your browser reaching this
          page — so it exists whether or not you ever saw this screen.
        </div>

        <p style={{ marginTop: '2rem' }}><a className="btn" href="/jerseys">Keep shopping</a></p>
      </div>
    </section>
  )
}
