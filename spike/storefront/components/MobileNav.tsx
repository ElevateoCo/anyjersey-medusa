'use client'
import { useEffect, useState } from 'react'

/**
 * The phone header's menu button and the drawer it opens.
 *
 * Before this, there was **no mobile menu at all**: below 720px the category bar became a
 * horizontally scrolling strip of links and the utility bar was hidden outright, so Track
 * Order, Help, Returns and the account were unreachable on a phone — on the majority of
 * the traffic.
 *
 * It reuses `.drawer` / `.drawer-scrim`, the same primitives `FilterDrawer` and
 * `CartDrawer` share. Three slide-overs with one interaction vocabulary, one set of focus
 * and scroll-lock rules, one place to fix them.
 *
 * The contents come in as server-rendered children — see `NavAccordion`.
 */
export default function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', key)
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.removeEventListener('keydown', key)
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <>
      <button className="hamburger" onClick={() => setOpen(true)}
              aria-expanded={open} aria-controls="site-menu" aria-label="Menu">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <>
          <div className="drawer-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="drawer menu-drawer" id="site-menu" role="dialog" aria-modal="true"
               aria-label="Menu">
            <div className="drawer-head">
              <strong>Menu</strong>
              <button onClick={() => setOpen(false)} aria-label="Close menu">✕</button>
            </div>
            <div className="drawer-body">{children}</div>
          </div>
        </>
      )}
    </>
  )
}
