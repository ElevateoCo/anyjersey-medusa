import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { integrationStatus } from '../../../integrations'

/** GET /admin/integrations — what is wired up and what is a placeholder. */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const items = integrationStatus()
  res.json({
    integrations: items,
    summary: {
      total: items.length,
      configured: items.filter((i) => i.configured).length,
      blocking_production: items.filter((i) => !i.configured && i.criticalInProduction).length,
    },
  })
}
