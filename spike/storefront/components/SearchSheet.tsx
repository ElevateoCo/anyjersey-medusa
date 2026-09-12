'use client'
import { useEffect, useState } from 'react'
import { useDialogFocus } from '@/lib/use-dialog-focus'
import SearchBox from './SearchBox'

/**
 * Search, on a phone.
 *
 * `layout-plan.md` §6 item 3. A 280px inline field with a suggestion dropdown under an
 * open phone keyboard is unusable: the list renders into the ~180px of screen the keyboard
 * has not taken, and the first suggestion sits under the shift key. Tapping the magnifier
 * gives the task the whole screen instead.
 *
 * It mounts `SearchBox` rather than reimplementing it, so there is one combobox, one
 * suggestion endpoint and one set of keyboard bindings in the codebase — the alternative
 * is a second search that drifts from the first.
 */
export default function SearchSheet() {
  const [open, setOpen] = useState(false)
  const dialog = useDialogFocus(open)

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', key)
    document.body.style.overflow = 'hidden'
    // The field is the only reason the sheet exists, so it takes focus on open.
    document.querySelector<HTMLInputElement>('#q-sheet')?.focus()
    return () => {
      document.removeEventListener('keydown', key)
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <>
      <button className="searchbtn" onClick={() => setOpen(true)}
              aria-expanded={open} aria-label="Search">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.9" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5L21 21" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div ref={dialog} tabIndex={-1}
             className="searchsheet" role="dialog" aria-modal="true" aria-label="Search">
          <div className="searchsheet-head">
            <SearchBox id="q-sheet" />
            <button onClick={() => setOpen(false)} aria-label="Close search">Cancel</button>
          </div>
        </div>
      )}
    </>
  )
}
