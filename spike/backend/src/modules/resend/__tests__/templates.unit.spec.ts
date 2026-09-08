import {
  orderPlaced, requestReceived, requestSourced, cartRecovery,
  returnReceived, returnApproved, returnDeclined, passwordReset, contactReceived,
  TEMPLATES,
} from '../templates'

/** Visible text only — drops tags and their attributes. */
const stripTags = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

const order = {
  display_id: 1042,
  email: 'fan@example.com',
  currency_code: 'usd',
  items: [
    { title: 'Buffalo Bills Josh Allen Grey Jersey', variant_title: 'L', quantity: 1, subtotal: 6499 },
    { title: 'Dallas Cowboys Blue Shorts', variant_title: 'M', quantity: 2, subtotal: 10000 },
  ],
  subtotal: 16499,
  shipping_total: 499,
  tax_total: 0,
  total: 16998,
  lead_time: 'Tracked, 3–5 business days.',
}

describe('order confirmation template', () => {
  const r = orderPlaced(order)

  it('puts the order number in the subject', () => {
    expect(r.subject).toBe('Order #1042 confirmed')
  })

  it('always ships a text part', () => {
    // Transactional email without a text part lands in spam more often.
    expect(r.text.length).toBeGreaterThan(50)
    expect(r.text).not.toContain('<')
  })

  it('formats money from integer cents, never floats', () => {
    expect(r.html).toContain('64.99 USD')
    expect(r.html).toContain('169.98 USD')
    expect(r.text).toContain('Total    169.98 USD')
  })

  it('lists every line item in both parts', () => {
    for (const part of [r.html, r.text]) {
      expect(part).toContain('Buffalo Bills Josh Allen Grey Jersey')
      expect(part).toContain('Dallas Cowboys Blue Shorts')
    }
  })

  it('shows quantities', () => {
    expect(r.text).toContain('2x')
    expect(r.html).toContain('2&times;')
  })

  it('includes the lead time when one is known', () => {
    expect(r.html).toContain('Tracked, 3–5 business days.')
  })

  it('omits the lead time rather than inventing one', () => {
    const without = orderPlaced({ ...order, lead_time: null })
    expect(without.html).not.toContain('business days')
    expect(without.text).not.toContain('business days')
  })

  it('never claims a delivery date', () => {
    expect(r.html.toLowerCase()).not.toMatch(/arrives on|delivered on|guaranteed by/)
  })

  it('makes no unverifiable product claims', () => {
    // Check the visible copy, not the markup: width="100%" on a layout table is not a
    // fabric claim, and a test that cannot tell the difference is worse than no test.
    const visible = (stripTags(r.html) + ' ' + r.text).toLowerCase()
    for (const banned of ['officially licensed', 'authentic', 'polyester', 'cotton',
                          '100% ', 'moisture', 'breathable', 'genuine']) {
      expect(visible).not.toContain(banned)
    }
  })

  it('handles a zero-tax order without printing NaN or undefined', () => {
    const body = r.html + r.text
    expect(body).not.toContain('NaN')
    expect(body).not.toContain('undefined')
  })

  it('respects a non-USD currency', () => {
    const eur = orderPlaced({ ...order, currency_code: 'eur' })
    expect(eur.html).toContain('EUR')
    expect(eur.html).not.toContain('USD')
  })

  it('survives an empty item list', () => {
    const empty = orderPlaced({ ...order, items: [] })
    expect(empty.subject).toContain('1042')
    expect(empty.html).not.toContain('undefined')
  })
})

describe('request templates', () => {
  it('echoes the request back verbatim', () => {
    const r = requestReceived({ raw_request: '1998 Vikings Randy Moss purple, XL',
                                team: 'Minnesota Vikings', player: 'Randy Moss' })
    expect(r.html).toContain('1998 Vikings Randy Moss purple, XL')
    expect(r.text).toContain('1998 Vikings Randy Moss purple, XL')
  })

  it('promises no charge before confirmation', () => {
    const r = requestReceived({ raw_request: 'anything' })
    expect(r.text.toLowerCase()).toContain('no charge')
  })

  it('works without parsed fields', () => {
    const r = requestReceived({ raw_request: 'something obscure' })
    expect(r.html).not.toContain('undefined')
    expect(r.html).not.toContain('null')
  })

  it('sourced email includes a link only when there is one', () => {
    const withUrl = requestSourced({ raw_request: 'x', url: 'https://example.com/p/1' })
    expect(withUrl.html).toContain('https://example.com/p/1')
    const without = requestSourced({ raw_request: 'x' })
    expect(without.html).not.toContain('href="undefined"')
    expect(without.html).not.toContain('View it')
  })
})

describe('cart recovery template', () => {
  const cart = {
    cart_id: 'cart_123',
    currency_code: 'usd',
    items: [{ title: 'Buffalo Bills Josh Allen Grey Jersey', variant_title: 'L',
              quantity: 1, subtotal: 6499 }],
    value: 6499,
  }

  it('lists what was left behind', () => {
    const r = cartRecovery(cart)
    expect(r.subject).toBe('Your bag is still here')
    expect(r.html).toContain('Buffalo Bills Josh Allen Grey Jersey')
    expect(r.text).toContain('64.99 USD')
  })

  it('carries no fake urgency', () => {
    // Countdown timers and invented scarcity are blacklisted outright in the EU and
    // actionable in the US — research.md §7.10, §12.7.
    const visible = (stripTags(cartRecovery(cart).html) + ' ' + cartRecovery(cart).text).toLowerCase()
    for (const banned of ['hurry', 'expires', 'last chance', 'only ', 'selling fast',
                          'limited time', 'act now', 'don\u2019t miss']) {
      expect(visible).not.toContain(banned)
    }
  })

  it('offers no discount we have not decided to give', () => {
    const visible = stripTags(cartRecovery(cart).html).toLowerCase()
    for (const banned of ['% off', 'discount', 'coupon', 'promo code']) {
      expect(visible).not.toContain(banned)
    }
  })

  it('points back at the request mechanic instead', () => {
    expect(cartRecovery(cart).html.toLowerCase()).toContain('source it')
  })

  it('omits the button when there is no url', () => {
    expect(cartRecovery(cart).html).not.toContain('href="undefined"')
  })

  it('survives an empty cart without printing undefined', () => {
    const r = cartRecovery({ ...cart, items: [], value: 0 })
    expect(r.html).not.toContain('undefined')
    expect(r.html).not.toContain('NaN')
  })
})

describe('template registry', () => {
  it('exposes exactly the templates the app sends', () => {
    // Nine to the customer, one to the shop. The list is written out rather than counted so
    // that adding a template is a deliberate edit here too.
    expect(Object.keys(TEMPLATES).sort()).toEqual([
      'cart-recovery', 'contact-received', 'ops-notification', 'order-claim',
      'order-placed', 'password-reset', 'request-received', 'request-sourced',
      'return-approved', 'return-declined', 'return-received',
    ])
  })

  it('every template returns subject, html and text', () => {
    // `rows` and `headline` belong to the operator template, which takes a different shape
    // from the nine customer ones — it renders a table rather than prose.
    const data: Record<string, unknown> = {
      ...order, raw_request: 'x', value: 6499, cart_id: 'c',
      headline: 'Something happened', rows: [['Order', '#1']],
      // order-claim names the account asking, and renders "undefined" without it — which is
      // exactly what the assertion below is for.
      requested_by: 'someone@example.com', order_number: 1042,
    }
    for (const [name, fn] of Object.entries(TEMPLATES)) {
      const out = (fn as (d: unknown) => { subject: string; html: string; text: string })(data)
      expect(out.subject && out.html && out.text).toBeTruthy()
      expect(out.html).toContain('<!doctype html>')
      expect(out.html).not.toContain('undefined')
      expect(name).toBeTruthy()
    }
  })
})

/* ------------------------------------------------------------------ returns */

const ret = {
  order_number: 1042,
  item_title: 'Buffalo Bills Josh Allen Grey Jersey',
  kind: 'exchange' as const,
  requested_size: 'XL',
  we_pay_postage: true,
}

describe('returns emails', () => {
  it('names the size on an exchange, so the reply needs no clarification', () => {
    const visible = stripTags(returnReceived(ret).html)
    expect(visible).toContain('exchange for size XL')
  })

  it('states who pays the postage, and says we do on an exchange', () => {
    expect(stripTags(returnReceived(ret).html)).toContain('We pay the return postage')
  })

  it('says the customer pays on a change of mind rather than going quiet', () => {
    const visible = stripTags(
      returnReceived({ ...ret, kind: 'refund', requested_size: null, we_pay_postage: false }).html
    )
    expect(visible).toContain('Return postage is yours')
  })

  it('tells the customer not to post anything back yet', () => {
    // The queue is a human queue; a parcel that arrives before approval has no reference
    // and cannot be matched to an order.
    expect(stripTags(returnReceived(ret).html).toLowerCase()).toContain('do not post anything back')
  })

  it('never renders "order #undefined" when the number is missing', () => {
    for (const fn of [returnReceived, returnApproved, returnDeclined]) {
      const out = fn({ ...ret, order_number: null })
      expect(out.html).not.toContain('undefined')
      expect(out.subject).not.toContain('undefined')
      expect(out.text).not.toContain('undefined')
      expect(out.subject.toLowerCase()).toContain('your order')
    }
  })

  it('carries the reason on a decline, because a bare refusal is unanswerable', () => {
    const note = 'This shirt was personalised with a name and number.'
    expect(stripTags(returnDeclined({ ...ret, note }).html)).toContain(note)
  })

  it('keeps statutory rights intact in the decline, whatever the reason', () => {
    const visible = stripTags(returnDeclined({ ...ret, note: 'Outside the window.' }).html)
    expect(visible.toLowerCase()).toContain('rights you have by law')
  })

  it('promises nothing about a delivery date', () => {
    // §7.10: no claim the data cannot support. The same rule the other templates follow.
    for (const fn of [returnReceived, returnApproved, returnDeclined]) {
      const visible = stripTags(fn(ret).html).toLowerCase()
      for (const banned of ['guaranteed', 'within 24 hours', 'same day']) {
        expect(visible).not.toContain(banned)
      }
    }
  })
})

describe('password reset', () => {
  const url = 'https://example.com/account/reset?token=abc'

  it('includes the link and its expiry', () => {
    const out = passwordReset({ url })
    expect(out.html).toContain(`href="${url}"`)
    expect(stripTags(out.html)).toContain('15 minutes')
    expect(out.text).toContain(url)
  })

  it('renders no dead button when the link could not be built', () => {
    // href="undefined" reads as a working button, gets clicked, and produces a ticket that
    // looks like a broken account rather than a broken email.
    for (const bad of [undefined, '', 'javascript:alert(1)'] as unknown[]) {
      const out = passwordReset({ url: bad as string })
      expect(out.html).not.toContain('href="undefined"')
      expect(out.html).not.toContain('undefined')
      expect(out.html).not.toContain('javascript:')
      expect(stripTags(out.html)).toContain('request a new one')
    }
  })

  it('leaks no account detail beyond the reset itself', () => {
    // The most-forwarded message a shop sends, often to a shared machine.
    const visible = stripTags(passwordReset({ url, email: 'fan@example.com' }).html)
    expect(visible).not.toContain('fan@example.com')
  })

  it('tells a recipient who did not ask that nothing has changed', () => {
    expect(stripTags(passwordReset({ url }).html)).toContain('nothing has changed')
  })
})

describe('contact acknowledgement', () => {
  it('quotes the message back, because "which message?" is the usual reply', () => {
    const out = contactReceived({ name: 'Sam', body: 'Where is order 1042?' })
    expect(stripTags(out.html)).toContain('Where is order 1042?')
    expect(stripTags(out.html)).toContain('Sam')
  })

  it('works with no name and no body', () => {
    const out = contactReceived({})
    expect(out.html).not.toContain('undefined')
    expect(out.text).not.toContain('undefined')
  })

  it('promises no response time we have not committed to', () => {
    const visible = stripTags(contactReceived({ body: 'hello' }).html).toLowerCase()
    for (const banned of ['within 24 hours', 'same day', 'guaranteed', 'immediately']) {
      expect(visible).not.toContain(banned)
    }
  })
})

describe('request-sourced — the email that has to lead to a purchase', () => {
  const base = { raw_request: 'Kobe 2004 gold, size L' }

  it('quotes what the customer typed, not a description of the product', () => {
    // Twelve people ask for the same shirt in twelve different ways. A bulk send is only
    // reassuring if it repeats their sentence.
    const r = requestSourced({ ...base, product_title: 'Lakers Kobe Bryant Gold Jersey' })
    expect(r.html).toContain('Kobe 2004 gold, size L')
    expect(r.text).toContain('Kobe 2004 gold, size L')
  })

  it('renders a buy button and a pasteable link when given a url', () => {
    const r = requestSourced({ ...base, url: 'https://shop.example/jerseys/kobe-gold' })
    expect(r.html).toContain('href="https://shop.example/jerseys/kobe-gold"')
    expect(r.html).toMatch(/Buy it now/i)
    // Some clients strip buttons. The bare URL is the fallback.
    expect(r.html).toContain('paste this into your browser')
    expect(r.text).toContain('https://shop.example/jerseys/kobe-gold')
  })

  it('renders no button at all rather than a dead one', () => {
    const r = requestSourced(base)
    expect(r.html).not.toMatch(/Buy it now/i)
    expect(r.html).not.toContain('href=""')
  })

  it('names the product in the subject when it knows it', () => {
    expect(requestSourced({ ...base, product_title: 'Lakers Kobe Gold' }).subject)
      .toBe('We found it — Lakers Kobe Gold')
    expect(requestSourced(base).subject).toBe('We found your jersey')
  })

  it('repeats the size they asked about', () => {
    const r = requestSourced({ ...base, size_code: 'L' })
    expect(r.html).toContain('size L')
  })

  it('invents no urgency', () => {
    // Same rule as the cart-recovery email: no countdown, no stock scarcity, no discount
    // nobody decided to give. Blacklisted outright in the EU.
    const r = requestSourced({ ...base, url: 'https://shop.example/x', product_title: 'A Shirt' })
    expect(r.html).not.toMatch(/hurry|only \d+ left|expires|last chance|selling fast/i)
  })
})

describe('cart-recovery — the only commercial email', () => {
  const base = {
    cart_id: 'cart_1', currency_code: 'usd', value: 6499,
    items: [{ title: 'A Jersey', quantity: 1, subtotal: 6499 }],
  }
  const full = {
    ...base,
    url: 'https://shop.example/cart',
    unsubscribe_url: 'https://shop.example/unsubscribe?token=abc.def',
    postal_address: '1 Example Street, Dallas TX 75201',
  }

  it('carries the unsubscribe link in both parts', () => {
    const r = cartRecovery(full)
    expect(r.html).toContain('https://shop.example/unsubscribe?token=abc.def')
    // A client that renders text only is not a client that gets a commercial email with no
    // opt-out in it.
    expect(r.text).toContain('https://shop.example/unsubscribe?token=abc.def')
  })

  it('carries the postal address in both parts', () => {
    const r = cartRecovery(full)
    expect(r.html).toContain('1 Example Street, Dallas TX 75201')
    expect(r.text).toContain('1 Example Street, Dallas TX 75201')
  })

  it('sets List-Unsubscribe for one-click', () => {
    // RFC 8058. Gmail and Yahoo require it of bulk senders, and a header the client can act
    // on is a better opt-out than a link somebody has to find.
    const r = cartRecovery(full)
    expect(r.headers?.['List-Unsubscribe'])
      .toBe('<https://shop.example/unsubscribe?token=abc.def>')
    expect(r.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('sets no header when there is no link to put in it', () => {
    // The sending route refuses in that case, so this should never render — but a header
    // pointing at nothing would be worse than none.
    expect(cartRecovery(base).headers).toBeUndefined()
  })

  it('is the only template that sets any header', () => {
    const data: Record<string, unknown> = {
      ...base, display_id: 1, email: 'a@b.com', currency_code: 'usd',
      items: [{ title: 'x', quantity: 1, subtotal: 1 }],
      raw_request: 'x', headline: 'x', rows: [], order_number: 1,
      token: 't', url: 'https://x', reason: 'faulty',
    }
    for (const [name, fn] of Object.entries(TEMPLATES)) {
      if (name === 'cart-recovery') continue
      const out = (fn as (d: unknown) => { headers?: unknown })(data)
      // Transactional email needs no unsubscribe, and adding one invites people to opt out
      // of their own receipts.
      expect(out.headers).toBeUndefined()
    }
  })

  it('still invents no urgency', () => {
    const r = cartRecovery(full)
    expect(r.html).not.toMatch(/hurry|only \d+ left|expires|last chance|selling fast/i)
  })
})
