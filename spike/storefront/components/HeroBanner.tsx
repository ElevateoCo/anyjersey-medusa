'use client'
import { useEffect, useRef, useState } from 'react'
import type { Hero } from '@/lib/hero'

/**
 * The hero band. A campaign video or still, full bleed, 8:3.
 *
 * Modelled on nflshop.com's kickoff banner, with three corrections to the markup it uses.
 *
 * **1. `muted` is not optional.** Their element is `<video autoplay loop playsinline>` with
 * no `muted`, and every current browser refuses to autoplay a video with an audio track
 * unless it is muted. The result is a banner that plays for whoever wrote it — on a desktop
 * with an unmuted autoplay exception — and shows a frozen first frame for everybody else,
 * with no error anywhere.
 *
 * **2. `preload="none"` contradicts `autoplay`.** One says do not fetch this until asked,
 * the other says start playing immediately. `metadata` plus a `poster` is the combination
 * that actually behaves: the still paints at once and the file streams behind it.
 *
 * **3. Autoplaying motion needs a way to stop it.** WCAG 2.2.2 applies to anything that
 * moves for more than five seconds and starts on its own, and the reference does have a
 * pause control — it is the one thing in the pattern that is easy to drop and is not
 * optional. It is a real `<button>`, not an icon on a div.
 *
 * On top of those: **`prefers-reduced-motion` is honoured before autoplay is attempted**,
 * not merely respected by a CSS transition somewhere. Somebody who has asked their
 * operating system to stop things moving gets the poster frame and a play button, which is
 * the setting doing what it was asked to do rather than being acknowledged.
 *
 * The video is `aria-hidden` and not focusable: it is decoration behind a labelled link.
 * Meaning lives in the call to action and, when the artwork carries words, in `alt`.
 */
export default function HeroBanner({ hero, placeholder }: {
  hero: Hero
  /** Dev-only. A configured-looking empty band must never reach a customer. */
  placeholder?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [canPause, setCanPause] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setCanPause(true)
    if (reduce) return
    // `play()` returns a promise that rejects when the browser declines — a data-saver
    // mode, a battery policy, an unmuted track. Swallowing it leaves the poster up, which
    // is the correct outcome; letting it reject unhandled puts a console error on every
    // page load instead.
    el.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }, [hero.video])

  const toggle = () => {
    const el = ref.current
    if (!el) return
    if (el.paused) el.play().then(() => setPlaying(true)).catch(() => {})
    else { el.pause(); setPlaying(false) }
  }

  if (placeholder) {
    return (
      <section className="herobanner placeholder" aria-label="Campaign banner">
        <div className="hero-slot">
          <p className="eyebrow">Campaign banner &mdash; 1600 &times; 600</p>
          <p>
            Drop an <code>.mp4</code> or an image into{' '}
            <code>storefront/public/hero/</code> and set{' '}
            <code>NEXT_PUBLIC_HERO_VIDEO</code> or <code>NEXT_PUBLIC_HERO_IMAGE</code> in{' '}
            <code>.env.local</code>.
          </p>
          <p className="hero-slot-note">
            This box is development-only. With no asset configured the band does not render
            at all, so an unfinished campaign slot cannot reach a customer.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="herobanner" aria-label="Campaign banner">
      {hero.video ? (
        <>
          <video
            ref={ref}
            className="hero-media"
            // The four that make autoplay actually work, together.
            muted
            loop
            playsInline
            preload="metadata"
            poster={hero.poster ?? undefined}
            src={hero.video}
            aria-hidden="true"
            tabIndex={-1}
          />
          {canPause && (
            <button className="hero-pause" onClick={toggle}
                    aria-label={playing ? 'Pause the banner video' : 'Play the banner video'}>
              {playing ? (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="3" y="2" width="3.5" height="12" fill="currentColor" />
                  <rect x="9.5" y="2" width="3.5" height="12" fill="currentColor" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 2l10 6-10 6z" fill="currentColor" />
                </svg>
              )}
            </button>
          )}
        </>
      ) : hero.image ? (
        <img className="hero-media" src={hero.image} alt={hero.alt}
             // Above the fold on every viewport, so it is the one image on the page that
             // must not be lazy.
             loading="eager" decoding="async" fetchPriority="high" />
      ) : null}

      <div className="hero-cta">
        <a className="btn" href={hero.cta.href}>{hero.cta.label}</a>
      </div>
    </section>
  )
}
