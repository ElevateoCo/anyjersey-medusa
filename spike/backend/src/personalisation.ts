/**
 * Personalisation: pricing, eligibility and validation.
 *
 * Pure functions, deliberately with no container, no database and no I/O, because all three
 * consumers have to agree exactly: the product page previewing a price, the add-to-cart
 * path charging it, and the admin queue reviewing it. The bug this shape prevents is the
 * storefront quoting $19.99 for a bundle while the server charges $24.98 for two separate
 * add-ons — the same class of drift that had the cart page hardcoding $4.99 for every zone
 * before the rate card became a module.
 *
 * Prices are marked [confirm] in personalisation-spec.md §1 and are still proposals. They
 * live here as one exported table so that changing them is one edit, and so no historical
 * order ever reads them: every captured personalisation snapshots its own price
 * (spec §5, and the same rule as order lines in research.md §6.2).
 */

export type PersonalisationKind = 'name' | 'number' | 'bundle' | 'patch'
export type Placement = 'back' | 'front' | 'sleeve' | 'chest'

/** Cents, to avoid the float class of bug entirely. */
export const PRICES: Record<PersonalisationKind, number> = {
  name: 1499,
  number: 999,
  bundle: 1999, // name + number together; $4.99 less than buying both
  patch: 799,
}

/**
 * 14, matching the live store.
 *
 * `personalisation-spec.md` §1 proposed 12. The shop currently trading accepts 14
 * (`maxlength="14"` on its own custom-jersey form), and rejecting a name a customer has
 * already successfully ordered under is a worse failure than a slightly tighter print
 * width. The spec has been corrected rather than the store.
 */
export const NAME_MAX = 14
export const NUMBER_MIN = 0
export const NUMBER_MAX = 99

/**
 * Allowed name characters.
 *
 * Letters, space, apostrophe, hyphen, full stop — enough for O'Neill, Vande Velde,
 * Jr. and Mbappé. Accents are folded rather than rejected, because a customer typing
 * their own name correctly should not be told it is invalid; the print file uses the
 * folded form since the shirt typefaces have no accented glyphs.
 */
const NAME_ALLOWED = /^[A-Z .'-]+$/

/** Spec §2: a blocklist is required, not optional. */
const PROFANITY = [
  'fuck', 'shit', 'cunt', 'bitch', 'dick', 'cock', 'wank', 'twat', 'slut', 'whore',
  'bastard', 'arse', 'piss', 'prick', 'fag', 'faggot', 'nigger', 'nigga', 'spic',
  'kike', 'chink', 'tranny', 'retard', 'rape', 'nazi', 'hitler', 'isis', 'jihad',
]
/**
 * Names that must not be printed to order.
 *
 * Not a moral list — a liability list. Each entry is here because printing it creates a
 * legal or reputational exposure that a $14.99 add-on does not cover: figures associated
 * with atrocity, and the small set of names that are reliably used to make a shirt into a
 * statement about a real person.
 */
const BLOCKED_NAMES = [
  'hitler', 'stalin', 'putin', 'binladen', 'osama', 'saddam', 'epstein', 'hussein',
]

/**
 * Substrings checked against the squashed form, for spacing evasion.
 *
 * Squashing alone is not safe — this is the Scunthorpe problem, and a test caught it:
 * 'SCUNTHORPE' squashes to a string containing 'cunt', so a plain containment check
 * refuses a real English surname. Blocking a customer's own name is worse than letting an
 * evasion through, because one is an insult to a paying customer and the other is caught
 * by the human review queue every order passes anyway (spec §6).
 *
 * So squashing is applied only when the string *looks* like evasion — see
 * `looksSeparated` — and the ordinary path stays word-boundary based.
 */
const SQUASHED_BLOCKED = ['nigger', 'nigga', 'faggot', 'kike', 'cunt', 'fuck', 'shit']

export type Eligibility = { eligible: boolean; reason?: string }

/**
 * Which products can be personalised — spec §3.
 *
 * Gated on data we actually have, which is the reason for each clause: the garment must be
 * something with a back to print on, the taxonomy must be trustworthy (the 262
 * needs_review products are excluded until reviewed), and the team must be known because
 * it selects the typeface.
 */
export function eligibility(detail: {
  garment?: string | null
  team?: string | null
  needs_review?: boolean | null
  is_custom?: boolean | null
} | null | undefined): Eligibility {
  if (!detail) return { eligible: false, reason: 'no catalogue detail for this product' }
  // A custom jersey is a blank sold to be printed. Its whole reason for existing is the
  // printing, so it is eligible by definition — but it still has to clear the checks below,
  // because a blank with no team resolves to no typeface just like any other shirt.
  const garment = (detail.garment ?? '').toLowerCase()
  if (!['jersey', 'longsleeve-jersey'].includes(garment)) {
    return { eligible: false, reason: `${garment || 'unknown garment'} cannot be personalised` }
  }
  if (detail.needs_review) {
    return { eligible: false, reason: 'product taxonomy is unreviewed' }
  }
  if (!detail.team) {
    // Without a team there is no typeface, and guessing one prints the wrong shirt.
    return { eligible: false, reason: 'team unknown, so the typeface cannot be resolved' }
  }
  return { eligible: true }
}

/**
 * Typeface per league.
 *
 * One per league, no customer choice (spec §2): choice here multiplies print-file cases
 * without raising willingness to pay. The names are the real league fonts; whether we may
 * *use* them is part of the licensing question in research.md §13.9 and is not settled.
 */
const LEAGUE_TYPEFACE: Record<string, string> = {
  NFL: 'nfl-block',
  NBA: 'nba-block',
  MLB: 'mlb-varsity',
  NHL: 'nhl-block',
  NCAA: 'ncaa-block',
  SOCCER: 'soccer-sans',
  CLUB: 'soccer-sans',
}
export const typefaceFor = (league?: string | null) =>
  LEAGUE_TYPEFACE[(league ?? '').toUpperCase()] ?? 'soccer-sans'

/** Fold accents and normalise to the printable form. */
export function normaliseName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks: Mbappé -> Mbappe
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

export type ValidationError = { field: 'name' | 'number' | 'patch'; message: string }

/**
 * Validate a requested personalisation.
 *
 * Messages are written for the customer, in words, not as a regex — spec §4.5. A field
 * that says "letters, spaces, apostrophes and hyphens only" gets corrected; one that says
 * `/^[A-Z .'-]+$/` gets abandoned.
 */
export function validate(input: {
  name?: string | null
  number?: string | number | null
  patch?: string | null
  availablePatches?: string[]
}): { ok: boolean; errors: ValidationError[]; name?: string; number?: string; patch?: string } {
  // Returned name/number/patch are the values that PASSED. A field with an error comes back
  // undefined so that pricing a partially-valid selection can never charge for a rejected
  // one.
  const errors: ValidationError[] = []
  let name: string | undefined
  let numberOut: string | undefined
  let patch: string | undefined

  if (input.name != null && String(input.name).trim() !== '') {
    // Assigned provisionally and cleared on any failure below. The contract is that the
    // returned fields are the *accepted* ones — otherwise the caller prices a name it was
    // told it cannot have, which is how a blocked name still quoted $14.99.
    name = normaliseName(String(input.name))
    if (name.length > NAME_MAX) {
      errors.push({ field: 'name', message: `Names can be up to ${NAME_MAX} characters.` })
    } else if (!NAME_ALLOWED.test(name)) {
      errors.push({
        field: 'name',
        message: 'Letters, spaces, apostrophes, hyphens and full stops only.',
      })
    } else if (!/[A-Z]/.test(name)) {
      // ' - . passes NAME_ALLOWED on its own and prints as punctuation on a shirt.
      errors.push({ field: 'name', message: 'Names need at least one letter.' })
    } else if (blocked(name)) {
      // Deliberately not "that word is blocked": quoting it back is unpleasant, and
      // naming the rule invites probing for what else gets through.
      errors.push({ field: 'name', message: 'We can’t print that name. Try another.' })
    }
    if (errors.some((e) => e.field === 'name')) name = undefined
  }

  if (input.number != null && String(input.number).trim() !== '') {
    const raw = String(input.number).trim()
    if (!/^\d{1,2}$/.test(raw)) {
      errors.push({ field: 'number', message: 'Numbers are 0 to 99.' })
    } else if (raw.length === 2 && raw[0] === '0') {
      // Spec §1: no leading zero except 0 itself. "07" is a different shirt from "7" and
      // suppliers reliably print one when sent the other.
      errors.push({ field: 'number', message: 'Use 7 rather than 07.' })
    } else {
      const n = Number(raw)
      if (n < NUMBER_MIN || n > NUMBER_MAX) {
        errors.push({ field: 'number', message: `Numbers are ${NUMBER_MIN} to ${NUMBER_MAX}.` })
      } else {
        numberOut = raw
      }
    }
  }

  if (input.patch != null && String(input.patch).trim() !== '') {
    patch = String(input.patch).trim()
    const available = input.availablePatches ?? []
    // Spec §2: a fixed set per league, never a free upload.
    if (!available.includes(patch)) {
      errors.push({ field: 'patch', message: 'That patch isn’t available for this shirt.' })
      patch = undefined
    }
  }

  return { ok: errors.length === 0, errors, name, number: numberOut, patch }
}

/**
 * Does this string look like a word broken up to get past a filter?
 *
 * "N I G G A" and "f.u.c.k" have several one-letter tokens; "Van Der Sar" and "Jr." do not.
 * Two or more single-letter tokens is the signal, which leaves every real surname pattern
 * — initials, particles, suffixes — on the ordinary path.
 */
function looksSeparated(normalised: string): boolean {
  const tokens = normalised.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  return tokens.filter((t) => t.length === 1).length >= 2
}

/** Screen a normalised name against the blocklists. */
export function blocked(normalised: string): boolean {
  const words = normalised.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  const flat = squash(normalised)

  if (words.some((w) => PROFANITY.includes(w))) return true
  if (words.some((w) => BLOCKED_NAMES.includes(w))) return true
  // A blocked name is blocked whether or not it is spaced: "BIN LADEN" and "BINLADEN".
  // Whole-string equality, not containment, so a surname that merely contains one is safe.
  if (BLOCKED_NAMES.includes(flat)) return true
  // Containment on the squashed form only for strings that look deliberately broken up.
  if (looksSeparated(normalised) && SQUASHED_BLOCKED.some((s) => flat.includes(s))) return true
  return false
}

export type PriceLine = { kind: PersonalisationKind; label: string; price: number }

/**
 * Price a selection.
 *
 * The bundle is applied automatically when both a name and a number are chosen — it is
 * never a separate thing to select. Charging $24.98 because the customer did not notice a
 * "bundle" radio button is the kind of detail that produces refund requests, and the
 * bundle is the intended default anyway (spec §1).
 */
export function priceSelection(sel: {
  name?: string | null
  number?: string | null
  patch?: string | null
}, opts: { included?: boolean } = {}): { lines: PriceLine[]; total: number } {
  const lines: PriceLine[] = []
  const hasName = !!sel.name
  const hasNumber = !!sel.number

  /**
   * On a custom jersey the printing is already paid for in the shirt's own price, so every
   * line is zero — but the lines still exist.
   *
   * That distinction is the whole design. A custom shirt with a name still has to produce a
   * `line_personalisation` row, because that row is what the print queue works from, what
   * the blocklist and the human review gate hang off, and what proves in a dispute which
   * preview the customer approved. Modelling "included" as *no personalisation* would send
   * a printed shirt to a supplier with nothing recorded about what to print on it.
   */
  const price = (k: PersonalisationKind) => (opts.included ? 0 : PRICES[k])

  if (hasName && hasNumber) {
    lines.push({ kind: 'bundle', label: `Name & number — ${sel.name} ${sel.number}`, price: price('bundle') })
  } else if (hasName) {
    lines.push({ kind: 'name', label: `Name — ${sel.name}`, price: price('name') })
  } else if (hasNumber) {
    lines.push({ kind: 'number', label: `Number — ${sel.number}`, price: price('number') })
  }
  if (sel.patch) {
    // A patch is a physical extra, not printing, so it is charged even on a custom shirt.
    // The live store does not offer patches at all; this stays consistent with our own
    // spec rather than inventing an inclusion nobody costed.
    lines.push({ kind: 'patch', label: `Patch — ${sel.patch}`, price: PRICES.patch })
  }
  return { lines, total: lines.reduce((t, l) => t + l.price, 0) }
}

/**
 * The cheapest thing a customer can *actually* add, for the collapsed control's "from …".
 *
 * Takes what is offered rather than the whole price table. The first version returned
 * min(PRICES), which is the $7.99 patch — and with no patch list configured the product
 * page advertised "from $7.99" for something the customer could not buy. Advertising a
 * price for an unavailable option is a UCPD problem in the EU (research.md §7.6) and a
 * refund conversation everywhere else.
 *
 * Derived from PRICES rather than written out, so it cannot drift from the table.
 */
export function cheapestAddOn(opts: { patches?: string[] } = {}): number {
  const available: PersonalisationKind[] = ['name', 'number', 'bundle']
  if ((opts.patches?.length ?? 0) > 0) available.push('patch')
  return Math.min(...available.map((k) => PRICES[k]))
}

/**
 * Records to persist, one per priced line.
 *
 * `kind: 'bundle'` is expanded into a name row and a number row, because production needs
 * to know what to print and a "bundle" is not a thing that goes on a shirt. The bundle
 * price is attributed to the name row with the number row at zero, so the rows still sum
 * to what was charged.
 */
export function toRecords(
  sel: { name?: string | null; number?: string | null; patch?: string | null },
  ctx: { league?: string | null; numberOnFront?: boolean; included?: boolean }
): Array<{ kind: 'name' | 'number' | 'patch'; value: string; price: number; typeface: string; placement: Placement }> {
  const typeface = typefaceFor(ctx.league)
  const { lines } = priceSelection(sel, { included: ctx.included })
  const bundled = lines.some((l) => l.kind === 'bundle')
  // Snapshotted at zero on a custom shirt, which is the truthful figure: nothing was
  // charged for the printing. §5's rule is that the row records what was charged, not what
  // the price list says today.
  const rec = (k: PersonalisationKind) => (ctx.included ? 0 : PRICES[k])
  const out: Array<{ kind: 'name' | 'number' | 'patch'; value: string; price: number; typeface: string; placement: Placement }> = []

  if (sel.name) {
    out.push({
      kind: 'name',
      value: sel.name,
      price: bundled ? rec('bundle') : rec('name'),
      typeface,
      placement: 'back',
    })
  }
  if (sel.number) {
    out.push({
      kind: 'number',
      value: sel.number,
      price: bundled ? 0 : rec('number'),
      typeface,
      placement: ctx.numberOnFront ? 'front' : 'back',
    })
  }
  if (sel.patch) {
    out.push({ kind: 'patch', value: sel.patch, price: PRICES.patch, typeface, placement: 'sleeve' })
  }
  return out
}
