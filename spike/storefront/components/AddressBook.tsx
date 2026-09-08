'use client'

import { useState } from 'react'
import type { Address } from '@/lib/account'
import { addAddressAction, deleteAddressAction } from '@/app/account/actions'

/**
 * Add, list and remove saved addresses.
 *
 * Deliberately without an edit form. An address is five short fields; correcting one means
 * retyping roughly what adding one costs, and an edit form is a second set of validation, a
 * second failure mode, and a way to silently change the address on a saved-but-unplaced
 * order. Add the right one, delete the wrong one.
 */
export default function AddressBook({ addresses }: { addresses: Address[] }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [adding, setAdding] = useState(addresses.length === 0)

  const line = (a: Address) =>
    [a.address_1, a.city, a.province, a.postal_code, a.country_code?.toUpperCase()]
      .filter(Boolean).join(', ')

  return (
    <div>
      {addresses.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 2rem', display: 'grid',
                     gap: '.75rem' }}>
          {addresses.map((a) => (
            <li key={a.id} style={{ border: '1px solid var(--rule)', padding: '1rem',
                                    display: 'flex', justifyContent: 'space-between',
                                    gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <strong>{[a.first_name, a.last_name].filter(Boolean).join(' ') || 'Address'}</strong>
                <div style={{ color: 'var(--ink-2)', fontSize: '.9rem' }}>{line(a)}</div>
              </div>
              <form action={async () => {
                setBusy(true)
                try { await deleteAddressAction(a.id); setMsg('Address removed.') }
                catch { setMsg('Could not remove that address.') }
                finally { setBusy(false) }
              }}>
                <button className="btn ghost" type="submit" disabled={busy}>Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <p role="status" aria-live="polite" className="rmsg">{msg}</p>

      {!adding ? (
        <button className="btn" type="button" onClick={() => setAdding(true)}>
          Add another address
        </button>
      ) : (
        <form
          className="checkout-form"
          action={async (formData: FormData) => {
            setBusy(true)
            setMsg('')
            try {
              await addAddressAction(formData)
              setMsg('Address saved.')
              setAdding(false)
            } catch (e) {
              setMsg((e as Error).message || 'Could not save that address.')
            } finally {
              setBusy(false)
            }
          }}
        >
          <h2 style={{ fontSize: '1.05rem', marginBottom: '.75rem' }}>Add an address</h2>
          <div className="row2">
            <div>
              <label htmlFor="first_name">First name</label>
              <input id="first_name" name="first_name" autoComplete="given-name" required />
            </div>
            <div>
              <label htmlFor="last_name">Last name</label>
              <input id="last_name" name="last_name" autoComplete="family-name" required />
            </div>
          </div>
          <label htmlFor="address_1">Address</label>
          <input id="address_1" name="address_1" autoComplete="address-line1" required />
          <div className="row2">
            <div>
              <label htmlFor="city">City</label>
              <input id="city" name="city" autoComplete="address-level2" required />
            </div>
            <div>
              <label htmlFor="province">State</label>
              <input id="province" name="province" autoComplete="address-level1" required />
            </div>
          </div>
          <div className="row2">
            <div>
              <label htmlFor="postal_code">Postcode</label>
              <input id="postal_code" name="postal_code" autoComplete="postal-code" required />
            </div>
            <div>
              <label htmlFor="country_code">Country</label>
              <input id="country_code" name="country_code" autoComplete="country"
                     defaultValue="US" maxLength={2} required />
            </div>
          </div>
          <p style={{ marginTop: '1rem' }}>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save address'}
            </button>{' '}
            {addresses.length > 0 && (
              <button className="btn ghost" type="button" onClick={() => setAdding(false)}>
                Cancel
              </button>
            )}
          </p>
        </form>
      )}
    </div>
  )
}
