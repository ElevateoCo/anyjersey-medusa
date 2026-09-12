'use client'
import { useEffect, useRef, useState } from 'react'

/**
 * One slot on the category bar, and its mega-panel.
 *
 * **The panel's contents are not in this file, and that is the point.** They arrive as
 * `children` already rendered on the server, so 173 team links are in the initial HTML —
 * crawlable, and present before any JavaScript runs. What lives here is the open/closed
 * boolean and nothing else. `layout.tsx:76` records that this codebase has put server data
 * on the wrong side of that boundary twice; a nav panel that renders client-side is the
 * third opportunity.
 *
 * Interaction, in the order it matters:
 *
 * - **Pointer:** hover opens, leaving closes. A short close delay covers the diagonal
 *   travel from the trigger to the panel, which is the classic way these menus feel broken.
 * - **Keyboard:** focus anywhere inside opens it, so tabbing onto the trigger reveals the
 *   panel and the next Tab walks into its links. Escape closes and puts focus back on the
 *   trigger — the plan lists this as a gate, not a nicety.
 * - **Touch:** there is no hover on a phone, and this bar is replaced by the drawer below
 *   900px anyway. On a tablet the first tap opens rather than navigating, the second
 *   follows the link.
 *
 * The trigger stays an `<a>` with a real `href`. Every one of these slots is a destination
 * in its own right ("Football" is a listing, not just a label), so turning it into a button
 * would take a working link away to gain an ARIA pattern.
 */
export default function NavItem({ label, href, flag, children }: {
  label: string
  href: string
  flag?: string
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [touched, setTouched] = useState(false)
  const root = useRef<HTMLLIElement>(null)
  const trigger = useRef<HTMLAnchorElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const openNow = () => { cancelClose(); setOpen(true) }
  // 120ms is the gap between "moving to the panel" and "moving away", measured on the
  // diagonal from the last bar item to the far column of its panel.
  const closeSoon = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }

  useEffect(() => cancelClose, [])

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open])

  if (!children) {
    return (
      <li className="navitem">
        <a href={href} className={flag ? 'flagged' : undefined}>
          {label}{flag && <span className="navflag">{flag}</span>}
        </a>
      </li>
    )
  }

  return (
    <li
      ref={root}
      className={open ? 'navitem haspanel open' : 'navitem haspanel'}
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onFocus={openNow}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node)) setOpen(false)
      }}
    >
      <a
        ref={trigger}
        href={href}
        aria-haspopup="true"
        aria-expanded={open}
        className={flag ? 'flagged' : undefined}
        onClick={(e) => {
          // A tablet gets one tap to open and a second to follow the link. A mouse, which
          // has already opened the panel on hover, follows the link on the first click.
          if (window.matchMedia('(hover: hover)').matches) return
          if (!touched) { e.preventDefault(); setTouched(true); setOpen(true) }
        }}
      >
        {label}{flag && <span className="navflag">{flag}</span>}
        <svg className="navcaret" width="9" height="6" viewBox="0 0 9 6" aria-hidden="true">
          <path d="M1 1l3.5 3.5L8 1" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" />
        </svg>
      </a>
      <div className="megapanel" hidden={!open}>
        <div className="wrap megainner">{children}</div>
      </div>
    </li>
  )
}
