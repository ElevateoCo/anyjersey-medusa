import { PolicyOperation, WILDCARD } from '@medusajs/framework/utils'

/**
 * Who is allowed to do what, in one file.
 *
 * Every custom admin route sat behind the login and nothing else. Medusa authenticates the
 * whole `/admin` prefix at the router, so authentication was never the gap — authorisation
 * was. There was one privilege level and it was "everything": any account that could sign in
 * could rewrite every price, erase the contact inbox, sweep the image store and read every
 * customer's return.
 *
 * **The mechanism, because it is not obvious.** Medusa 2.18 checks a route's `policies` only
 * when the `rbac` feature flag is on (`http/router.js` wraps the handler with
 * `wrapWithPoliciesCheck` behind `FeatureFlag.isFeatureEnabled("rbac")`). With the flag off,
 * every `policies` block in this application is inert — which is why declaring them is safe
 * to do ahead of switching it on, and why declaring them alone would have achieved nothing.
 *
 * With the flag **on**, the check reads role ids from the JWT's `app_metadata.roles` and
 * refuses anything that no role grants. It also refuses a user with *no* roles outright,
 * before consulting any policy — so enabling the flag without seeding roles locks everybody
 * out of the admin. `scripts/seed-rbac.ts` exists for that, and `/health/ready` refuses to
 * report ready in that state so a production container never enters rotation locked out.
 */

/**
 * Resources, named for what an operator would call the thing rather than for the table.
 *
 * Coarser than the table list on purpose. `jersey_detail`, `product` and the media a product
 * carries are one job — putting product on the site — and splitting them into three
 * permissions produces a role nobody can reason about. Resources are the unit a person is
 * given or denied.
 */
export const RESOURCE = {
  /** Products and their catalog fields: create, edit, delete, prices, images on a product. */
  PRODUCT: 'product',
  /** The image store itself — uploads and the orphan sweep. */
  MEDIA: 'media',
  /** Curated collections and their membership. */
  COLLECTION: 'collection',
  /** Customer reviews, first-party and imported: moderation and takedown. */
  REVIEW: 'review',
  /** The returns queue. */
  RETURN: 'return',
  /** Contact messages and newsletter subscribers. */
  INBOX: 'inbox',
  /** The "find me this jersey" queue. */
  JERSEY_REQUEST: 'jersey_request',
  /** Personalisation approvals — what gets printed on a shirt. */
  PERSONALISATION: 'personalisation',
  /** Orders, carts and the revenue report. */
  ORDER: 'order',
  /**
   * The customer list (`/admin/customer-list`).
   *
   * Read is daily work — somebody answering "where is my order" has to find the person. The
   * **CSV export is deliberately not here**: taking every customer's name, address, phone and
   * email off the system in one file is the same act `/admin/privacy/subject` exists for, so
   * it is gated on `privacy:read` instead. One answer to "who can extract customer data in
   * bulk", rather than two that drift apart.
   */
  CUSTOMER: 'customer',
  /** Which external services are configured, and the keys behind them. */
  INTEGRATION: 'integration',
  /**
   * Subject access and erasure.
   *
   * Its own resource, and owner-only, because it is the one endpoint that reads *every*
   * customer's personal data in one call and the one that erases across eight tables at
   * once. Folding it into `order:read` would hand it to Staff along with the revenue report.
   */
  PRIVACY: 'privacy',
  /**
   * The list of addresses that receive operational notifications.
   *
   * Owner-only, and that is a security decision rather than tidiness: what arrives at those
   * addresses is customer data — an order notification carries a name and a total, a contact
   * notification carries what somebody wrote. Letting Staff add an address would be letting
   * them forward customer records to any inbox they choose.
   */
  NOTIFICATION: 'notification',
} as const

export type Resource = (typeof RESOURCE)[keyof typeof RESOURCE]
export type Operation = 'read' | 'create' | 'update' | 'delete' | '*'

export type Policy = { resource: string; operation: Operation }

const p = (resource: Resource, operation: Operation): Policy => ({ resource, operation })

/**
 * The identifier of the wildcard role Medusa's own RBAC module seeds on first boot.
 *
 * Its `initial-data` loader upserts a "Super Admin" role, a `*:*` policy, and the link
 * between them, all at fixed ids. So the owner role is **not ours to create** — creating a
 * second identical one would clash on the policy key (`*:*` is unique) and would put two
 * indistinguishable entries in the admin's role list. We adopt it and name it in one place.
 */
export const OWNER_ROLE_ID = 'role_super_admin'
export const OWNER_ROLE_NAME = 'Super Admin'

/**
 * The two roles, as chosen.
 *
 * **Owner** is a wildcard rather than an enumeration of every policy — an owner locked out of
 * a resource nobody remembered to grant is a worse failure than an owner having more than
 * they strictly need, and `*:*` cannot drift out of step with this file. It is listed here
 * for documentation and for the seed's reporting; the row itself is Medusa's.
 *
 * **Staff** is defined by what it excludes, and the exclusions are the point:
 *
 *  - **No deletes, anywhere.** Every destructive path in this application is irreversible in
 *    practice: a swept image is bytes that exist nowhere else, an erased inbox row is gone by
 *    design, a deleted product takes its catalog row with it.
 *  - **No product creation and no media writes.** Putting new product on the site is the
 *    owner's call; correcting what is already there is not.
 *  - **No integrations.** That screen names which keys are missing, and the keys behind it
 *    are money.
 *
 * What staff *can* do is the daily work: answer contact, move returns and requests along,
 * moderate reviews, approve what gets printed, and correct a product's copy and taxonomy.
 */
export const ROLES = {
  owner: {
    name: OWNER_ROLE_NAME,
    builtIn: true,
    description: 'Full access, including deletes, integrations and the image store.',
    policies: [{ resource: WILDCARD, operation: WILDCARD as Operation }],
  },
  staff: {
    name: 'Staff',
    builtIn: false,
    description:
      'Day-to-day operations. Cannot delete anything, add products, touch the image ' +
      'store or see integration keys.',
    policies: [
      p(RESOURCE.PRODUCT, 'read'), p(RESOURCE.PRODUCT, 'update'),
      p(RESOURCE.MEDIA, 'read'),
      p(RESOURCE.COLLECTION, 'read'), p(RESOURCE.COLLECTION, 'update'),
      p(RESOURCE.REVIEW, 'read'), p(RESOURCE.REVIEW, 'update'),
      p(RESOURCE.RETURN, 'read'), p(RESOURCE.RETURN, 'update'),
      p(RESOURCE.INBOX, 'read'), p(RESOURCE.INBOX, 'update'),
      p(RESOURCE.JERSEY_REQUEST, 'read'), p(RESOURCE.JERSEY_REQUEST, 'update'),
      p(RESOURCE.PERSONALISATION, 'read'), p(RESOURCE.PERSONALISATION, 'update'),
      p(RESOURCE.ORDER, 'read'),
      p(RESOURCE.CUSTOMER, 'read'),
    ],
  },
} as const

export type RoleKey = keyof typeof ROLES

/** Every distinct policy any role needs, which is what the seed creates. */
export const ALL_POLICIES: Policy[] = (() => {
  const seen = new Set<string>()
  const out: Policy[] = []
  for (const role of Object.values(ROLES)) {
    for (const policy of role.policies) {
      const key = `${policy.resource}:${policy.operation}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(policy as Policy)
    }
  }
  return out
})()

/**
 * Is enforcement actually on?
 *
 * Mirrors Medusa's own resolution order — the `MEDUSA_FF_RBAC` environment variable wins over
 * the project config, which is why this reads the variable first rather than assuming
 * production means enforced. Used by `/health/ready`, which has to know whether a missing
 * owner is a problem or just an unconfigured spike.
 */
export const rbacEnabled = (): boolean => {
  const env = process.env.MEDUSA_FF_RBAC
  if (env !== undefined && env !== '') return env === 'true' || env === '1'
  return (process.env.NODE_ENV ?? 'development') === 'production'
}

/** Shorthand for the route declarations, so a matcher reads as one line. */
export const can = (resource: Resource, ...operations: Operation[]) =>
  operations.map((operation) => ({ resource, operation }))

export { PolicyOperation }
