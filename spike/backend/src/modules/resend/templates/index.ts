/**
 * Email templates.
 *
 * Plain functions returning { subject, html, text } — no template engine, no framework.
 * Every one ships a text part: transactional email without one lands in spam more often,
 * and research.md §8 lists deliverability as an operational cost the platform used to
 * absorb.
 *
 * Nothing here asserts anything the data cannot support (§7.10) — no delivery dates we
 * have not committed to, no "officially licensed", no fabric claims.
 */
/**
 * `headers` exists for one message: the cart-recovery email is the only commercial one this
 * shop sends, and a commercial email needs `List-Unsubscribe` — both because RFC 8058
 * one-click is what Gmail and Yahoo now require of bulk senders, and because "a simple means
 * of refusing, in every message" is the condition PECR's soft opt-in rests on.
 *
 * Returned by the template rather than set at the call site, so the message that needs the
 * header is the thing that declares it and the two cannot drift apart.
 */
export type Rendered = {
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
}

/**
 * The shop's own name, for the email chrome.
 *
 * Same variable the storefront reads as `NEXT_PUBLIC_SITE_NAME` and the reviews endpoint
 * reads as the review source — an email that signs itself with a different name from the
 * site it links to is the kind of detail that reads as a phishing attempt.
 */
const SHOP_NAME = process.env.SHOP_NAME || 'Find Any Jersey'

const money = (cents: number, currency = 'USD') =>
  `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const shell = (heading: string, body: string) => `
<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#121212">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f5;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e4e4e1">
        <tr><td style="background:#121212;padding:18px 24px">
          <span style="font-family:'Arial Narrow',Impact,sans-serif;font-size:20px;letter-spacing:.02em;text-transform:uppercase;color:#fff">
            Find <span style="background:#F9E806;color:#121212;padding:0 4px">Any</span> Jersey
          </span>
        </td></tr>
        <tr><td style="padding:24px">
          <h1 style="margin:0 0 12px;font-family:'Arial Narrow',Impact,sans-serif;font-size:22px;text-transform:uppercase;letter-spacing:.01em">${heading}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #e4e4e1;font-size:12px;color:#6a6a6a">
          You are receiving this because you placed an order or made a request.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

export type OrderData = {
  display_id: number | string
  email: string
  currency_code?: string
  items: { title: string; variant_title?: string | null; quantity: number; subtotal: number }[]
  subtotal: number
  shipping_total: number
  tax_total: number
  total: number
  lead_time?: string | null
}

export function orderPlaced(d: OrderData): Rendered {
  const cur = d.currency_code ?? 'USD'
  const rows = d.items.map((i) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #f0f0ee">${i.quantity}&times; ${
      i.variant_title ? `${i.variant_title} — ` : ''}${i.title}</td>
     <td align="right" style="padding:6px 0;border-bottom:1px solid #f0f0ee;white-space:nowrap">${
      money(i.subtotal, cur)}</td></tr>`).join('')

  const totals = [
    ['Subtotal', d.subtotal],
    ['Shipping', d.shipping_total],
    ['Tax', d.tax_total],
  ].map(([label, v]) =>
    `<tr><td style="padding:4px 0;color:#4a4a4a">${label}</td>
     <td align="right" style="padding:4px 0">${money(Number(v), cur)}</td></tr>`).join('')

  return {
    subject: `Order #${d.display_id} confirmed`,
    html: shell(`Order #${d.display_id} confirmed`, `
      <p style="margin:0 0 16px;font-size:14px">Thanks — we have your order and we are on it.</p>
      <table role="presentation" width="100%" style="font-size:14px;border-collapse:collapse">
        ${rows}${totals}
        <tr><td style="padding:8px 0;border-top:2px solid #121212;font-weight:700">Total</td>
            <td align="right" style="padding:8px 0;border-top:2px solid #121212;font-weight:700">${money(d.total, cur)}</td></tr>
      </table>
      ${d.lead_time ? `<p style="margin:16px 0 0;font-size:13px;color:#4a4a4a">${d.lead_time}</p>` : ''}
    `),
    text: [
      `Order #${d.display_id} confirmed`,
      '',
      ...d.items.map((i) => `${i.quantity}x ${i.variant_title ?? ''} ${i.title} — ${money(i.subtotal, cur)}`),
      '',
      `Subtotal ${money(d.subtotal, cur)}`,
      `Shipping ${money(d.shipping_total, cur)}`,
      `Tax      ${money(d.tax_total, cur)}`,
      `Total    ${money(d.total, cur)}`,
      ...(d.lead_time ? ['', d.lead_time] : []),
    ].join('\n'),
  }
}

export type RequestData = {
  raw_request: string
  team?: string | null
  player?: string | null
  size_code?: string | null
}

export function requestReceived(d: RequestData): Rendered {
  const parsed = [d.player, d.team].filter(Boolean).join(' · ')
  return {
    subject: 'We got your jersey request',
    html: shell('Request received', `
      <p style="margin:0 0 12px;font-size:14px">We are looking for:</p>
      <p style="margin:0 0 16px;padding:12px;background:#f7f7f5;border-left:3px solid #F9E806;font-size:14px">
        ${d.raw_request}${parsed ? `<br><span style="color:#6a6a6a;font-size:13px">${parsed}</span>` : ''}
      </p>
      <p style="margin:0;font-size:14px">We will email you once we have found it and confirmed the details.
      No charge until then.</p>
    `),
    text: `Request received\n\n${d.raw_request}${parsed ? `\n(${parsed})` : ''}\n\n` +
          'We will email you once we have found it and confirmed the details. No charge until then.',
  }
}

/**
 * "We found it" — the one email whose whole job is to turn a sourcing request into a sale.
 *
 * Three things it has to do, in this order:
 *
 *  1. **Quote what they asked for.** Twelve people ask for the same shirt in twelve different
 *     ways, and a bulk send is only reassuring if it repeats the sentence *they* typed rather
 *     than a description of the product.
 *  2. **Name what we found**, when we know it, so the two can be compared. A sourcing request
 *     is fuzzy by nature and the customer is the one who decides whether this is the shirt.
 *  3. **Go somewhere buyable.** The button has always been in this template and nothing ever
 *     passed a `url`, so every one of these arrived with no way to act on it.
 *
 * No urgency, no invented scarcity, no countdown — same rule as the cart-recovery email.
 * "We found the thing you asked for" is the strongest honest line available, and it does not
 * need help.
 */
export function requestSourced(
  d: RequestData & { url?: string; product_title?: string }
): Rendered {
  const size = d.size_code ? `You asked about size ${d.size_code}.` : ''
  const found = d.product_title
    ? `<p style="margin:0 0 16px;font-size:14px">We found: <strong>${d.product_title}</strong>${
        size ? ` ${size}` : ''}</p>`
    : size ? `<p style="margin:0 0 16px;font-size:14px">${size}</p>` : ''

  return {
    subject: d.product_title ? `We found it — ${d.product_title}` : 'We found your jersey',
    html: shell('We found it', `
      <p style="margin:0 0 12px;font-size:14px">Good news — we sourced the jersey you asked for:</p>
      <p style="margin:0 0 16px;padding:12px;background:#f7f7f5;border-left:3px solid #F9E806;font-size:14px">${d.raw_request}</p>
      ${found}
      ${d.url ? `<p style="margin:0 0 16px"><a href="${d.url}" style="display:inline-block;background:#F9E806;color:#121212;padding:12px 20px;text-decoration:none;font-weight:700;text-transform:uppercase;font-size:14px">Buy it now</a></p>
      <p style="margin:0;font-size:13px;color:#6a6a6a">Or paste this into your browser: ${d.url}</p>` : ''}
    `),
    text: [
      'We found it',
      '',
      d.raw_request,
      d.product_title ? `\nWe found: ${d.product_title}` : '',
      size ? `\n${size}` : '',
      d.url ? `\nBuy it now: ${d.url}` : '',
    ].filter(Boolean).join('\n'),
  }
}

export type CartRecoveryData = {
  cart_id: string
  currency_code?: string
  items: { title: string; variant_title?: string | null; quantity: number; subtotal: number }[]
  value: number
  url?: string
  /** Where clicking unsubscribe goes. Required — see the note on the template. */
  unsubscribe_url?: string
  /** The trader's registered postal address. Required — see the note on the template. */
  postal_address?: string
}

export function cartRecovery(d: CartRecoveryData): Rendered {
  const cur = d.currency_code ?? 'USD'
  const rows = d.items.map((i) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #f0f0ee">${i.quantity}&times; ${
      i.variant_title ? `${i.variant_title} — ` : ''}${i.title}</td>
     <td align="right" style="padding:6px 0;border-bottom:1px solid #f0f0ee;white-space:nowrap">${
      money(i.subtotal, cur)}</td></tr>`).join('')

  /**
   * The only commercial email this shop sends, and the only one with obligations attached.
   *
   * Everything else here is transactional — a receipt, an acknowledgement, a reset — and needs
   * neither consent nor an opt-out. This one exists to make a sale to somebody who did not buy,
   * which changes the rules completely:
   *
   *  - **An unsubscribe link in every message.** PECR's soft opt-in — the basis for mailing
   *    somebody who gave their address during a checkout — is conditional on offering a simple
   *    means of refusing, each time. Without the link there is no basis, so the sending route
   *    refuses to send when it cannot build one.
   *  - **A physical postal address.** CAN-SPAM requires one on commercial email. The route
   *    refuses without it too, for the same reason this codebase renders "not yet appointed"
   *    rather than inventing a company address: a missing regulatory value is not a formatting
   *    problem.
   *  - **`List-Unsubscribe`**, one-click per RFC 8058. Gmail and Yahoo require it of bulk
   *    senders, and a header the recipient's client can act on is a better opt-out than a link
   *    they have to find.
   *
   * And still no fake urgency: no countdown, no invented stock scarcity, no discount nobody
   * decided to give. Blacklisted outright in the EU and actionable in the US
   * (research.md §7.10, §12.7).
   */
  return {
    subject: 'Your bag is still here',
    ...(d.unsubscribe_url ? {
      headers: {
        'List-Unsubscribe': `<${d.unsubscribe_url}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    } : {}),
    html: shell('Still in your bag', `
      <p style="margin:0 0 16px;font-size:14px">You left these behind. They are still available.</p>
      <table role="presentation" width="100%" style="font-size:14px;border-collapse:collapse">
        ${rows}
        <tr><td style="padding:8px 0;border-top:2px solid #121212;font-weight:700">Total</td>
            <td align="right" style="padding:8px 0;border-top:2px solid #121212;font-weight:700">${
              money(d.value, cur)}</td></tr>
      </table>
      ${d.url ? `<p style="margin:20px 0 0"><a href="${d.url}" style="display:inline-block;background:#F9E806;color:#121212;padding:12px 20px;text-decoration:none;font-weight:700;text-transform:uppercase;font-size:14px">Finish your order</a></p>` : ''}
      <p style="margin:20px 0 0;font-size:13px;color:#6a6a6a">
        Not what you were after? Reply to this email and tell us what you are looking for —
        we will source it.
      </p>
      <p style="margin:18px 0 0;padding-top:14px;border-top:1px solid #e4e4e1;font-size:12px;color:#6a6a6a">
        ${d.postal_address ?? ''}<br>
        ${d.unsubscribe_url
          ? `<a href="${d.unsubscribe_url}" style="color:#6a6a6a">Unsubscribe from emails like this</a> — you will still get receipts and replies.`
          : ''}
      </p>
    `),
    text: [
      'Still in your bag',
      '',
      ...d.items.map((i) => `${i.quantity}x ${i.variant_title ?? ''} ${i.title} — ${money(i.subtotal, cur)}`),
      '',
      `Total ${money(d.value, cur)}`,
      ...(d.url ? ['', d.url] : []),
      // The plain-text part carries the same obligations. A client that renders text only is
      // not a client that gets to receive a commercial email without an opt-out.
      ...(d.postal_address ? ['', d.postal_address] : []),
      ...(d.unsubscribe_url
        ? ['', `Unsubscribe from emails like this: ${d.unsubscribe_url}`]
        : []),
    ].join('\n'),
  }
}

/* ------------------------------------------------------------------ returns */

export type ReturnData = {
  order_number: string | number | null
  item_title?: string | null
  kind: 'exchange' | 'refund' | 'fault' | string
  requested_size?: string | null
  we_pay_postage?: boolean
  note?: string | null
}

/**
 * The order reference, or a neutral phrase.
 *
 * Never interpolate a possibly-absent id straight into copy: "your return for order
 * #undefined" is a support ticket, and the registry test that caught it is checking for
 * exactly this across every template rather than per template.
 */
const orderRef = (n: string | number | null | undefined) =>
  n === null || n === undefined || n === '' ? 'your order' : `order #${n}`

const kindPhrase = (d: ReturnData) =>
  d.kind === 'exchange'
    ? `an exchange${d.requested_size ? ` for size ${d.requested_size}` : ''}`
    : d.kind === 'fault'
      ? 'a fault to be put right'
      : 'a refund'

/**
 * The postage line.
 *
 * Stated in every returns email and derived from the stored decision rather than
 * recomputed, so the promise in the email is the promise in the row. §12.4 makes free size
 * exchange the shop's guarantee; an email that goes quiet about who pays is where that
 * guarantee stops being worth anything.
 */
const postageLine = (d: ReturnData) =>
  d.we_pay_postage
    ? 'We pay the return postage — the label is on us.'
    : 'Return postage is yours on a change of mind. Any tracked service is fine.'

export function returnReceived(d: ReturnData): Rendered {
  const what = kindPhrase(d)
  return {
    subject: `We got your return request for ${orderRef(d.order_number)}`,
    html: shell('Return request received', `
      <p style="margin:0 0 12px;font-size:14px">You asked for ${what} on:</p>
      <p style="margin:0 0 16px;padding:12px;background:#f7f7f5;border-left:3px solid #F9E806;font-size:14px">
        ${d.item_title ?? 'your order'}<br>
        <span style="color:#6a6a6a;font-size:13px">${capitalise(orderRef(d.order_number))}</span>
      </p>
      <p style="margin:0 0 12px;font-size:14px">${postageLine(d)}</p>
      <p style="margin:0;font-size:14px">A human reads every one of these. We will email you
      with the next step &mdash; please do not post anything back until we do, so it does not
      arrive without a reference.</p>
    `),
    text: [
      'Return request received',
      '',
      `You asked for ${what} on: ${d.item_title ?? 'your order'}`,
      capitalise(orderRef(d.order_number)),
      '',
      postageLine(d),
      '',
      'A human reads every one of these. We will email you with the next step — please do',
      'not post anything back until we do, so it does not arrive without a reference.',
    ].join('\n'),
  }
}

export function returnApproved(d: ReturnData): Rendered {
  const what = kindPhrase(d)
  return {
    subject: `Your return for ${orderRef(d.order_number)} is approved`,
    html: shell('Send it back', `
      <p style="margin:0 0 12px;font-size:14px">Approved &mdash; ${what} on
      ${d.item_title ?? 'your order'}.</p>
      <p style="margin:0 0 12px;font-size:14px">${postageLine(d)}</p>
      <p style="margin:0 0 12px;font-size:14px">Pack it unworn with the tags on, include
      <strong>${capitalise(orderRef(d.order_number))}</strong> in the parcel, and send it to
      the address on the label we will email you next.</p>
      ${d.note ? `<p style="margin:0;padding:12px;background:#f7f7f5;font-size:13px;color:#4a4a4a">${d.note}</p>` : ''}
    `),
    text: [
      'Send it back',
      '',
      `Approved — ${what} on ${d.item_title ?? 'your order'}.`,
      postageLine(d),
      '',
      `Pack it unworn with the tags on, include ${orderRef(d.order_number)} in the parcel,`,
      'and send it to the address on the label we will email you next.',
      ...(d.note ? ['', d.note] : []),
    ].join('\n'),
  }
}

/**
 * A refusal always carries its reason.
 *
 * The admin endpoint refuses to record a decline without a note for this reason: an email
 * saying only "declined" leaves the customer with nowhere to go and support with nothing to
 * say. The statutory-rights line stays in whatever the reason was — declining a policy
 * return does not remove a legal one.
 */
export function returnDeclined(d: ReturnData): Rendered {
  return {
    subject: `About your return request for ${orderRef(d.order_number)}`,
    html: shell('We cannot take this one back', `
      <p style="margin:0 0 12px;font-size:14px">We are not able to accept the return of
      ${d.item_title ?? 'this item'} on ${orderRef(d.order_number)}.</p>
      ${d.note ? `<p style="margin:0 0 16px;padding:12px;background:#f7f7f5;border-left:3px solid #121212;font-size:14px">${d.note}</p>` : ''}
      <p style="margin:0;font-size:14px">This does not affect any rights you have by law. If
      you think we have this wrong, reply to this email and a person will look at it again.</p>
    `),
    text: [
      'We cannot take this one back',
      '',
      `We are not able to accept the return of ${d.item_title ?? 'this item'} on ${orderRef(d.order_number)}.`,
      ...(d.note ? ['', d.note] : []),
      '',
      'This does not affect any rights you have by law. If you think we have this wrong,',
      'reply to this email and a person will look at it again.',
    ].join('\n'),
  }
}

/* ------------------------------------------------------- password reset */

export type PasswordResetData = { url: string; email?: string; expires_in?: string }

/**
 * The one email whose link is a credential.
 *
 * So it says the two things a reset email has to say and nothing else: how long the link
 * lasts, and what to do if it was not you. No marketing, no product rows, and no account
 * detail beyond the address it was sent to — a reset email is the most-forwarded message a
 * shop sends, usually to somebody's own inbox on a shared machine.
 */
export function passwordReset(d: PasswordResetData): Rendered {
  const expiry = d.expires_in ?? '15 minutes'
  // A reset email whose link failed to build must not ship a dead button. `href="undefined"`
  // reads as a working button, gets clicked, and produces a support ticket that looks like a
  // broken account rather than a broken email.
  const link = typeof d.url === 'string' && /^https?:\/\//.test(d.url) ? d.url : null
  return {
    subject: 'Reset your password',
    html: shell('Reset your password', `
      ${link
        ? `<p style="margin:0 0 16px;font-size:14px">Use the button below to set a new
             password. The link works once and expires in ${expiry}.</p>
           <p style="margin:0 0 20px"><a href="${link}" style="display:inline-block;background:#F9E806;color:#121212;padding:12px 20px;text-decoration:none;font-weight:700;text-transform:uppercase;font-size:14px">Set a new password</a></p>`
        : `<p style="margin:0 0 16px;font-size:14px">We could not build your reset link.
             Please request a new one from the sign-in page &mdash; nothing has changed on
             your account.</p>`}
      <p style="margin:0;font-size:13px;color:#6a6a6a">If you did not ask for this, ignore it
      &mdash; nothing has changed and your password still works.</p>
    `),
    text: [
      'Reset your password',
      '',
      ...(link
        ? [`Use this link to set a new password. It works once and expires in ${expiry}.`, '', link]
        : ['We could not build your reset link. Please request a new one from the sign-in page',
           '— nothing has changed on your account.']),
      '',
      'If you did not ask for this, ignore it — nothing has changed and your password still works.',
    ].join('\n'),
  }
}


/* ------------------------------------------------------------------ contact */

export type ContactData = { name?: string | null; body?: string | null }

/**
 * The acknowledgement for a contact form.
 *
 * Quotes the message back, because the single most common follow-up to "we got your message"
 * is "which message?" — and because it is the only copy the sender has if they typed it into
 * a form rather than an email client.
 *
 * Promises no response time. We have not committed to one, and §7.10 applies to a service
 * claim exactly as it does to a product claim.
 */
export function contactReceived(d: ContactData): Rendered {
  const body = (d.body ?? '').trim()
  return {
    subject: 'We got your message',
    html: shell('Message received', `
      <p style="margin:0 0 12px;font-size:14px">Thanks${d.name ? `, ${d.name}` : ''} — a
      person reads every one of these and will reply to this address.</p>
      ${body ? `<p style="margin:0 0 16px;padding:12px;background:#f7f7f5;border-left:3px solid #F9E806;font-size:14px">${body}</p>` : ''}
      <p style="margin:0;font-size:14px">If it is about an existing order, replying with your
      order number will get you an answer faster.</p>
    `),
    text: [
      'Message received',
      '',
      `Thanks${d.name ? `, ${d.name}` : ''} — a person reads every one of these and will`,
      'reply to this address.',
      ...(body ? ['', body] : []),
      '',
      'If it is about an existing order, replying with your order number will get you an',
      'answer faster.',
    ].join('\n'),
  }
}

/**
 * The operator side.
 *
 * A different job from every template above, and written differently for it. A customer email
 * reassures; these exist to make somebody act, so they lead with what happened and what it is
 * worth, carry a link straight into the admin screen that owns it, and say nothing warm.
 *
 * They deliberately quote only as much customer data as the decision needs. A return
 * notification names the order and the reason, not the customer's address — whoever opens the
 * queue will see the rest, and an inbox is a worse place to keep it than the database is.
 */
export type OpsData = {
  /** What happened, in the subject line. */
  headline: string
  /** Label/value pairs, rendered as a table. */
  rows: [string, string][]
  /** Where to go and do something about it. */
  url?: string
  cta?: string
  /** The customer's words, when the point of the message is what they said. */
  quote?: string | null
}

const opsShell = (title: string, body: string) => `
<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#121212">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f5;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e4e4e1">
        <tr><td style="background:#121212;padding:12px 20px">
          <span style="font-family:'Arial Narrow',Impact,sans-serif;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#F9E806">${SHOP_NAME} — admin</span>
        </td></tr>
        <tr><td style="padding:20px">
          <h1 style="margin:0 0 14px;font-family:'Arial Narrow',Impact,sans-serif;font-size:19px;text-transform:uppercase">${title}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:12px 20px;border-top:1px solid #e4e4e1;font-size:11px;color:#6a6a6a">
          You receive this because your address is on the notification list in the admin.
          Remove it there to stop.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

export function opsNotification(d: OpsData): Rendered {
  const rows = d.rows
    .map(([k, v]) =>
      `<tr><td style="padding:5px 0;color:#6a6a6a;font-size:13px;white-space:nowrap">${k}</td>` +
      `<td style="padding:5px 0 5px 16px;font-size:13px">${v}</td></tr>`)
    .join('')

  return {
    subject: d.headline,
    html: opsShell(d.headline, `
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 14px">${rows}</table>
      ${d.quote ? `<p style="margin:0 0 14px;padding:10px 12px;background:#f7f7f5;border-left:3px solid #F9E806;font-size:13px">${d.quote}</p>` : ''}
      ${d.url ? `<p style="margin:0"><a href="${d.url}" style="display:inline-block;background:#121212;color:#fff;padding:10px 16px;text-decoration:none;font-size:13px">${d.cta ?? 'Open in admin'}</a></p>` : ''}
    `),
    text: [
      d.headline,
      '',
      ...d.rows.map(([k, v]) => `${k}: ${v}`),
      ...(d.quote ? ['', d.quote] : []),
      ...(d.url ? ['', `${d.cta ?? 'Open in admin'}: ${d.url}`] : []),
    ].join('\n'),
  }
}

/**
 * "Confirm this order is yours."
 *
 * Sent to the address **on the order**, never to the account asking for it — which is the
 * entire security model. Somebody who knows an order number and guesses an email cannot pull
 * a stranger's order into their account, because the confirmation lands in the stranger's
 * inbox rather than theirs.
 *
 * That is also why the link is the only thing in the message that does anything, and why the
 * text names the account requesting it: a person who did not ask for this needs to be able to
 * tell, from the email alone, that somebody else is trying.
 */
export type OrderClaimData = {
  order_number: number | string
  requested_by: string
  url?: string
  token?: string
}

export function orderClaim(d: OrderClaimData): Rendered {
  const ref = orderRef(d.order_number)
  return {
    subject: `Confirm you want ${ref} added to an account`,
    html: shell('Is this you?', `
      <p style="margin:0 0 16px;font-size:14px">
        Somebody signed in as <strong>${d.requested_by}</strong> asked for order ${ref} to be
        added to their account.
      </p>
      ${d.url ? `<p style="margin:0 0 16px"><a href="${d.url}" style="display:inline-block;background:#F9E806;color:#121212;padding:12px 20px;text-decoration:none;font-weight:700;text-transform:uppercase;font-size:14px">Yes, that is me</a></p>` : ''}
      <p style="margin:0;font-size:13px;color:#6a6a6a">
        If it was not you, ignore this email and nothing happens. The order stays where it is
        and nobody gains access to it.
      </p>
    `),
    text: [
      `Somebody signed in as ${d.requested_by} asked for order ${ref} to be added to their account.`,
      ...(d.url ? ['', `Confirm: ${d.url}`] : []),
      '',
      'If it was not you, ignore this email. Nothing happens.',
    ].join('\n'),
  }
}

export const TEMPLATES = {
  'ops-notification': opsNotification,
  'order-claim': orderClaim,
  'order-placed': orderPlaced,
  'request-received': requestReceived,
  'request-sourced': requestSourced,
  'cart-recovery': cartRecovery,
  'return-received': returnReceived,
  'return-approved': returnApproved,
  'return-declined': returnDeclined,
  'password-reset': passwordReset,
  'contact-received': contactReceived,
} as const

export type TemplateKey = keyof typeof TEMPLATES
