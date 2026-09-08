/**
 * The returns rule, in one pure function.
 *
 * It lives here — not in the route — because four places have to agree on it, and any
 * disagreement is a customer-facing contradiction:
 *
 *   1. the `/returns` page, deciding which items to offer
 *   2. `POST /store/return-requests`, deciding whether to accept one
 *   3. the admin queue, explaining a case somebody has to action
 *   4. `/policies/refunds`, which is the published contract term
 *
 * ---
 *
 * **This reverses what research.md §12.4 and §13.6 recommended, deliberately.**
 *
 * Those sections argued for a free size exchange as the jersey-category equivalent of a
 * money-back guarantee, chosen to offset shipping one photograph per product. That is what
 * this file implemented until the live store's own published policy was read:
 *
 *   > "All sales are final. We do not accept returns, exchanges, or cancellations once an
 *   > order has been placed. […] We do not accept returns for: Incorrect size ordered,
 *   > Change of mind, Sale items, Gift cards."
 *   >   — cruxchristi.com/policies/refund-policy, retrieved 2026-08-29
 *
 * The store that is actually trading operates final sale. Publishing that policy while the
 * checkout promises free exchanges would be the worst of both: a customer told one thing at
 * the point of sale and another when they try to use it. So the code follows the published
 * policy, and `STANCE` is the single place to change it back.
 *
 * The commercial argument in §12.4 has not gone away — it is now a decision with a number
 * attached rather than an assumption, and the trade-off is written down at `STANCE`.
 */

/**
 * Which policy is in force.
 *
 * `final-sale`    — the live store's published policy. Faults only, plus the EU/UK
 *                   statutory withdrawal right, which no policy can remove.
 * `free-exchange` — research.md §12.4: free size exchange, we pay postage both ways.
 *
 * Changing this one value changes the API, the admin queue, the emails and the published
 * page together. It must never be edited without editing `storefront/lib/policies.ts` to
 * match; a test asserts the two agree.
 */
export const STANCE: 'final-sale' | 'free-exchange' = 'final-sale'

/** Days from delivery to report a fault. The live policy says 30. */
export const RETURN_WINDOW_DAYS = 30

/**
 * The EU/UK right of withdrawal, in days.
 *
 * Statutory, and therefore **not** subject to `STANCE`. A trader cannot contract out of it,
 * and the live store's own policy honours it explicitly:
 *
 *   > "If your order is shipped to the European Union, you have the right to cancel or
 *   > return your order within 14 days in accordance with applicable law."
 *
 * It does not apply to goods made to the customer's specification, which is why a
 * personalised or custom-printed shirt is excluded from it as well.
 */
export const WITHDRAWAL_WINDOW_DAYS = 14

/** Destinations where the statutory withdrawal right applies. */
const WITHDRAWAL_COUNTRIES = new Set([
  'gb', 'ie', 'de', 'fr', 'es', 'it', 'nl', 'be', 'dk', 'se', 'fi', 'at', 'pt', 'pl',
  'cz', 'gr', 'hu', 'ro', 'sk', 'si', 'hr', 'bg', 'ee', 'lv', 'lt', 'lu', 'mt', 'cy',
])

export const KINDS = ['fault', 'wrong_item', 'withdrawal'] as const
export type Kind = (typeof KINDS)[number]

export const KIND_LABELS: Record<Kind, string> = {
  fault: 'It arrived faulty or damaged',
  wrong_item: 'I received the wrong item',
  withdrawal: 'I am cancelling under my statutory right',
}

/**
 * Reasons, and which of them the policy actually accepts.
 *
 * `accepted: false` entries are kept rather than removed. A customer whose shirt does not
 * fit needs to be told that, and why, by a form that recognises the reason — not by an
 * option that silently is not there. The refusal is also where the size guide gets its
 * best placement.
 */
export const REASONS = [
  { key: 'faulty', label: 'Faulty or damaged', accepted: true },
  { key: 'wrong_item', label: 'Wrong item sent', accepted: true },
  { key: 'not_as_described', label: 'Not as described', accepted: true },
  { key: 'too_small', label: 'Too small', accepted: false },
  { key: 'too_large', label: 'Too large', accepted: false },
  { key: 'changed_mind', label: 'Changed my mind', accepted: false },
  { key: 'arrived_late', label: 'Arrived too late', accepted: false },
  { key: 'other', label: 'Something else', accepted: false },
] as const

export type ReasonKey = (typeof REASONS)[number]['key']

const DAY_MS = 24 * 60 * 60 * 1000

export type EligibilityInput = {
  placedAt: string | Date
  /** Null when the parcel has not been marked delivered yet. */
  deliveredAt: string | Date | null
  personalised: boolean
  alreadyOpen: boolean
  /** ISO-2, lower case. Decides whether the statutory withdrawal right applies. */
  countryCode?: string | null
  now?: number
}

export type Verdict =
  | { eligible: true; reason: null; withdrawal: boolean }
  | { eligible: false; reason: string; withdrawal: false }

/** Does the statutory right of withdrawal apply to this destination? */
export const hasWithdrawalRight = (countryCode?: string | null) =>
  WITHDRAWAL_COUNTRIES.has(String(countryCode ?? '').toLowerCase())

/**
 * Can this line be returned at all, and on what basis?
 *
 * The window runs from **delivery**, and from the order date only as a fallback. That
 * distinction matters here: jerseys are sourced to order and can take 16 business days to
 * reach Europe, so a window counted from purchase could expire before the customer has the
 * shirt. Falling back to the order date when delivery is unknown can only ever be more
 * generous, since an undelivered parcel has an earlier reference date.
 */
export function eligibility(input: EligibilityInput): Verdict {
  const now = input.now ?? Date.now()
  const withdrawal = hasWithdrawalRight(input.countryCode)

  if (input.personalised) {
    return {
      eligible: false,
      withdrawal: false,
      reason:
        'Personalised and custom-printed items are made to your specification, so they ' +
        'cannot be returned unless they are faulty or we printed something other than what ' +
        'you approved. That exclusion applies to the statutory withdrawal right too. ' +
        'Contact us and we will put a fault right.',
    }
  }

  if (input.alreadyOpen) {
    return {
      eligible: false,
      withdrawal: false,
      reason: 'There is already an open return for this item. We will email you about it.',
    }
  }

  const reference = input.deliveredAt ? new Date(input.deliveredAt) : new Date(input.placedAt)
  if (Number.isNaN(reference.getTime())) {
    // An unparseable date must not silently deny a valid claim. Let it through; a human in
    // the queue can see the order.
    return { eligible: true, reason: null, withdrawal }
  }

  const days = Math.floor((now - reference.getTime()) / DAY_MS)

  // The statutory window is shorter than the fault window, so a EU customer past 14 days
  // still has the fault route. Both are checked; the longer one decides eligibility.
  if (days > RETURN_WINDOW_DAYS) {
    return {
      eligible: false,
      withdrawal: false,
      reason:
        `This item was ${input.deliveredAt ? 'delivered' : 'ordered'} ${days} days ago, ` +
        `outside our ${RETURN_WINDOW_DAYS}-day window. Email us anyway — if it is a fault ` +
        'we will still put it right.',
    }
  }

  return {
    eligible: true,
    reason: null,
    withdrawal: withdrawal && days <= WITHDRAWAL_WINDOW_DAYS,
  }
}

/**
 * Is this reason something the policy accepts, for this destination?
 *
 * Under `final-sale` the answer is faults only — **except** where the statutory withdrawal
 * right applies, which no published policy can remove. That is why this takes the
 * destination and not just the reason: the same "changed my mind" is refused from Texas and
 * accepted from Germany, and both are correct.
 */
export function reasonAccepted(
  reason: string,
  opts: { withdrawal?: boolean } = {}
): { accepted: boolean; message?: string } {
  if (STANCE === 'free-exchange') return { accepted: true }

  const row = REASONS.find((r) => r.key === reason)
  if (row?.accepted) return { accepted: true }

  if (opts.withdrawal) {
    // Inside the statutory window, a change of mind is a right rather than a request.
    return { accepted: true }
  }

  if (reason === 'too_small' || reason === 'too_large') {
    return {
      accepted: false,
      message:
        'We are not able to accept returns for a size that does not fit — all sales are ' +
        'final except for faults. Check the size guide before ordering, and if you tell us ' +
        'the chest measurement of a shirt that fits you we will match it by hand before ' +
        'dispatch.',
    }
  }

  return {
    accepted: false,
    message:
      'All sales are final. We only accept returns where the item arrived faulty or ' +
      'damaged, or where we sent the wrong item. If that is what happened, choose one of ' +
      'those reasons and include a photo.',
  }
}

/**
 * Who pays the return postage.
 *
 * Ours on anything that is our error. On a statutory withdrawal the customer pays their own
 * return postage, which the Consumer Rights Directive permits provided they were told before
 * ordering — which is what the refund policy page does.
 */
export const postagePaidBy = (kind: Kind): 'us' | 'customer' =>
  kind === 'withdrawal' ? 'customer' : 'us'

/** Refund processing commitment, published on the policy page. Live store says 10. */
export const REFUND_BUSINESS_DAYS = 10
