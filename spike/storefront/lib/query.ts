export type Search = Record<string, string | string[] | undefined>

/**
 * Build a listing URL from the current filters plus a change.
 *
 * `offset` is dropped on every rebuild: changing a filter must return you to page one,
 * or you land on an empty page 5 of a 12-result set.
 */
export function buildQuery(
  current: Search,
  changes: Record<string, string | undefined>
): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(current)) {
    if (typeof v === 'string' && v && k !== 'offset') p.set(k, v)
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) p.delete(k)
    else p.set(k, v)
  }
  const s = p.toString()
  return s ? `/jerseys?${s}` : '/jerseys'
}
