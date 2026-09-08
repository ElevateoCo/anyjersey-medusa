import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'
import { ROLES, rbacEnabled, type RoleKey } from '../policies'
import { assignRole, ensureRbacSeed } from '../rbac-seed'

/**
 * Create the roles, and give somebody the owner one.
 *
 *   npx medusa exec ./src/scripts/seed-rbac.ts
 *   OWNER_EMAIL=you@example.com npx medusa exec ./src/scripts/seed-rbac.ts
 *   ROLE=staff USER_EMAIL=colleague@example.com npx medusa exec ./src/scripts/seed-rbac.ts
 *
 * **Run this before turning RBAC on.** With the flag enabled, the permission check refuses a
 * user who holds no roles at all — before it consults a single policy — so a production boot
 * with nobody assigned means every admin request answers 403 and nobody can grant themselves
 * anything through the UI. `/health/ready` refuses to report ready in that state, which keeps
 * such a container out of rotation, but this script is the fix.
 *
 * Idempotent. The seeding itself lives in `src/rbac-seed.ts` so the integration suite
 * exercises the same code rather than a fixture that resembles it.
 */
export default async function seedRbac({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const userModule: any = container.resolve(Modules.USER)

  logger.info('')
  logger.info(`  RBAC enforcement is currently ${rbacEnabled() ? 'ON' : 'OFF'} ` +
              `(NODE_ENV=${process.env.NODE_ENV ?? 'development'})`)

  const { policiesCreated, rolesCreated, roleIds } = await ensureRbacSeed(container)
  logger.info(`  policies    ${policiesCreated} created`)
  logger.info(`  roles       ${rolesCreated} created`)

  // ---------------------------------------------------------------- assignment
  const targetRole = (process.env.ROLE as RoleKey) || 'owner'
  if (!ROLES[targetRole]) {
    logger.error(`  ROLE must be one of: ${Object.keys(ROLES).join(', ')}`)
    return
  }
  const email = (process.env.USER_EMAIL || process.env.OWNER_EMAIL || '').toLowerCase()

  const users = await userModule.listUsers(email ? { email } : {}, { take: 100 })
  if (!users.length) {
    logger.warn('')
    logger.warn(email
      ? `  No user with email ${email}. Create one first, then re-run.`
      : '  No users exist yet. Create one, then re-run with OWNER_EMAIL=…')
    return
  }
  // Without an email, the oldest user is the one this store was set up by. Chosen explicitly
  // rather than silently, because assigning ownership to the wrong account is the kind of
  // mistake that is discovered late.
  const user = email
    ? users[0]
    : [...users].sort((a: any, b: any) => +new Date(a.created_at) - +new Date(b.created_at))[0]

  await assignRole(container, user.id, roleIds[targetRole])

  logger.info('')
  logger.info('  ┌─ RBAC SEEDED ───────────────────────────────────────────')
  for (const def of Object.values(ROLES)) {
    logger.info(`  │ ${def.name.padEnd(12)} ${def.description}`)
  }
  logger.info('  │')
  logger.info(`  │ assigned    ${ROLES[targetRole].name} → ${user.email}`)
  logger.info(`  │ enforcement ${rbacEnabled() ? 'ON' : 'OFF — set MEDUSA_FF_RBAC=true'}`)
  logger.info('  └─────────────────────────────────────────────────────────')
  logger.warn('  They must sign out and back in before the role reaches their token.')
  logger.info('')
}
