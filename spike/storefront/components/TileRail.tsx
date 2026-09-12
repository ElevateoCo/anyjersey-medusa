'use client'
import { useEffect, useRef, useState } from 'react'

/**
 * The scroll shell for a full-bleed band of tiles.
 *
 * The tiles themselves are server-rendered and arrive as children — this owns the scroll
 * position and the two arrows, and nothing else. Same split as `NavItem`: the content is in
 * the first response, the interaction is the only thing that needs the client.
 *
 * **Why arrows at all**, when the team rail below it has none: this band is full-bleed and
 * its tiles are 300px wide, so on a desktop the overflow is real and there is no touch
 * gesture to discover it with. A trackpad user can swipe, a mouse user cannot. The arrows
 * are hidden where they are not needed — when nothing overflows, and on touch, where the
 * gesture is the affordance.
 */
export default function TileRail({ label, children }: {
  label: string
  children: React.ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ start: boolean; end: boolean }>({ start: true, end: true })

  const measure = () => {
    const el = box.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setAt({ start: el.scrollLeft <= 2, end: el.scrollLeft >= max - 2 })
  }

  useEffect(() => {
    measure()
    const el = box.current
    if (!el) return
    // The tiles are images, so the scroll width is not final at mount.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const nudge = (dir: 1 | -1) => {
    const el = box.current
    if (!el) return
    // A tile and a bit, so the next one lands under the cursor rather than flush to the
    // edge — a scroll that stops exactly on a boundary looks like it did not move.
    el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.8, 960), behavior: 'smooth' })
  }

  const hidden = at.start && at.end

  return (
    <div className="tilerail">
      <div className="tilescroll" ref={box} onScroll={measure}
           role="group" aria-label={label}>
        {children}
      </div>
      {!hidden && (
        <>
          <button className="railarrow left" onClick={() => nudge(-1)}
                  disabled={at.start} aria-label={`Scroll ${label} left`}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="railarrow right" onClick={() => nudge(1)}
                  disabled={at.end} aria-label={`Scroll ${label} right`}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </>
      )}
    </div>
  )
}
