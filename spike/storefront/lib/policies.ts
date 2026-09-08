import type { Doc } from './prose'

/**
 * The legal documents.
 *
 * Three constraints shaped this file, and all three come out of research.md §7.
 *
 * **Nothing is invented.** Where a document needs a fact nobody has decided yet — a
 * registered address, an EU representative, an IOSS number — the section carries a
 * `pending` block naming the field, and the page renders "not yet appointed" instead of a
 * plausible-looking value. §13.5 makes the point about product data; it is more true of a
 * privacy policy, where a wrong controller address is a false statement to a regulator.
 *
 * **The commitments match the offer the research actually designed.** §12.4 and §13.6
 * settle on free size exchange as the jersey-category equivalent of a money-back
 * guarantee, chosen deliberately to offset shipping one product image. So that is what the
 * refund policy says — not a generic 30-day-returns template that contradicts the pricing
 * model.
 *
 * **They are marked as drafts, in the page, until a lawyer has read them.** `legal: true`
 * renders a review banner. A refund policy is a contract term; publishing an unreviewed
 * one as settled is the same class of error as a compare-at price you never charged
 * (§7.10).
 */

/**
 * The commercial terms, in one place, so the policy page and the returns API cannot disagree.
 *
 * These are the **live store's published terms**, taken from
 * cruxchristi.com/policies/refund-policy on 2026-08-29 — not the free-exchange model
 * research.md §12.4 recommended. The store that is actually trading operates final sale, and
 * publishing one policy while the checkout promises another is worse than either.
 *
 * `backend/src/returns.ts` holds the same values and a test asserts they match.
 */
export const TERMS = {
  /** 'final-sale' matches the live store. 'free-exchange' is §12.4's recommendation. */
  stance: 'final-sale',
  /** Days from delivery to report a fault. */
  windowDays: 30,
  /** The EU/UK statutory cancellation right. Not ours to set, and not ours to remove. */
  withdrawalDays: 14,
  /** Business days to process an approved refund. */
  refundBusinessDays: 10,
} as const

/**
 * How long each kind of data is kept, published and enforced from the same numbers.
 *
 * The same arrangement as `TERMS` above and for the same reason: this table was a set of
 * sentences on a page and nothing in the application deleted anything, so every row ever
 * written was still there. `backend/src/privacy.ts` is the register the nightly retention
 * job prunes from and the subject-access endpoint walks, and a test asserts these numbers
 * match it.
 *
 * Three rows were added when the register was written, because the published table covered
 * five categories and the database holds eight. A category the policy does not mention is
 * one nobody promised to delete — which is how "we keep it forever" happens without anyone
 * deciding it.
 */
export const RETENTION = [
  { label: 'Orders and invoices', days: 7 * 365,
    note: 'Seven years — tax and customs record-keeping requires it.' },
  { label: 'Account details', days: null,
    note: 'Until you delete the account, then removed within 30 days.' },
  { label: 'Jersey requests', days: 2 * 365,
    note: 'Two years, or until you ask us to delete them.' },
  { label: 'Messages you send us', days: 2 * 365,
    note: 'Two years, so we can pick up a conversation where it left off.' },
  { label: 'Return requests', days: 7 * 365,
    note: 'Kept with the order. The decision stays; your address is removed after seven years.' },
  { label: 'Names printed on shirts', days: 2 * 365,
    note: 'Two years. After that we keep the fact that something was printed, not what.' },
  { label: 'Abandoned baskets', days: 180,
    note: 'Six months, then deleted whether or not you came back.' },
  { label: 'Server logs', days: 90,
    note: '90 days. Email addresses are masked in them.' },
  { label: 'Analytics', days: null,
    note: 'Deleted when consent is withdrawn.' },
] as const

export const POLICIES: Doc[] = [
  {
    slug: 'privacy',
    title: 'Privacy policy',
    summary:
      'What we collect when you buy a jersey, why, how long we keep it, and how to get it deleted.',
    legal: true,
    updated: '2026-08-28',
    sections: [
      {
        title: 'Who is responsible for your data',
        blocks: [
          {
            p: 'We are the controller of the personal data described here. Because we sell to customers in the EU and UK from the United States, both the GDPR and US state privacy laws apply to us, and the contact points below differ by region.',
          },
          {
            pending: [
              'legal_name',
              'address',
              'privacy_email',
              'eu_representative',
            ],
          },
        ],
      },
      {
        title: 'What we collect, and why',
        blocks: [
          {
            rows: [
              [
                'Order details',
                'Name, email, shipping and billing address, what you ordered, and any name or number you asked us to print. Needed to perform the contract — we cannot ship a jersey without them.',
              ],
              [
                'Payment data',
                'Card details are entered directly into Stripe’s hosted fields and are never received or stored by us. We keep the payment reference and the last four digits Stripe returns, so we can match a refund to a charge.',
              ],
              [
                'Jersey requests',
                'If you ask us to source a jersey, we keep your email and the description you gave us, so we can tell you when we find it.',
              ],
              [
                'Analytics',
                'Only if you consent. No analytics or marketing script loads before you accept, and none loads at all if your browser sends a Global Privacy Control signal.',
              ],
              [
                'Server logs',
                'IP address, request path and a request id, kept short-term for security and debugging. This is our legitimate interest in operating the site.',
              ],
            ],
          },
          {
            note:
              'We do not sell personal data, and we do not share it for cross-context behavioural advertising.',
          },
        ],
      },
      {
        title: 'Who we share it with',
        blocks: [
          {
            p: 'Only the processors we need to run the shop, each for one purpose:',
          },
          {
            rows: [
              ['Stripe', 'Payment processing and fraud screening.'],
              ['Resend', 'Sending order confirmations and service email.'],
              ['Shippo and the carrier', 'Producing labels, tracking and customs documents.'],
              ['Our hosting and database provider', 'Running the site and storing orders.'],
              ['PostHog', 'Product analytics — only with your consent.'],
            ],
          },
          {
            p: 'Transfers out of the EEA and UK rely on the Standard Contractual Clauses, or on the EU–US Data Privacy Framework where the recipient is certified.',
          },
        ],
      },
      {
        title: 'How long we keep it',
        blocks: [
          {
            // Rendered from RETENTION, so the page cannot state a period the retention job
            // does not enforce.
            rows: RETENTION.map((r) => [r.label, r.note] as [string, string]),
          },
          {
            p: 'Deleting an account does not delete the order records behind it, because we are required to keep those. It removes everything we are not.',
          },
          {
            p: 'These are enforced by a job that runs every night, not by hand. Where a record has to be kept for tax or for a dispute, we remove the parts that identify you rather than keeping the whole thing.',
          },
        ],
      },
      {
        title: 'Your rights',
        blocks: [
          {
            p: 'Wherever you live, you can ask us for a copy of your data, ask us to correct it, ask us to delete it, or object to how we use it. In the EU and UK you also have the right to data portability and to lodge a complaint with your supervisory authority. In California and the other US states with comparable laws, you have the right to know, delete, correct, and opt out of sale or sharing — and we will not treat you differently for exercising any of them.',
          },
          {
            p: 'We respond within 30 days. We will ask you to confirm the email address on the order rather than requiring an account.',
          },
          { pending: ['privacy_email'] },
        ],
      },
      {
        title: 'Cookies and tracking',
        blocks: [
          {
            p: 'Two cookies are strictly necessary and always set: one holds your basket, one records your consent choice so we do not ask again. Neither is used for advertising.',
          },
          {
            p: 'Everything else is off until you opt in. If your browser or extension sends a Global Privacy Control signal we honour it automatically and do not show a banner at all, because asking again would invite a click that cannot lawfully override the signal.',
          },
        ],
      },
      {
        title: 'Children',
        blocks: [
          {
            p: 'The shop is not directed at children under 13 and we do not knowingly collect their data. If you believe a child has given us personal data, contact us and we will delete it.',
          },
        ],
      },
    ],
  },

  {
    slug: 'terms',
    title: 'Terms of service',
    summary:
      'The agreement between you and us when you order: prices, acceptance, sourcing lead times, personalisation, and what happens when something goes wrong.',
    legal: true,
    updated: '2026-08-28',
    sections: [
      {
        title: 'Who you are contracting with',
        blocks: [{ pending: ['legal_name', 'address', 'support_email'] }],
      },
      {
        title: 'Orders and acceptance',
        blocks: [
          {
            p: 'Placing an order is an offer to buy. The contract forms when we send you an order confirmation email. If we cannot fulfil an order — a listing error, a sourcing failure, a payment we could not verify — we will tell you and refund you in full. We do not part-ship without telling you first.',
          },
          {
            p: 'We may cancel and refund an order where the price shown was clearly wrong. We will not do this after we have already dispatched the item.',
          },
        ],
      },
      {
        title: 'Prices, tax and duties',
        blocks: [
          {
            p: 'Prices are shown in US dollars and exclude tax. Sales tax, VAT and import duties are calculated at checkout based on your delivery address, and the total you approve before paying is the total you are charged.',
          },
          {
            p: 'Any comparison price we display is a price we genuinely charged for that item. We do not use invented compare-at prices, countdown timers that reset, or stock counts we cannot substantiate.',
          },
        ],
      },
      {
        title: 'Sourcing and lead times',
        blocks: [
          {
            p: 'Jerseys are sourced to order rather than held in stock. That is the point of the shop — we can get shirts a stockholding retailer cannot — and it means the honest number to give you is a lead time, not a stock count. The lead time for your region is shown in the basket, at checkout, and on your confirmation.',
          },
          {
            p: 'If a lead time is going to be missed we will email you and you can cancel for a full refund.',
          },
        ],
      },
      {
        title: 'Personalisation',
        blocks: [
          {
            p: 'Where you add a name, number or patch, you confirm you have the right to use it. We reject submissions that are offensive, that impersonate someone, or that we believe infringe a third party’s rights, and we refund the personalisation charge in full when we do.',
          },
          {
            p: 'Personalised items are made to your specification, so they cannot be returned or exchanged unless they are faulty or we printed something other than what you approved. This is stated next to the control before you pay and again on the basket line.',
          },
        ],
      },
      {
        title: 'Your statutory rights',
        blocks: [
          {
            p: 'Nothing here reduces rights you have by law. In the EU and UK that includes the 14-day right of withdrawal on distance sales and the statutory conformity guarantee; our own returns policy is more generous than the minimum and is set out separately.',
          },
        ],
      },
      {
        title: 'Liability',
        blocks: [
          {
            p: 'We are responsible for loss we cause by failing to meet our obligations, but not for loss that was not foreseeable, and not for business losses. We do not exclude liability for death or personal injury caused by our negligence, for fraud, or anything else that cannot lawfully be excluded.',
          },
        ],
      },
      {
        title: 'Governing law',
        blocks: [
          {
            p: 'These terms are governed by the law of the state in which we are registered. If you are a consumer in the EU or UK, you keep the protection of your own country’s mandatory consumer law and may bring proceedings there.',
          },
          { pending: ['legal_name'] },
        ],
      },
    ],
  },

  {
    slug: 'refunds',
    title: 'Refund policy',
    summary:
      'All sales are final. We replace or refund items that arrive faulty, damaged, or wrong.',
    legal: true,
    updated: '2026-08-29',
    sections: [
      {
        title: 'All sales are final',
        blocks: [
          {
            p: 'All sales are final. We do not accept returns, exchanges, or cancellations once an order has been placed.',
          },
          {
            note:
              'Jerseys are sourced to order rather than held in stock — each one is obtained ' +
              'for you after you buy it, which is what makes hard-to-find shirts available ' +
              'at all, and it is why we cannot take them back on a change of mind.',
          },
        ],
      },
      {
        title: 'Exceptions',
        blocks: [
          { p: 'We only offer replacements or refunds if:' },
          {
            ul: [
              'You received the wrong item',
              'Your item arrived damaged or defective',
            ],
          },
          {
            p: 'You must contact us within 30 days of receiving your order to be eligible.',
          },
        ],
      },
      {
        title: 'How to request a replacement or refund',
        blocks: [
          {
            p: 'Start it from the returns page with your order number and the email you used. Include:',
          },
          {
            ul: [
              'Your order number',
              'A description of the issue',
              'Clear photos of the item',
            ],
          },
          { p: 'If your request is approved, we will either send a replacement item, or issue a refund to your original payment method.' },
        ],
      },
      {
        title: 'Important rules',
        blocks: [
          {
            ul: [
              'Do not send items back without contacting us first',
              'Unauthorised returns will not be accepted',
            ],
          },
          { p: 'We do not accept returns for:' },
          {
            ul: [
              'Incorrect size ordered',
              'Change of mind',
              'Sale items',
              'Gift cards',
              'Personalised or custom-printed items, unless faulty or misprinted',
            ],
          },
          {
            note:
              'Size is the most common reason a shirt does not work out, and it is the one ' +
              'we cannot take back. Read the size guide before ordering — and if you send us ' +
              'the chest measurement of a shirt that fits you, we will match it by hand ' +
              'before dispatch rather than guessing.',
            tone: 'warn',
          },
        ],
      },
      {
        title: 'Refund processing time',
        blocks: [
          {
            p: 'If a refund is approved, it will be processed within 10 business days to your original payment method. Please note that it may take additional time for your bank or credit card provider to complete the transaction.',
          },
        ],
      },
      {
        title: 'European Union and United Kingdom customers',
        blocks: [
          {
            p: 'If your order is shipped to the European Union or the United Kingdom, you have the right to cancel or return your order within 14 days in accordance with applicable law. This right exists whatever the rest of this policy says, and we honour it.',
          },
          { p: 'To qualify:' },
          {
            ul: [
              'The item must be unused',
              'In original packaging',
              'With proof of purchase',
            ],
          },
          {
            p: 'Return postage on a cancellation of this kind is yours. The right does not apply to goods made to your specification, which is why personalised and custom-printed shirts are excluded from it.',
          },
          { pending: ['ioss'] },
        ],
      },
      {
        title: 'Contact',
        blocks: [
          { p: 'For any questions or issues, contact us:' },
          { pending: ['support_email', 'phone'] },
        ],
      },
    ],
  },

  {
    slug: 'shipping',
    title: 'Shipping policy',
    summary:
      'Processing times, delivery estimates, tracking, and who is responsible for what.',
    legal: true,
    updated: '2026-08-29',
    sections: [
      {
        title: 'Order processing time',
        blocks: [
          { p: 'All orders are processed within 1–3 business days after being placed.' },
          {
            p: 'You will receive a confirmation email once your order has been successfully placed. A second email with tracking information will be sent once your order has shipped.',
          },
        ],
      },
      {
        title: 'Shipping time',
        blocks: [
          { p: 'Due to high demand and global sourcing, shipping times may vary.' },
          { p: 'Estimated delivery time is 3–14 business days after processing.' },
          { p: 'Please note that delivery times are estimates and are not guaranteed.' },
        ],
      },
      {
        title: 'Delays',
        blocks: [
          {
            p: 'In some cases, shipping may take longer due to factors outside of our control, including but not limited to:',
          },
          {
            ul: [
              'Carrier delays',
              'Customs processing',
              'High order volume',
              'Weather or global logistics disruptions',
            ],
          },
          {
            p: 'If your order is delayed, please allow up to 21 business days for delivery before contacting us.',
          },
        ],
      },
      {
        title: 'Tracking',
        blocks: [
          { p: 'Once your order has shipped, you will receive a tracking number by email.' },
          {
            p: 'Please allow 2–5 business days for tracking information to update after receiving your shipping confirmation.',
          },
        ],
      },
      {
        title: 'Incorrect shipping information',
        blocks: [
          {
            p: 'It is the customer’s responsibility to ensure all shipping information is correct at checkout. We are not responsible for orders shipped to incorrectly entered addresses.',
          },
        ],
      },
      {
        title: 'Lost or stolen packages',
        blocks: [
          {
            p: 'We are not responsible for lost or stolen packages once they have been marked as delivered by the shipping carrier.',
          },
          {
            p: 'If you believe your package has been lost in transit, please contact us and we will assist in filing a claim.',
          },
        ],
      },
      {
        title: 'International shipping',
        blocks: [
          {
            p: 'We ship worldwide. Shipping times may vary depending on the destination.',
          },
          {
            note:
              'Duties and taxes on international orders are calculated and charged at ' +
              'checkout, and are included in the total you approve. Nothing further is ' +
              'collected from you on delivery.',
          },
        ],
      },
      {
        title: 'Contact',
        blocks: [
          { p: 'If you have any questions about your order, please contact us:' },
          { pending: ['support_email', 'phone'] },
        ],
      },
    ],
  },
]

export const policyBySlug = (slug: string) => POLICIES.find((p) => p.slug === slug)
