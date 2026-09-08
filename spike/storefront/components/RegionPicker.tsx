'use client'
import { useState, useTransition } from 'react'
import { setRegionAction } from '@/app/actions'

/**
 * Where we are shipping to.
 *
 * A `<select>` inside a form, not a custom dropdown: it is keyboard- and screen-reader-
 * correct for free, and on mobile it gets the native picker. The submit button is there for
 * a no-JS fallback and hidden once the change handler can do the work.
 *
 * **Regions we cannot lawfully ship to are shown as disabled, with the reason in the label**
 * rather than omitted. A missing option reads as a bug and produces the support email; a
 * stated one answers it. The three EU appointments (IOSS, Article 27, GPSR) are not
 * engineering work and nothing in the code can unblock them.
 *
 * Note the props: this takes plain data, never a region object from `lib/region.ts`. That
 * module reads cookies, and importing it here would pull `next/headers` into the client
 * bundle — the mistake this codebase has now made twice.
 */
export type RegionOption = {
  id: string
  name: string
  currency: string
  blocked: string | null
}

export default function RegionPicker({
  regions,
  current,
  compact,
}: {
  regions: RegionOption[]
  current: string
  compact?: boolean
}) {
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  if (regions.length < 2) return null

  const change = (id: string) => {
    if (id === current) return
    setBusy(true); setMsg('')
    start(async () => {
      const res = await setRegionAction(id)
      if (!res.ok) setMsg(res.message)
      setBusy(false)
    })
  }

  return (
    <div className={compact ? 'regionpick compact' : 'regionpick'}>
      <label htmlFor={compact ? 'region-compact' : 'region'}>
        {compact ? 'Ship to' : 'Shipping to'}
      </label>
      <select
        id={compact ? 'region-compact' : 'region'}
        defaultValue={current}
        disabled={busy || pending}
        onChange={(e) => change(e.target.value)}
      >
        {regions.map((r) => (
          <option key={r.id} value={r.id} disabled={!!r.blocked}>
            {r.name}
            {r.blocked ? ` — not yet (${r.blocked})` : ''}
          </option>
        ))}
      </select>
      {/* Announced, because the price and shipping line change without the page moving. */}
      <span role="status" className="visually-hidden">
        {busy || pending ? 'Updating your region' : ''}
      </span>
      {msg && <span className="rmsg err" role="alert">{msg}</span>}
    </div>
  )
}
