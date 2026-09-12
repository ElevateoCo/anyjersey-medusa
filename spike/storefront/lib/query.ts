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
    if (k === 'offset' || !v) continue
    // A repeated key is how a multi-value filter reaches the API — `?garment=shorts&
    // garment=set` is the "Shorts & Kits" nav slot. Dropping arrays here, which is what
    // the string-only test used to do, silently widened that listing to the whole
    // catalogue the moment anybody touched a filter or a sort on it.
    if (Array.isArray(v)) v.forEach((one) => one && p.append(k, one))
    else p.set(k, v)
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) p.delete(k)
    else p.set(k, v)
  }
  const s = p.toString()
  return s ? `/jerseys?${s}` : '/jerseys'
}

/**
 * Add or remove one value from a filter that can hold several.
 *
 * `buildQuery` replaces a key outright, which is what a single-select sidebar wants and
 * exactly wrong for a multi-select one: clicking a second team would drop the first. This
 * toggles within the key instead — present, and it comes out; absent, and it is appended.
 *
 * The repeated form is what the API needs. Express parses `?team=A&team=B` into an array
 * and MikroORM reads an array as an `IN`; a comma-joined value arrives as the single
 * literal string "A,B" and matches nothing, which looks exactly like an empty catalogue.
 *
 * `offset` is dropped for the same reason `buildQuery` drops it — narrowing a filter while
 * on page 5 of a 12-result set lands you on an empty page.
 */
export function toggleQuery(current: Search, key: string, value: string): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(current)) {
    if (k === 'offset' || k === key || !v) continue
    if (Array.isArray(v)) v.forEach((one) => one && p.append(k, one))
    else p.set(k, v)
  }
  const raw = current[key]
  const values = Array.isArray(raw) ? raw.filter(Boolean)
    : typeof raw === 'string' && raw ? [raw] : []
  const next = values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value]
  next.forEach((v) => p.append(key, v))
  const s = p.toString()
  return s ? `/jerseys?${s}` : '/jerseys'
}

/** Every value currently applied to one filter, whether it arrived as one or as several. */
export function valuesFor(current: Search, key: string): string[] {
  const raw = current[key]
  if (Array.isArray(raw)) return raw.filter(Boolean)
  return typeof raw === 'string' && raw ? [raw] : []
}
