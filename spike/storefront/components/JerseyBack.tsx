/**
 * The shirt back, drawn from the parameters.
 *
 * personalisation-spec.md §4.3: this block substitutes for the back photograph we do not
 * have, so it has to be *good* rather than indicative — it is the only thing on the page
 * showing what the customer is buying. SVG rather than Canvas because it scales to any
 * screen without a second asset, and because the text stays real text, which is what makes
 * the accessible description below it honest.
 *
 * Not a print file. The production render is a separate output whose format is still
 * unknown (spec §6); this is deliberately only the on-screen preview, and the spec says
 * the two are independent for exactly that reason.
 */
export default function JerseyBack({
  name, number, colour, accent, typeface,
}: {
  name?: string | null
  number?: string | null
  colour?: string
  accent?: string
  typeface?: string
}) {
  const shirt = colour ?? '#1F3A6E'
  const print = accent ?? '#F5F3EE'
  // One family per league, matching the server's typefaceFor(). The fallback stack is what
  // actually renders — the league faces are licensed assets we do not have, and the
  // licensing question is unresolved (research.md §13.9).
  const family = FAMILIES[typeface ?? ''] ?? FAMILIES.default

  // The name arcs slightly across the shoulders. A flat baseline reads as a mock-up; the
  // curve is what makes it read as a shirt.
  const arc = 'M 60 108 Q 200 80 340 108'

  return (
    <svg
      viewBox="0 0 400 460"
      className="jersey-back"
      role="img"
      aria-label={describe(name, number)}
    >
      <defs>
        <path id="name-arc" d={arc} />
        <linearGradient id="fabric" x1="0" y1="0" x2="0" y2="1">
          {/* A single flat fill reads as a swatch. Two stops read as cloth. */}
          <stop offset="0" stopColor={shirt} stopOpacity="1" />
          <stop offset="1" stopColor={shirt} stopOpacity="0.86" />
        </linearGradient>
      </defs>

      {/* Body: shoulders, sleeves, taper to the hem. */}
      <path
        d="M 140 40 L 120 34 L 58 76 L 92 132 L 116 116 L 110 420
           Q 200 434 290 420 L 284 116 L 308 132 L 342 76 L 280 34 L 260 40
           Q 200 66 140 40 Z"
        fill="url(#fabric)"
      />
      {/* Collar */}
      <path d="M 140 40 Q 200 66 260 40 Q 200 24 140 40 Z" fill={print} opacity="0.9" />
      {/* Seams — faint, so they suggest construction without competing with the print. */}
      <path d="M 116 116 L 110 420 M 284 116 L 290 420" stroke={print} strokeOpacity="0.12"
            strokeWidth="2" fill="none" />

      {name && (
        <text
          fill={print}
          fontFamily={family}
          fontSize="34"
          fontWeight="700"
          letterSpacing="3"
          textAnchor="middle"
        >
          {/* startOffset 50% centres the string on the arc regardless of length. */}
          <textPath href="#name-arc" startOffset="50%">{name}</textPath>
        </text>
      )}

      {number && (
        <text
          x="200"
          y="290"
          fill={print}
          fontFamily={family}
          fontSize="170"
          fontWeight="800"
          letterSpacing={number.length > 1 ? '2' : '0'}
          textAnchor="middle"
          // Dominant-baseline rather than a hand-tuned y: a one-digit and a two-digit
          // number then sit on the same line instead of drifting.
          dominantBaseline="middle"
        >
          {number}
        </text>
      )}

      {!name && !number && (
        <text x="200" y="250" fill={print} fontFamily={FAMILIES.default} fontSize="15"
              textAnchor="middle" opacity="0.55">
          Your name and number appear here
        </text>
      )}
    </svg>
  )
}

const FAMILIES: Record<string, string> = {
  'nfl-block': '"Arial Black", "Helvetica Neue", Impact, sans-serif',
  'nba-block': '"Arial Black", "Helvetica Neue", Impact, sans-serif',
  'mlb-varsity': 'Georgia, "Times New Roman", serif',
  'nhl-block': '"Arial Black", Impact, sans-serif',
  'ncaa-block': '"Arial Black", Impact, sans-serif',
  'soccer-sans': '"Helvetica Neue", Arial, sans-serif',
  default: '"Helvetica Neue", Arial, sans-serif',
}

/**
 * The text alternative.
 *
 * Required by §7.9 / WCAG 2.1 AA: a preview whose whole job is to show what is printed is
 * useless to a screen reader as `<img alt="preview">`. It describes the actual content,
 * and it changes as the parameters change.
 */
function describe(name?: string | null, number?: string | null): string {
  if (name && number) return `Preview: the back of the shirt printed with ${name} above the number ${number}.`
  if (name) return `Preview: the back of the shirt printed with the name ${name}.`
  if (number) return `Preview: the back of the shirt printed with the number ${number}.`
  return 'Preview: the plain back of the shirt, with no name or number yet.'
}
