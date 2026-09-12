/**
 * How a catalogue value is written when it is shown to a customer.
 *
 * The taxonomy stores sports lower-case (`football`, `college football`, `mma`) and leagues
 * and teams as they are written (`NFL`, `Dallas Cowboys`). A heading needs the capital and
 * must not "fix" the ones that already have theirs — and `mma` is the one value that is an
 * acronym stored lower-case, so "More mma" and "Mma jerseys" are what a naive title-case
 * produces. That is the kind of detail that makes a shop look automated.
 */
const ACRONYMS = new Set(['mma'])

export const display = (v: string): string =>
  ACRONYMS.has(v.toLowerCase()) ? v.toUpperCase()
  : v === v.toLowerCase() ? v.replace(/^./, (c) => c.toUpperCase())
  : v
