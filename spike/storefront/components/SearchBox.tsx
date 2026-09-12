'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * The store is called Find Any Jersey. It needs a search box, and with 3,155 products it
 * needs suggestions — "Buffalo Bills" as one click beats scrolling a result page.
 *
 * Suggestions are entities, not just products: teams, players, then a few jerseys. The
 * form still works as a plain GET submit if JavaScript never arrives, and the whole thing
 * is keyboard-operable, because a combobox that needs a mouse is not a search box.
 */
type Suggest = {
  teams: { value: string; count: number }[]
  players: { value: string; count: number }[]
  products: { label: string; handle: string; team: string | null }[]
  total: number
}
type Row =
  | { kind: 'team' | 'player'; label: string; count: number; href: string }
  | { kind: 'product'; label: string; href: string }
  | { kind: 'all'; label: string; href: string }

export default function SearchBox({ compact = false, id: idProp, landmark = false }: {
  compact?: boolean
  /**
   * The id the field and its listbox are built from. It has to be unique *per page*, not
   * per variant: the masthead box and the listing page's own box are both the full-size
   * variant, so deriving the id from `compact` alone put two `q-main` comboboxes on every
   * listing page — a duplicate id, and an `aria-controls` that could resolve to either.
   */
  id?: string
  /**
   * Whether this instance is the page's **search landmark**.
   *
   * A page may have one. The listing page renders a second, identical search control under
   * the heading, and with `role="search"` on both a screen reader announced "search,
   * search" with no way to tell them apart — the same defect `a11y_check.py` already guards
   * against for two unnamed `<nav>` elements.
   *
   * Defaults to **false**, so a third instance added later cannot create the problem again
   * by accident. `app/layout.tsx` opts the masthead in, because the site-wide search is the
   * one that belongs in the landmark list.
   */
  landmark?: boolean
}) {
  const params = useSearchParams()
  const router = useRouter()
  const [value, setValue] = useState(params.get('q') ?? '')
  const [rows, setRows] = useState<Row[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const box = useRef<HTMLDivElement>(null)
  const id = idProp ?? (compact ? 'q-nav' : 'q-main')

  // debounce: one request per pause, not per keystroke
  useEffect(() => {
    const term = value.trim()
    if (term.length < 2) { setRows([]); setOpen(false); return }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_MEDUSA_URL}/store/suggest?q=${encodeURIComponent(term)}`,
          { headers: { 'x-publishable-api-key': process.env.NEXT_PUBLIC_MEDUSA_PK ?? '' } }
        )
        if (!res.ok) return
        const s: Suggest = await res.json()
        const next: Row[] = [
          ...s.teams.map((t) => ({
            kind: 'team' as const, label: t.value, count: t.count,
            href: `/jerseys?team=${encodeURIComponent(t.value)}`,
          })),
          ...s.players.map((p) => ({
            kind: 'player' as const, label: p.value, count: p.count,
            href: `/jerseys?q=${encodeURIComponent(p.value)}`,
          })),
          ...s.products.map((p) => ({
            kind: 'product' as const, label: p.label, href: `/jerseys/${p.handle}`,
          })),
        ]
        if (s.total > 0) {
          next.push({
            kind: 'all', label: `See all ${s.total} results for “${term}”`,
            href: `/jerseys?q=${encodeURIComponent(term)}`,
          })
        }
        setRows(next)
        setOpen(next.length > 0)
        setActive(-1)
      } catch { /* suggestions are a convenience; failure is silent */ }
    }, 180)
    return () => clearTimeout(t)
  }, [value])

  // click-away
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const go = (href: string) => { setOpen(false); router.push(href) }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (active >= 0 && rows[active]) return go(rows[active].href)
    const q = value.trim()
    go(q ? `/jerseys?q=${encodeURIComponent(q)}` : '/jerseys')
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!open || !rows.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % rows.length) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + rows.length) % rows.length) }
    if (e.key === 'Escape') { setOpen(false); setActive(-1) }
  }

  return (
    <div className={compact ? 'searchwrap compact' : 'searchwrap'} ref={box}>
      {/* `role="search"` only on the landmark instance — see the `landmark` prop. The
          label on the field below names the control either way, so the non-landmark copy
          is still announced properly, just not as a second landmark. */}
      <form className="search" role={landmark ? 'search' : undefined}
            aria-label={landmark ? 'Search jerseys' : undefined} onSubmit={submit}>
        <label htmlFor={id} className="visually-hidden">
          Search jerseys by player, team or colour
        </label>
        <input
          id={id} type="search" name="q" value={value} autoComplete="off"
          placeholder="Player, team, colour…"
          role="combobox" aria-expanded={open} aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          onFocus={() => rows.length && setOpen(true)}
        />
        <button type="submit">Search</button>
      </form>

      {open && (
        <ul className="suggest" id={`${id}-list`} role="listbox"
            aria-label="Search suggestions">
          {rows.map((r, i) => (
            <li key={`${r.kind}-${r.label}`} id={`${id}-opt-${i}`} role="option"
                aria-selected={i === active}
                className={i === active ? 'on' : undefined}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); go(r.href) }}>
              <span className="kind">
                {r.kind === 'team' ? 'Team'
                  : r.kind === 'player' ? 'Player'
                  : r.kind === 'product' ? 'Jersey' : ''}
              </span>
              <span className="lbl">{r.label}</span>
              {'count' in r && <span className="n">{r.count}</span>}
            </li>
          ))}
        </ul>
      )}
      <p aria-live="polite" className="visually-hidden">
        {open ? `${rows.length} suggestions` : ''}
      </p>
    </div>
  )
}
