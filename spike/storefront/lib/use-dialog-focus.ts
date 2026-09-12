'use client'
import { useEffect, useRef } from 'react'

/**
 * Focus management for a modal dialog.
 *
 * Three drawers and a sheet in this codebase declare `aria-modal="true"`, and until now
 * none of them did the three things that claim obliges:
 *
 *  1. **Move focus in when it opens.** Without this a keyboard user clicks Bag, a drawer
 *    covers the page, and their next Tab continues through the catalogue *behind* it — they
 *    are operating a page they cannot see. `keyboard_check.mjs` caught this on the cart and
 *    filter drawers.
 *  2. **Keep focus inside while it is open.** `aria-modal="true"` tells a screen reader the
 *    rest of the page is inert. If Tab walks out of the dialog, that statement is false and
 *    the user is somewhere the announcement says does not exist.
 *  3. **Put focus back when it closes.** Otherwise focus resets to the top of the document
 *    and the reader has to find their place again — after an action they took deliberately.
 *
 * Returns a ref to put on the dialog element. Escape stays with each component, because
 * what "close" means differs between them.
 */
export function useDialogFocus(open: boolean, onClose?: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const dialog = ref.current
    if (!dialog) return

    // Remember what to give focus back to, before anything moves.
    returnTo.current = document.activeElement as HTMLElement | null

    const focusable = () =>
      [...dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
        ' textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      )].filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')

    /**
     * The first control, or the dialog itself.
     *
     * Not the close button, which is what a naive "first focusable" picks in all three of
     * these — landing a keyboard user on ✕ makes dismissing the thing they just opened the
     * easiest action available. The heading is not focusable, so the dialog takes focus
     * itself when there is nothing better, which is what `tabIndex={-1}` on it is for.
     */
    const first = focusable().find((el) => !/close|dismiss/i.test(
      el.getAttribute('aria-label') ?? el.textContent ?? ''
    )) ?? focusable()[0] ?? dialog
    first.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusable()
      if (!items.length) { e.preventDefault(); return }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement as HTMLElement

      // Wrap at both ends, and pull focus back in if it has escaped the dialog entirely —
      // which happens when the browser moves it during a re-render.
      if (!dialog.contains(active)) { e.preventDefault(); firstEl.focus(); return }
      if (e.shiftKey && active === firstEl) { e.preventDefault(); lastEl.focus() }
      else if (!e.shiftKey && active === lastEl) { e.preventDefault(); firstEl.focus() }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      // Only if focus is still somewhere in the dialog being unmounted; if the customer
      // has clicked into the page behind it, do not yank them back.
      const active = document.activeElement
      if (!active || active === document.body || dialog.contains(active)) {
        returnTo.current?.focus?.()
      }
    }
  }, [open])

  return ref
}
