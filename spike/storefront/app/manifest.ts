import type { MetadataRoute } from 'next'
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site'

/**
 * Web app manifest.
 *
 * Not because anyone will install the store, but because without one an Android home-screen
 * shortcut takes the page title and a screenshot of the favicon, and the browser address bar
 * gets no theme colour. Both were showing Next.js defaults.
 *
 * `display: browser` on purpose. A standalone shell hides the URL bar, and hiding the URL
 * bar on a page that takes card details is the wrong trade — the address is how a customer
 * checks they are on the site they think they are on.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: 'Any Jersey',
    description: `${SITE_TAGLINE}. Can't find yours? Request it.`,
    start_url: '/',
    display: 'browser',
    background_color: '#FFFFFF',
    theme_color: '#121212',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  }
}
