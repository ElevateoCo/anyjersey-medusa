import type { NextConfig } from 'next'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

/**
 * Content Security Policy.
 *
 * research.md §7.5: with Medusa's Stripe provider the card fields are an iframe on our own
 * domain, which puts us in PCI **SAQ A-EP** rather than SAQ A. Requirements 6.4.3 and
 * 11.6.1 then make this file part of the compliance surface, not a nicety:
 *
 *   - every script on the payment page must be authorised and integrity-assured
 *   - unauthorised change to the page must be detectable
 *
 * So the allow-list is deliberately short and every entry is justified. Adding a marketing
 * pixel here is a compliance decision, and the comment is the audit trail.
 *
 * **The API origin is read from the environment, not hardcoded.** It used to say
 * `http://localhost:9000` in `img-src` and `connect-src`, which is a CSP that works
 * perfectly in development and blocks every product image and every API call the moment the
 * backend is anywhere else. That failure mode is the worst kind: the build succeeds, the
 * page renders, and the content is missing.
 */
const API_ORIGIN = (() => {
  const raw = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
  try {
    // Origin only. A full URL with a path in a CSP source is silently ignored by browsers
    // for these directives, which would quietly widen or void the rule.
    return new URL(raw).origin
  } catch {
    return 'http://localhost:9000'
  }
})()

/**
 * PostHog, and only when it is configured.
 *
 * An allow-list entry for an analytics host that is not in use widens the payment page's
 * script surface for nothing, and 6.4.3 asks us to justify each entry. So the entry exists
 * only when the key does.
 */
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_KEY
  ? (() => {
      try {
        return new URL(
          process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'
        ).origin
      } catch {
        return ''
      }
    })()
  : ''

/**
 * Stripe's own required hosts, taken from their integration security guide rather than from
 * memory — every entry here is one they name.
 *
 * The first version of this allowed `js.stripe.com` only, which works for the card fields and
 * **silently fails** for anything Stripe renders on a sibling origin. Stripe's guide is
 * explicit: `*.js.stripe.com` is what lets Stripe.js start frames on different origins, and
 * that is the mechanism the wallet buttons and Link use. A blocked frame produces no error a
 * customer can see — the button simply never appears — which is the worst way for a payment
 * page to fail.
 *
 * `link.com` is included because the Payment Element offers Link by default. If Link is
 * turned off in the Stripe dashboard these three entries can go; they are listed separately
 * so that decision is a deletion rather than an archaeology exercise.
 *
 * `maps.googleapis.com` is deliberately **absent**: it is only needed for the Address Element
 * with your own Google Maps key, which this checkout does not use. Requirement 6.4.3 asks for
 * each entry to be justified, and an unjustified one is a widened script surface on the
 * payment page.
 */
const STRIPE = {
  script: ['https://js.stripe.com', 'https://*.js.stripe.com'],
  frame: ['https://js.stripe.com', 'https://*.js.stripe.com', 'https://hooks.stripe.com'],
  connect: ['https://api.stripe.com'],
}
const LINK = {
  frame: ['https://link.com', 'https://*.link.com'],
  connect: ['https://link.com', 'https://*.link.com'],
  img: ['https://*.link.com'],
}

const csp = [
  "default-src 'self'",
  // 'unsafe-inline' is required by Next's hydration bootstrap. It is the one concession,
  // and it is why 11.6.1 tamper detection matters rather than being optional.
  `script-src 'self' 'unsafe-inline' ${STRIPE.script.join(' ')}${POSTHOG_HOST ? ` ${POSTHOG_HOST}` : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  // Images come from our own API (bytes live in Postgres), plus data: for inline SVG and
  // blob: for the personalisation preview. Link serves its own assets.
  `img-src 'self' data: blob: ${API_ORIGIN} ${LINK.img.join(' ')}`,
  `connect-src 'self' ${API_ORIGIN} ${[...STRIPE.connect, ...LINK.connect].join(' ')}${POSTHOG_HOST ? ` ${POSTHOG_HOST}` : ''}`,
  // Stripe Elements, the wallet sheets and Link render in iframes; nothing else may.
  `frame-src ${[...STRIPE.frame, ...LINK.frame].join(' ')}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  /**
   * `payment=(self "https://js.stripe.com")` is what lets the Payment Request API run.
   *
   * Apple Pay and Google Pay both go through it, and a Permissions-Policy that omits
   * `payment` disables the wallet buttons with no error — the same silent failure as a
   * blocked frame. Scoped to self and Stripe rather than `*`, so no other embedded origin
   * inherits it.
   */
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")',
  },
  // HSTS only matters over TLS; harmless locally and required in production.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
]

/**
 * The old shop's URLs.
 *
 * Shopify serves policies at `/policies/privacy-policy` and pages at `/pages/…`; this store
 * uses shorter slugs and its own paths. Every one of these is a live, indexed URL on
 * cruxchristi.com today, so without a mapping the move loses whatever ranking each has
 * accumulated — and the 404s are invisible until somebody checks Search Console weeks later.
 *
 * `permanent: true` sends 308, which Google treats exactly as 301.
 *
 * Products are **not** here: their slugs changed as well as their path (1,083 of 3,155 came
 * out of the import with a different handle), so they need a lookup rather than a rule. That
 * lives at `app/products/[handle]/page.tsx`.
 *
 * Collections need nothing: the curated collections were imported keeping the live store's
 * handles, so `/collections/best-sellers` already resolves.
 */
const shopifyRedirects = [
  // Policies — same path, different slugs.
  { source: '/policies/privacy-policy', destination: '/policies/privacy' },
  { source: '/policies/terms-of-service', destination: '/policies/terms' },
  { source: '/policies/refund-policy', destination: '/policies/refunds' },
  { source: '/policies/shipping-policy', destination: '/policies/shipping' },
  // Shopify's contact-information policy is a page here, not a policy.
  { source: '/policies/contact-information', destination: '/contact' },

  // Pages.
  { source: '/pages/contact', destination: '/contact' },
  { source: '/pages/request-a-jersey', destination: '/request' },
  { source: '/pages/size-guide', destination: '/size-guide' },
  { source: '/pages/shipping', destination: '/shipping' },
  { source: '/pages/returns', destination: '/returns' },

  // Shopify's own conventions that have no equivalent here. Sending them to the listing
  // rather than letting them 404: somebody arriving on one is a shopper either way.
  { source: '/collections/all', destination: '/jerseys' },
  { source: '/search', destination: '/jerseys' },
  { source: '/cart', destination: '/cart' },
].map((r) => ({ ...r, permanent: true }))

const nextConfig: NextConfig = {
  // There is a lockfile at the repo root and one here, so Next infers the workspace root
  // and warns that it may have guessed wrong. It had: the storefront is its own app with
  // its own dependencies. Pinning it removes a warning that would otherwise be read as
  // noise every time somebody starts the dev server.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  images: { unoptimized: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  async redirects() {
    // `/cart` maps to itself, which Next rejects as a cycle. Filtered rather than removed
    // from the list above, so the list stays a readable record of the old shop's URLs.
    return shopifyRedirects.filter((r) => r.source !== r.destination)
  },
}

export default nextConfig
