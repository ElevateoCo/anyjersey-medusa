'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { buildQuery } from '@/lib/query'

const LABELS: Record<string, string> = {
  relevance: 'Featured',
  newest: 'Newest first',
  oldest: 'Oldest first',
  'name-asc': 'Name, A–Z',
  'name-desc': 'Name, Z–A',
}

/**
 * Builds its own URL from the live search params rather than taking a callback — a
 * function cannot cross the server/client boundary in RSC.
 */
export default function SortSelect({ options, current }:
  { options: string[]; current: string }) {
  const router = useRouter()
  const params = useSearchParams()

  return (
    <div className="sortwrap">
      <label htmlFor="sort">Sort by</label>
      <select
        id="sort"
        defaultValue={current}
        onChange={(e) => {
          const next = Object.fromEntries(params.entries())
          router.push(buildQuery(next, { sort: e.target.value }))
        }}
      >
        {options.map((o) => <option key={o} value={o}>{LABELS[o] ?? o}</option>)}
      </select>
    </div>
  )
}
