import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { rbacEnabled } from '../../../policies'

/**
 * GET /health/ready
 *
 * Distinct from `/health`, and the distinction is the point. `/health` answers "is the
 * process alive" — the right question for a restart policy. This answers "can this
 * instance serve a request", which is the right question for a load balancer, because a
 * process that is up but cannot reach Postgres should be taken out of rotation rather than
 * killed and restarted into the same state.
 *
 * research.md §8.4. Getting these two backwards is how a database blip becomes a restart
 * loop across every instance at once.
 */
/**
 * The failure reason goes to the log, never to the caller.
 *
 * This endpoint is unauthenticated — it has to be, a load balancer cannot hold a session —
 * and it used to answer with `(e as Error).message`. A Postgres connection failure carries
 * the host, the port, the database name and the role; a query failure carries schema. That
 * was handed to anyone on the internet who asked, and a probe that is failing is exactly
 * when the message is most detailed.
 *
 * What a probe needs is the status code and which check failed. What an operator needs is
 * the reason, and they have the logs.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const checks: Record<string, { ok: boolean; ms: number }> = {}
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const time = async (name: string, fn: () => Promise<unknown>) => {
    const t0 = Date.now()
    try {
      await fn()
      checks[name] = { ok: true, ms: Date.now() - t0 }
    } catch (e) {
      checks[name] = { ok: false, ms: Date.now() - t0 }
      logger.error(
        `[health/ready] ${name} failed: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any

  await time('database', () => knex.raw('select 1'))
  // Not just connectivity: an empty media table means images 404 site-wide, which is a
  // deploy that should not take traffic even though every connection is fine.
  await time('media', async () => {
    const r = await knex.raw('select count(*)::int as n from media_asset')
    if (!r.rows?.[0]?.n) throw new Error('media_asset is empty')
  })
  await time('catalog', async () => {
    const r = await knex.raw(
      `select count(*)::int as n from product where status = 'published' and deleted_at is null`
    )
    if (!r.rows?.[0]?.n) throw new Error('no published products')
  })

  /**
   * With RBAC on, somebody has to hold an owner role.
   *
   * The permission check refuses a user who holds no roles *before* it consults a policy, so
   * enforcement plus an empty `rbac_role` table means every admin request answers 403 and
   * nobody can grant themselves anything through the UI. There is no way out except a shell
   * on the database.
   *
   * This belongs here rather than at boot, and not for want of trying: `instrumentation.ts`
   * is the only hook Medusa calls before the server exists, and it runs with
   * `skipDbConnection`, so the question cannot be asked there. A readiness check is the right
   * shape anyway — it is exactly the case §8.4 describes, a process that is up and cannot
   * serve. The container starts, never enters rotation, and says why.
   */
  if (rbacEnabled()) {
    await time('rbac', async () => {
      const r = await knex.raw(
        `select count(*)::int as n
         from user_rbac_role l
         join rbac_role r on r.id = l.rbac_role_id
         join rbac_role_policy rp on rp.role_id = r.id
         join rbac_policy p on p.id = rp.policy_id
         where p.resource = '*' and p.operation = '*'`
      )
      if (!r.rows?.[0]?.n) {
        throw new Error(
          'RBAC is enabled and no user holds a role with the *:* policy. Every admin ' +
          'request will be refused. Run: npx medusa exec ./src/scripts/seed-rbac.ts'
        )
      }
    })
  }

  const ok = Object.values(checks).every((c) => c.ok)
  // 503, not 500: this is "not ready", a state a load balancer knows how to wait out.
  res.status(ok ? 200 : 503).json({
    ready: ok,
    checks,
    // Stated so an operator reading a failing probe knows whether policies are in force.
    rbac: rbacEnabled() ? 'enforced' : 'off',
    // Useful in a rollback: which build is actually answering.
    release: process.env.GIT_SHA ?? null,
    uptime_s: Math.round(process.uptime()),
  })
}
