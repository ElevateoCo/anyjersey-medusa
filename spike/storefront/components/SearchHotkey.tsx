'use client'
import { useEffect } from 'react'

/**
 * `/` focuses search, the way it does on GitHub, Slack and the demo concept.
 *
 * Renders nothing. It is worth having because search *is* the primary navigation for a
 * 4,300-product catalogue across seven sports — `layout-plan.md` §5 band B is an argument
 * about exactly that — and the keyboard route to it should not be a Tab through the whole
 * header.
 *
 * The guard is the entire subtlety. A shortcut that steals `/` while somebody is typing an
 * address, a surname or a discount code is worse than no shortcut, so it stands down inside
 * any field, inside anything `contenteditable`, and whenever a modifier is held — `/` is
 * also the last key of a great many browser and OS shortcuts.
 */
export default function SearchHotkey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.isContentEditable ||
                 ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return
      // On a phone the header field is not rendered — the magnifier opens a sheet — but a
      // phone with a hardware keyboard exists, so fall back to the button rather than to
      // nothing.
      const field = document.getElementById('q-header') as HTMLInputElement | null
      if (field && field.offsetParent !== null) {
        e.preventDefault()
        field.focus()
        field.select()
        return
      }
      const btn = document.querySelector<HTMLButtonElement>('.searchbtn')
      if (btn) { e.preventDefault(); btn.click() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return null
}
