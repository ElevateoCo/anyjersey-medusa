/**
 * The message half of `src/settings.ts`, under the name the send sites already import.
 *
 * A facade rather than a second implementation: when the settings table stopped being
 * message-specific, renaming the import in nine call sites would have been churn for no
 * behavioural change, and each of those call sites reads better saying `shouldSend` than
 * `checkSetting`.
 */
import { checkSetting, isSettingEnabled, MESSAGE_SETTINGS, type Setting } from './settings'
import type { MedusaContainer } from '@medusajs/framework/types'

export { MESSAGE_SETTINGS }
export type { Setting }
export const byKey = (key: string) => MESSAGE_SETTINGS.find((m) => m.key === key)

export const isMessageEnabled = (container: MedusaContainer, key: string) =>
  isSettingEnabled(container, key)

/** Reads as what it does at the call site: "should this email go?" */
export const shouldSend = (container: MedusaContainer, key: string, context: string) =>
  checkSetting(container, key, `nothing sent for ${context}`)
