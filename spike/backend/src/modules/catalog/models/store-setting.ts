import { model } from '@medusajs/framework/utils'

/**
 * One switch, whatever it switches.
 *
 * Started as `message_setting` and was never message-specific in anything but its name: a key,
 * a boolean and an audit trail describes every toggle this admin will ever have. When the
 * second kind arrived — whether a phone number is required at checkout — the choice was a
 * second table with the same five columns or one table that says what it is.
 *
 * **A row exists only once somebody has touched the switch.** Absence means on, which is what
 * `isSettingEnabled` returns when it finds nothing. That keeps the default in the code rather
 * than depending on a seed having run, and means a fresh database behaves like a configured
 * one.
 *
 * The audit columns are the whole reason this is a table rather than an environment variable.
 * "Order confirmations have been off since Tuesday" is a question somebody asks after a week
 * of support tickets, and `disabled_at` plus `disabled_by` is the only way to answer it.
 */
export const StoreSetting = model
  .define('store_setting', {
    id: model.id().primaryKey(),

    /** Which registry in src/settings.ts owns this key — `message` or `checkout`. */
    group: model.text().default('message'),
    /** Unique within its group, not globally. */
    key: model.text(),
    enabled: model.boolean().default(true),

    /** When it was last switched off, and by whom. Null once it is back on. */
    disabled_at: model.dateTime().nullable(),
    disabled_by: model.text().nullable(),
    /** Why — required by the API when switching something off. */
    reason: model.text().nullable(),
  })
  .indexes([
    { on: ['group', 'key'], unique: true, where: 'deleted_at IS NULL' },
  ])
