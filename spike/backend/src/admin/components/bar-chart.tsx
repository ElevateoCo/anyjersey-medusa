import { Text } from '@medusajs/ui'

/**
 * Single-series bar chart, inline SVG.
 *
 * One series, so there is no legend — the heading names it. The hue is #0E9E88, a
 * saturated member of the brand's teal family; the brand's own #108474 was rejected
 * because it fails the chroma floor (0.097) and reads grey as a data mark. #0E9E88
 * validates clean against both the light and dark admin surfaces.
 *
 * Marks: thin bars anchored to the baseline with 4px rounded data-ends, a 2px surface
 * gap between them, a recessive baseline, and no gridlines — 30 bars do not need them.
 * Every bar carries a <title> so hover and screen readers both get the value.
 */
export const DATA_HUE = '#0E9E88'

export type Point = { key: string; value: number; label?: string }

export default function BarChart({ points, format, height = 132, emptyNote }:
  { points: Point[]; format?: (n: number) => string; height?: number; emptyNote?: string }) {
  const fmt = format ?? ((n: number) => String(n))
  const max = Math.max(...points.map((p) => p.value), 0)

  if (!points.length || max === 0) {
    return (
      <div className="flex items-center justify-center rounded-md border border-ui-border-base"
           style={{ height }}>
        <Text size="small" className="text-ui-fg-muted">
          {emptyNote ?? 'No data in this period'}
        </Text>
      </div>
    )
  }

  const W = 720
  const H = height
  const pad = { top: 10, bottom: 18, left: 0, right: 0 }
  const plot = H - pad.top - pad.bottom
  const slot = W / points.length
  const gap = 2
  const barW = Math.max(slot - gap, 1)

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
           preserveAspectRatio="none"
           aria-label={`Bar chart, ${points.length} periods, peak ${fmt(max)}`}>
        {/* recessive baseline only — no gridlines behind 30 bars */}
        <line x1={0} x2={W} y1={H - pad.bottom} y2={H - pad.bottom}
              stroke="currentColor" strokeOpacity={0.14} strokeWidth={1} />
        {points.map((p, i) => {
          const h = p.value > 0 ? Math.max((p.value / max) * plot, 2) : 0
          const x = i * slot + gap / 2
          const y = H - pad.bottom - h
          return (
            <g key={p.key}>
              {h > 0 && (
                <rect x={x} y={y} width={barW} height={h} rx={Math.min(4, barW / 2)}
                      fill={DATA_HUE} />
              )}
              {/* full-height hit target, bigger than the mark */}
              <rect x={x} y={pad.top} width={barW} height={plot} fill="transparent">
                <title>{`${p.label ?? p.key}: ${fmt(p.value)}`}</title>
              </rect>
            </g>
          )
        })}
      </svg>
      <figcaption className="flex justify-between mt-1">
        <Text size="xsmall" className="text-ui-fg-muted">{points[0]?.label ?? points[0]?.key}</Text>
        <Text size="xsmall" className="text-ui-fg-muted">peak {fmt(max)}</Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          {points[points.length - 1]?.label ?? points[points.length - 1]?.key}
        </Text>
      </figcaption>
    </figure>
  )
}

/** Ranked magnitude across categories. Horizontal, direct-labelled, no legend. */
export function RankedBars({ rows, format }:
  { rows: { key: string; value: number; sub?: string }[]; format: (n: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 0)
  if (!rows.length) {
    return <Text size="small" className="text-ui-fg-muted">Nothing in this period</Text>
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <div className="w-40 shrink-0 truncate" title={r.key}>
            <Text size="small">{r.key}</Text>
          </div>
          <div className="flex-1 h-4 relative">
            <div
              style={{
                width: `${max ? Math.max((r.value / max) * 100, 1) : 0}%`,
                height: '100%', background: DATA_HUE, borderRadius: 4,
              }}
              title={`${r.key}: ${format(r.value)}`}
            />
          </div>
          <div className="w-24 text-right shrink-0 tabular-nums">
            <Text size="small">{format(r.value)}</Text>
            {r.sub && <Text size="xsmall" className="text-ui-fg-muted">{r.sub}</Text>}
          </div>
        </div>
      ))}
    </div>
  )
}
