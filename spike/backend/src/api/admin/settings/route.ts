import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { CATALOG_MODULE } from '../../../modules/catalog'
import { ALL_SETTINGS, type SettingGroup } from '../../../settings'

/**
 * GET /admin/settings — every switch, with its current state.
 *
 * The registry is the source of truth for what exists; the table records only what has been
 * switched off. So a setting added in code appears here immediately, defaulted to on, with no
 * seed to run and nothing to migrate.
 */
const GROUP_LABELS: Record<SettingGroup, { title: string; blurb: string }> = {
  message: {
    title: 'Automatic emails',
    blurb:
      'The messages that send themselves. Manual sends are not here — pressing the button is ' +
      'already the switch — and operator notifications are per address under Notifications.',
  },
  checkout: {
    title: 'Checkout',
    blurb: 'What the checkout insists on. Enforced on the server, not just in the form.',
  },
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const rows = await catalog.listStoreSettings({}, { take: 200 }).catch(() => [])
  const stored = new Map(
    (rows as any[]).map((r) => [`${r.group}:${r.key}`, r])
  )

  const settings = ALL_SETTINGS.map((s) => {
    const row = stored.get(`${s.group}:${s.key}`)
    return {
      ...s,
      enabled: row ? row.enabled !== false : true,
      disabled_at: row?.disabled_at ?? null,
      disabled_by: row?.disabled_by ?? null,
      reason: row?.reason ?? null,
    }
  })

  const off = settings.filter((s) => !s.enabled)

  res.json({
    settings,
    groups: (Object.keys(GROUP_LABELS) as SettingGroup[]).map((g) => ({
      group: g, ...GROUP_LABELS[g],
    })),
    disabled_count: off.length,
    critical_disabled: off.filter((s) => s.severity === 'critical').map((s) => s.key),
  })
}
