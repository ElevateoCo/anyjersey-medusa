import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import type { MedusaContainer } from '@medusajs/framework/types'
import { ALL_POLICIES, OWNER_ROLE_NAME, ROLES, type RoleKey } from './policies'

/**
 * Create the roles and policies, idempotently.
 *
 * Extracted so the seed script and the integration suite run the *same* code. A test that
 * seeds its own roles a slightly different way proves that its own fixture works, which is
 * the failure this whole thread has been about — machinery that is declared, documented and
 * exercised by nothing real.
 *
 * Idempotent throughout, because it is not a one-shot: adding a resource to `policies.ts`
 * means re-running this, and the run must grant the new policy without disturbing anything
 * an operator has changed by hand.
 */
export type SeedResult = {
  policiesCreated: number
  rolesCreated: number
  roleIds: Record<string, string>
}

export async function ensureRbacSeed(container: MedusaContainer): Promise<SeedResult> {
  const rbac: any = container.resolve(Modules.RBAC)
  const key = (p: { resource: string; operation: string }) => `${p.resource}:${p.operation}`

  // ---------------------------------------------------------------- policies
  // Medusa's own module loader has already upserted the `*:*` policy and the Super Admin
  // role by the time anything here runs, so this has to read before it writes — creating a
  // duplicate key is an error, not a no-op.
  const existingPolicies = await rbac.listRbacPolicies({}, { take: 10000 })
  const policyByKey = new Map<string, any>(
    (existingPolicies as any[]).map((p) => [key(p), p])
  )

  const missingPolicies = ALL_POLICIES.filter((p) => !policyByKey.has(key(p)))
  if (missingPolicies.length) {
    const created = await rbac.createRbacPolicies(
      missingPolicies.map((p) => ({
        // `key` is a required column and nothing derives it — the create step lowercases
        // resource and operation and passes the rest through untouched.
        key: key(p),
        name: key(p),
        resource: p.resource,
        operation: p.operation,
      }))
    )
    for (const c of created as any[]) policyByKey.set(key(c), c)
  }

  // ---------------------------------------------------------------- roles
  const existingRoles = await rbac.listRbacRoles({}, { take: 1000 })
  const roleByName = new Map<string, any>((existingRoles as any[]).map((r) => [r.name, r]))

  const roleIds: Record<string, string> = {}
  let rolesCreated = 0

  for (const [roleKey, def] of Object.entries(ROLES)) {
    let role = roleByName.get(def.name)
    if (!role) {
      if (def.builtIn) {
        // The owner role is Medusa's and is seeded by its module loader. If it is absent the
        // module is not registered, and inventing a replacement would hide that.
        throw new Error(
          `The "${OWNER_ROLE_NAME}" role does not exist. Is @medusajs/medusa/rbac ` +
          'registered in medusa-config.ts?'
        )
      }
      ;[role] = await rbac.createRbacRoles([
        { name: def.name, description: def.description },
      ])
      rolesCreated++
      roleByName.set(def.name, role)
    }
    roleIds[roleKey] = role.id

    // Attach only what is missing. A policy granted by hand outside this function is
    // somebody's deliberate decision, and a re-run should not quietly revoke it.
    const attached = await rbac.listRbacRolePolicies(
      { role_id: role.id }, { take: 10000 }
    ).catch(() => [])
    const have = new Set((attached as any[]).map((rp) => rp.policy_id))

    const wanted = def.policies
      .map((p) => policyByKey.get(key(p as any)))
      .filter((p: any) => p && !have.has(p.id))

    if (wanted.length) {
      await rbac.createRbacRolePolicies(
        wanted.map((p: any) => ({ role_id: role.id, policy_id: p.id }))
      )
    }
  }

  return { policiesCreated: missingPolicies.length, rolesCreated, roleIds }
}

/**
 * Give a user a role.
 *
 * User-to-role is a **link**, not a column and not a module model. `user_rbac_role` is what
 * `generate-jwt-token` reads at sign-in: it queries the user for `rbac_roles.id` and puts the
 * result into the token's `app_metadata.roles`, which is the only place the permission check
 * looks. So creating the link is the whole assignment — and it means **the role reaches an
 * existing session only after the user signs in again.**
 */
export async function assignRole(
  container: MedusaContainer,
  userId: string,
  roleId: string
): Promise<void> {
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  await link.create([{
    [Modules.USER]: { user_id: userId },
    [Modules.RBAC]: { rbac_role_id: roleId },
  }]).catch(() => undefined)
}

export type { RoleKey }
