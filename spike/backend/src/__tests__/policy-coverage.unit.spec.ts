import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { ALL_POLICIES, RESOURCE, ROLES, rbacEnabled } from '../policies'

/**
 * Every admin route must declare a policy.
 *
 * Medusa's default is the wrong way round: a route with no `policies` block is authenticated
 * and otherwise unrestricted, so a route added next month is open to every signed-in account
 * until somebody remembers this file exists. Nothing in the framework fails when that
 * happens — the route simply works for everyone, which is indistinguishable from working.
 *
 * So the coverage is asserted here instead. This test reads the route files off disk and the
 * matchers out of `middlewares.ts`, and fails if a route handler has no rule covering it.
 * It is the thing that makes the authorisation real rather than aspirational — the same
 * failure mode as `assertConfigured()`, which was declared, documented and called from
 * nowhere.
 */
const API_ROOT = join(__dirname, '..', 'api', 'admin')
const MIDDLEWARES = join(__dirname, '..', 'api', 'middlewares.ts')

/** Every `/admin/...` route file, as the path Medusa serves it at. */
function routeFiles(dir: string, prefix = '/admin'): { path: string; methods: string[] }[] {
  const out: { path: string; methods: string[] }[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      // `[id]` on disk is `:id` in a matcher.
      const segment = entry.startsWith('[') ? `:${entry.slice(1, -1)}` : entry
      out.push(...routeFiles(full, `${prefix}/${segment}`))
    } else if (entry === 'route.ts') {
      const src = readFileSync(full, 'utf8')
      const methods = [...src.matchAll(
        /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g
      )].map((m) => m[1])
      if (methods.length) out.push({ path: prefix, methods })
    }
  }
  return out
}

/** The declared rules, as (method, matcher) pairs. */
function declaredRules(): { methods: string[]; matcher: string }[] {
  const src = readFileSync(MIDDLEWARES, 'utf8')
  const rules: { methods: string[]; matcher: string }[] = []

  // Each entry is an object literal carrying a matcher, and a policies block when it is one
  // of ours. Entries without policies — the request-id middleware — are skipped.
  for (const m of src.matchAll(
    /\{[^{}]*?method:\s*\[([^\]]*)\][^{}]*?matcher:\s*'([^']+)'[^{}]*?policies:[^{}]*?\}/gs
  )) {
    const methods = [...m[1].matchAll(/'([A-Z]+)'/g)].map((x) => x[1])
    rules.push({ methods, matcher: m[2] })
  }
  return rules
}

describe('authorisation coverage', () => {
  const routes = routeFiles(API_ROOT)
  const rules = declaredRules()

  it('found the routes and the rules', () => {
    // A guard on the guard: if either regex stops matching, every assertion below passes
    // vacuously and the test becomes decoration.
    expect(routes.length).toBeGreaterThan(15)
    expect(rules.length).toBeGreaterThan(15)
  })

  const cases = routes.flatMap((r) => r.methods.map((method) => [method, r.path] as const))

  it.each(cases)('%s %s is covered by a policy', (method, path) => {
    const covered = rules.some((rule) =>
      rule.matcher === path && rule.methods.includes(method))

    expect(covered).toBe(true)
  })

  it('declares no rule for a route that does not exist', () => {
    // The other direction. A matcher left behind after a route is deleted grants nothing and
    // costs nothing, which is exactly why it would sit there misleading whoever reads it.
    const paths = new Set(routes.map((r) => r.path))
    const orphans = rules
      .map((r) => r.matcher)
      .filter((m) => !paths.has(m) && m !== '/admin/media/upload')

    expect(orphans).toEqual([])
  })
})

describe('the role definitions', () => {
  it('gives the owner a wildcard rather than an enumeration', () => {
    // An owner locked out of a resource somebody forgot to grant is worse than an owner
    // having more than they strictly need.
    expect(ROLES.owner.policies).toEqual([{ resource: '*', operation: '*' }])
  })

  it('never grants staff a delete', () => {
    const deletes = ROLES.staff.policies.filter((p) => p.operation === 'delete')
    expect(deletes).toEqual([])
  })

  it('keeps staff away from integrations and media writes', () => {
    const staff = ROLES.staff.policies.map((p) => `${p.resource}:${p.operation}`)
    expect(staff).not.toContain(`${RESOURCE.INTEGRATION}:read`)
    expect(staff).not.toContain(`${RESOURCE.MEDIA}:create`)
    expect(staff).not.toContain(`${RESOURCE.MEDIA}:delete`)
    // But it can still see the images that are already on a product.
    expect(staff).toContain(`${RESOURCE.MEDIA}:read`)
  })

  it('grants staff no create on anything', () => {
    // Staff correct what is there; they do not add. Asserted as a rule rather than
    // resource-by-resource, so a new resource cannot quietly arrive with create attached.
    expect(ROLES.staff.policies.filter((p) => p.operation === 'create')).toEqual([])
  })

  it('lists every policy the roles need, without duplicates', () => {
    const keys = ALL_POLICIES.map((p) => `${p.resource}:${p.operation}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const role of Object.values(ROLES)) {
      for (const p of role.policies) {
        expect(keys).toContain(`${p.resource}:${p.operation}`)
      }
    }
  })
})

describe('the enforcement flag', () => {
  const original = process.env

  afterEach(() => { process.env = { ...original } })

  it('is off in development', () => {
    process.env = { ...original, NODE_ENV: 'development', MEDUSA_FF_RBAC: '' }
    expect(rbacEnabled()).toBe(false)
  })

  it('is on in production', () => {
    process.env = { ...original, NODE_ENV: 'production', MEDUSA_FF_RBAC: '' }
    expect(rbacEnabled()).toBe(true)
  })

  it('lets the environment variable win in both directions', () => {
    // Mirrors Medusa's own resolution order — env beats project config — which is how you
    // rehearse enforcement locally, and how you turn it off in an emergency.
    process.env = { ...original, NODE_ENV: 'development', MEDUSA_FF_RBAC: 'true' }
    expect(rbacEnabled()).toBe(true)
    process.env = { ...original, NODE_ENV: 'production', MEDUSA_FF_RBAC: 'false' }
    expect(rbacEnabled()).toBe(false)
  })
})
