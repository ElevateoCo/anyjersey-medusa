'use client'
import { useEffect, useState } from 'react'
import { useDialogFocus } from '@/lib/use-dialog-focus'

/**
 * Mobile filter drawer.
 *
 * The facet rail is a sidebar on desktop, which is right. On mobile it stacked *above*
 * the grid and pushed every product off the first screen — actively bad on the majority
 * of traffic. Below 860px the same markup moves into a slide-over instead.
 *
 * The panel receives the server-rendered facet list as children, so there is one source
 * of filter markup rather than a desktop copy and a mobile copy that drift.
 */
export default function FilterDrawer({ activeCount, resultCount, children }:
  { activeCount: number; resultCount: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const dialog = useDialogFocus(open)

  // Escape closes; body scroll locks while open.
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
      <button className="filterbtn" onClick={() => setOpen(true)}
              aria-expanded={open} aria-controls="filter-drawer">
        Filters{activeCount > 0 && <b>{activeCount}</b>}
      </button>

      {open && (
        <>
          <div className="drawer-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={dialog} tabIndex={-1}
               className="drawer" id="filter-drawer" role="dialog" aria-modal="true"
               aria-label="Filter jerseys">
            <div className="drawer-head">
              <strong>Filters</strong>
              <button onClick={() => setOpen(false)} aria-label="Close filters">✕</button>
            </div>
            <div className="drawer-body">{children}</div>
            <div className="drawer-foot">
              <button className="btn block" onClick={() => setOpen(false)}>
                Show {resultCount.toLocaleString()} jerseys
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
