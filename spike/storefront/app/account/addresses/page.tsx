import { getAddresses, getCustomer } from '@/lib/account'
import AddressBook from '@/components/AddressBook'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Your addresses' }

/**
 * The address book Medusa has always had and nothing ever showed.
 *
 * A returning customer retyped their address on every order — on a shop whose repeat purchase
 * is another shirt for the same person, which is exactly the case where it costs the most.
 */
export default async function AddressesPage() {
  const customer = await getCustomer()
  if (!customer) redirect('/account/login?next=/account/addresses')

  const addresses = await getAddresses()

  return (
    <>
      <section className="band">
        <div className="wrap">
          <p className="eyebrow">Account</p>
          <h1>Your addresses</h1>
          <p style={{ maxWidth: '52ch', marginTop: '.75rem' }}>
            Saved here so checkout can fill itself in. Used for delivery only &mdash; we do not
            share them, and deleting one here does not change an order already placed.
          </p>
        </div>
      </section>
      <div className="wrap" style={{ padding: '2rem 0 3rem' }}>
        <AddressBook addresses={addresses} />
      </div>
    </>
  )
}
