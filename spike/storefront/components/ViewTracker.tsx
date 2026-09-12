'use client'
import { useEffect } from 'react'
import { noteViewed } from './RecentlyViewed'

/**
 * Records that this product was looked at.
 *
 * Renders nothing. It is a component rather than a hook because the product page is a
 * server component and this is the one thing on it that has to happen in the browser —
 * mounting a null client component is the cheapest way to cross that boundary without
 * making the whole page client-side.
 */
export default function ViewTracker({ handle }: { handle: string }) {
  useEffect(() => { noteViewed(handle) }, [handle])
  return null
}
