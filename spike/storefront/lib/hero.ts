/**
 * The homepage hero banner — a full-bleed 8:3 band for a campaign video or still.
 *
 * Configured by environment rather than committed, because the asset is marketing that
 * changes on a different clock from the code: a seasonal film is swapped by whoever owns
 * the campaign, not by a deploy. Nothing here ships an asset; it resolves which one to use
 * and whether there is one at all.
 *
 * Drop a file at `storefront/public/hero/` and point the variable at it, or give an
 * absolute URL on a host the CSP allows — `media-src` in `next.config.ts` is the list, and
 * a URL outside it fails **silently**, which is the specific failure mode `DEFERRED.md` §1
 * records for the wallet buttons.
 */
export type Hero = {
  /** An MP4 or WebM. Takes precedence over `image` when both are set. */
  video: string | null
  /** First frame, shown while the video loads and instead of it under reduced motion. */
  poster: string | null
  image: string | null
  /**
   * Empty means decorative — correct for a photograph sitting behind a labelled call to
   * action, which is what this band is. **Set it when the artwork carries words**: a
   * banner whose only statement of "Kickoff 2026" is baked into the pixels says nothing
   * at all to a screen reader, and nothing to a crawler either.
   */
  alt: string
  cta: { label: string; href: string }
}

const env = (k: string) => {
  const v = process.env[k]
  return v && v.trim() ? v.trim() : null
}

export function getHero(): Hero {
  return {
    video: env('NEXT_PUBLIC_HERO_VIDEO'),
    poster: env('NEXT_PUBLIC_HERO_POSTER'),
    image: env('NEXT_PUBLIC_HERO_IMAGE'),
    alt: process.env.NEXT_PUBLIC_HERO_ALT ?? '',
    cta: {
      label: env('NEXT_PUBLIC_HERO_CTA') ?? 'Shop all jerseys',
      href: env('NEXT_PUBLIC_HERO_HREF') ?? '/jerseys',
    },
  }
}

/** True when an asset is configured. Nothing renders in production without one. */
export const hasHeroAsset = (h: Hero) => !!(h.video || h.image)
