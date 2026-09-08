import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../../modules/catalog'
import { byKey } from '../../../../settings'

/**
 * POST /admin/settings/:key  { enabled, reason? }
 *
 * Switching something **off** requires a reason. Not ceremony: the audit columns exist so that
 * "this has been off since Tuesday" is answerable, and a timestamp with no reason answers half
 * of it. Switching back on requires nothing — restoring the default should never be the
 * harder direction.
 *
 * The actor comes from the authenticated session, not the body. An operator typing somebody
 * else's name into an audit field is not an audit trail.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const key = String(req.params.key ?? '')
  const setting = byKey(key)

  if (!setting) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND,
      `"${key}" is not a switchable setting. Manual sends have no switch — pressing the ` +
      'button is the switch — and operator notifications are per recipient.')
  }

  const body = (req.body ?? {}) as { enabled?: unknown; reason?: unknown }
  if (typeof body.enabled !== 'boolean') {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'enabled must be true or false.')
  }

  const reason = String(body.reason ?? '').trim()
  if (!body.enabled && !reason) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA,
      `Switching off "${setting.label}" needs a reason. ${setting.consequence}`)
  }

  const actor = (req as any).auth_context?.actor_id ?? 'unknown'
  const [existing] = await catalog.listStoreSettings(
    { group: setting.group, key }, { take: 1 }
  )

  const payload = {
    group: setting.group,
    key,
    enabled: body.enabled,
    disabled_at: body.enabled ? null : new Date(),
    disabled_by: body.enabled ? null : actor,
    reason: body.enabled ? null : reason,
  }

  const [saved] = existing
    ? await catalog.updateStoreSettings([{ id: existing.id, ...payload }])
    : await catalog.createStoreSettings([payload])

  req.scope.resolve('logger').warn(
    `[settings] "${setting.label}" switched ${body.enabled ? 'ON' : 'OFF'} by ${actor}` +
    (body.enabled ? '' : ` — ${reason}`)
  )

  res.json({
    setting: {
      ...setting,
      enabled: saved.enabled,
      disabled_at: saved.disabled_at,
      disabled_by: saved.disabled_by,
      reason: saved.reason,
    },
    ...(body.enabled ? {} : { warning: setting.consequence }),
  })
}
