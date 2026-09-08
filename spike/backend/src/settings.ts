import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import type { MedusaContainer } from '@medusajs/framework/types'
import { CATALOG_MODULE } from './modules/catalog'

/**
 * Every switch in the admin, in one registry.
 *
 * Two groups today. They share a table, an audit trail and a confirmation dialog because they
 * share a shape — a key, a boolean, and a consequence somebody should read before flipping it.
 * What differs is only what the consequence *is*.
 *
 * The consequence text is not decoration: it is what the dialog shows, and it is the reason
 * the dialog exists. A switch whose effect is invisible until a customer complains is exactly
 * the kind of control that should be hard to flip by accident.
 */
export type SettingGroup = 'message' | 'checkout'
export type Severity = 'safe' | 'serious' | 'critical'

export type Setting = {
  key: string
  group: SettingGroup
  label: string
  /** What happens while it is on. */
  what: string
  /** What happens when it is off. Shown in the confirmation dialog, verbatim. */
  consequence: string
  severity: Severity
  /** Where the switch is read, so it can be traced to the code it gates. */
  origin: string
}

/**
 * The automatic customer emails.
 *
 * Only the automatic ones. The manual sends — "we found it", the return decision, cart
 * recovery — already have a switch, which is that somebody has to press a button; a second one
 * would be a setting that means "the button does nothing". Operator notifications are absent
 * too: the recipient list controls them per address, and a global override on top of a
 * per-address list is two places to look when somebody stops receiving mail.
 */
export const MESSAGE_SETTINGS: Setting[] = [
  {
    key: 'order_placed', group: 'message',
    label: 'Order confirmation',
    what: 'Sent when payment succeeds, with the items, totals and delivery estimate.',
    consequence:
      'Customers will pay and receive nothing. This is the receipt — in the EU and UK, ' +
      'confirmation of the contract on a durable medium is required by the Consumer Rights ' +
      'Directive, not optional. Expect "did my order go through?" support load immediately.',
    severity: 'critical',
    origin: 'subscribers/order-placed.ts',
  },
  {
    key: 'password_reset', group: 'message',
    label: 'Password reset',
    what: 'The link a customer needs to get back into their account.',
    consequence:
      'Anyone who forgets their password is locked out permanently. There is no admin ' +
      '"send reset" button and no other route back in — the email is the only mechanism. ' +
      'Existing customers keep their sessions; nobody else can recover an account.',
    severity: 'critical',
    origin: 'subscribers/password-reset.ts',
  },
  {
    key: 'order_claim', group: 'message',
    label: 'Order claim confirmation',
    what: 'Confirms that a guest order should be attached to an account.',
    consequence:
      'Nobody can attach a past guest order to their account — the confirmation goes to the ' +
      'address on the order, and without it the request can never be completed. The feature ' +
      'stops working rather than becoming less safe.',
    severity: 'serious',
    origin: 'subscribers/order-transfer.ts',
  },
  {
    key: 'request_received', group: 'message',
    label: 'Jersey request acknowledgement',
    what: 'Confirms we are looking, and that there is no charge until we find it.',
    consequence:
      'Somebody asks you to source a shirt and hears nothing back. The request is still ' +
      'recorded and still reaches the queue — but "ask us and we will find it" with silence ' +
      'in reply is the proposition failing at the first step.',
    severity: 'serious',
    origin: 'api/store/jersey-requests/route.ts',
  },
  {
    key: 'return_received', group: 'message',
    label: 'Return acknowledgement',
    what: 'Confirms the request arrived. Not a decision — deliberately.',
    consequence:
      'A customer reporting a fault gets silence while the 30-day window runs. Under a ' +
      'final-sale policy this is the message that shows the request was received at all, ' +
      'and its absence is what a chargeback or a complaint will point at.',
    severity: 'serious',
    origin: 'api/store/return-requests/route.ts',
  },
  {
    key: 'contact_received', group: 'message',
    label: 'Contact acknowledgement',
    what: 'An auto-reply saying the message arrived.',
    consequence:
      'Somebody who writes in gets no auto-reply. The message is still stored and the ' +
      'notification to your list still fires, so nothing is lost — this is the one switch ' +
      'here that costs only politeness.',
    severity: 'safe',
    origin: 'api/store/contact/route.ts',
  },
]

/**
 * What checkout insists on.
 *
 * Enforced on the **server**, at completion, not by the `required` attribute on an input. A
 * form-level requirement is a hint to a browser; anybody posting to the API directly ignores
 * it, and a rule that only holds for people using the form is not a rule.
 */
export const CHECKOUT_SETTINGS: Setting[] = [
  {
    key: 'phone_required', group: 'checkout',
    label: 'Require a phone number',
    what:
      'The checkout asks for a phone number and will not complete an order without one. ' +
      'Carriers use it for delivery problems, and it is the fastest route to a customer ' +
      'when something goes wrong with a shirt that was made to order.',
    consequence:
      'The field stays on the form but becomes optional, and most people will skip it. ' +
      'Expect more undeliverable parcels: a courier with a bad address and no phone number ' +
      'returns the parcel, and on a personalised shirt that is a total loss rather than ' +
      'restock. It is also the only contact route that works when somebody mistypes their ' +
      'email.',
    severity: 'serious',
    origin: 'api/middlewares.ts — requirePhoneAtCheckout',
  },
]

export const ALL_SETTINGS: Setting[] = [...MESSAGE_SETTINGS, ...CHECKOUT_SETTINGS]

export const byKey = (key: string) => ALL_SETTINGS.find((s) => s.key === key)
export const inGroup = (group: SettingGroup) => ALL_SETTINGS.filter((s) => s.group === group)

/**
 * Is this switch on?
 *
 * **Fails open**, and that is the important half. A missing table, an unreachable database or
 * a row nobody has written all answer `true`. The reasoning differs slightly per group and
 * lands in the same place:
 *
 *  - For a message, sending a receipt nobody wanted is a nuisance; failing to send one because
 *    a settings lookup errored is a customer who paid and heard nothing.
 *  - For checkout, defaulting to "phone required" during a database blip asks for one extra
 *    field. Defaulting the other way would silently drop a requirement somebody chose.
 *
 * Only an explicit stored `false` turns anything off.
 */
export async function isSettingEnabled(
  container: MedusaContainer,
  key: string
): Promise<boolean> {
  const setting = byKey(key)
  if (!setting) return true

  try {
    const catalog: any = container.resolve(CATALOG_MODULE)
    const [row] = await catalog.listStoreSettings(
      { group: setting.group, key }, { take: 1 }
    )
    return row ? row.enabled !== false : true
  } catch {
    return true
  }
}

/**
 * Check a switch and say so in the log when it is off.
 *
 * Logged on every suppressed action rather than once at startup. Noisy on purpose: an
 * abnormal state somebody chose is exactly the thing that should stay visible while it lasts,
 * and the log is where somebody chasing "why did this not happen" will look.
 */
export async function checkSetting(
  container: MedusaContainer,
  key: string,
  context: string
): Promise<boolean> {
  const enabled = await isSettingEnabled(container, key)
  if (!enabled) {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.warn(
      `[settings] "${byKey(key)?.label ?? key}" is switched off — ${context}. ` +
      'Turn it back on at /app/settings.'
    )
  }
  return enabled
}
