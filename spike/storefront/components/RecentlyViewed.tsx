'use client'
import { useEffect, useState } from 'react'
import type { Card } from '@/lib/medusa'
import { REGION_ID } from '@/lib/medusa'
import ProductCard from './ProductCard'

/**
 * Recently viewed.
 *
 * The one rail on the page that is different for every visitor, and the only personal thing
 * the storefront has — there is no wishlist (`DEFERRED.md` §7) and an account is optional.
 *
 * **It lives in `localStorage`, deliberately, and that is the whole design.** Storing it
 * server-side would mean either an account (which most of this traffic will not have) or a
 * per-visitor record keyed to a cookie — which is a behavioural profile, needs a lawful
 * basis, and would land inside the §31 privacy work as a new category of personal data to
 * export and erase. A list of handles in the visitor's own browser is none of those things:
 * it never reaches us, so there is nothing to disclose, export or delete.
 *
 * The consequence is that it renders after hydration rather than in the HTML. That is
 * correct for this rail specifically — it is per-device by definition, so there is no
 * server-rendered version of it to be had, and a skeleton for something two-thirds of first
 * visits will not show is worse than nothing.
 */
const KEY = 'anyjersey.recent.v1'
const MAX = 12

type Stored = { handle: string; at: number }

function read(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((x): x is Stored => !!x && typeof x.handle === 'string')
      .sort((a, b) => b.at - a.at)
      .map((x) => x.handle)
      .slice(0, MAX)
  } catch {
    // Private browsing, cleared site data, storage disabled. Not an error: no history.
    return []
  }
}

/** Called by the product page. Exported so there is one writer and one key. */
export function noteViewed(handle: string) {
  try {
    const kept = read().filter((h) => h !== handle)
    const next: Stored[] = [{ handle, at: Date.now() }]
      .concat(kept.map((h, i) => ({ handle: h, at: Date.now() - (i + 1) })))
      .slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch { /* see above */ }
}

export default function RecentlyViewed({ exclude, title = 'Recently viewed' }: {
  /** The product being looked at. It is not "recently viewed", it is on the screen. */
  exclude?: string
  title?: string
}) {
  const [items, setItems] = useState<Card[] | null>(null)

  /**
   * The handles are looked **up**, not cached alongside the cards.
   *
   * The first version of this took a pool of products the page already held and showed the
   * intersection — no request, and almost never a rail: a homepage holds perhaps sixty of
   * 4,323 products, so two genuinely-viewed shirts turned into nothing. Caching the cards
   * in `localStorage` instead would have worked and put a stale price on the one rail whose
   * whole job is to take somebody back to a shirt they are considering. So the browser
   * holds the handles, which never go stale, and asks the store for current cards.
   *
   * One request, only when there is a history, and only in a browser — this component does
   * not exist on the server.
   */
  useEffect(() => {
    const handles = read().filter((h) => h !== exclude).slice(0, 6)
    if (handles.length < 2) { setItems([]); return }

    const qs = new URLSearchParams()
    handles.forEach((h) => qs.append('handle', h))
    if (REGION_ID) qs.set('region_id', REGION_ID)

    let live = true
    fetch(`${process.env.NEXT_PUBLIC_MEDUSA_URL}/store/jerseys?${qs}`, {
      headers: { 'x-publishable-api-key': process.env.NEXT_PUBLIC_MEDUSA_PK ?? '' },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { products: Card[] }) => {
        if (!live) return
        // The API returns them in its own order; the rail wants most-recent first.
        const order = new Map(handles.map((h, i) => [h, i]))
        setItems([...(d.products ?? [])]
          .filter((p) => order.has(p.handle))
          .sort((a, b) => order.get(a.handle)! - order.get(b.handle)!))
      })
      // A convenience rail. Failing it silently is right; an error message about products
      // the customer already saw is noise.
      .catch(() => { if (live) setItems([]) })
    return () => { live = false }
  }, [exclude])

  if (items === null) return null

  // A rail of one is not a section — and a product deleted since it was viewed simply
  // does not come back, which is why this is checked after the lookup and not before.
  if (items.length < 2) return null

  return (
    <section className="band">
      <div className="wrap">
        <div className="sechead">
          <h2>{title}</h2>
          <button className="linkish clearrecent" onClick={() => {
            try { localStorage.removeItem(KEY) } catch { /* nothing to clear */ }
            setItems([])
          }}>Clear</button>
        </div>
        <div className="grid six">
          {items.slice(0, 6).map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      </div>
    </section>
  )
}
