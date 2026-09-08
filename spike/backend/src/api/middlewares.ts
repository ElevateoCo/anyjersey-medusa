import {
  defineMiddlewares,
  errorHandler as medusaErrorHandler,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
  type MiddlewareVerb,
} from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { randomUUID } from 'crypto'
import multer from 'multer'
import { reportError } from '../observability'
import { MAX_UPLOAD_BYTES } from '../media-ingest'
import { RESOURCE, can } from '../policies'
import { ContainerRegistrationKeys as CRK } from '@medusajs/framework/utils'
import { isSettingEnabled } from '../settings'
import { rateLimit } from '../rate-limit'

/**
 * Request id, then error reporting.
 *
 * The order matters: the id is attached on the way in so the error handler on the way out
 * can quote it, and so can the response. Without that, a customer saying "it failed" and a
 * log line are impossible to connect — which is the whole practical value of the id.
 */
function requestId(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  // Trust an upstream id if there is one, so a trace survives the proxy hop.
  const id = (req.headers['x-request-id'] as string) || randomUUID()
  ;(req as any).requestId = id
  res.setHeader('X-Request-Id', id)
  next()
}

/**
 * Error handler.
 *
 * Registered as `config.errorHandler`, **not** as a route middleware. The first version put
 * it in `routes` as a four-argument Express error middleware, which Medusa wraps and calls
 * with three — so it ran on every ordinary request, `next` was undefined, and every
 * endpoint returned 500. A four-argument function only behaves as an error handler when
 * Express itself registers it; through this config it must take the framework's own
 * `(error, req, res, next)` shape.
 *
 * It reports and then delegates to Medusa's own handler for the response. Delegating via
 * `next(err)` does NOT work: setting `config.errorHandler` *replaces* Medusa's handler, so
 * `next` falls through to Express's default, which answered a routine 400 ("publishable API
 * key required") with a 500 HTML page containing a full stack trace — a regression and a
 * disclosure in one. So the default is imported and called explicitly.
 */
function reportErrors(
  err: Error,
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const status = (err as any).status ?? (err as any).statusCode
  // 4xx is the caller's problem and arrives in volume from bots. Reporting it buries the
  // 5xx that actually needs someone.
  if (!status || status >= 500) {
    const logger = req.scope?.resolve(ContainerRegistrationKeys.LOGGER)
    void reportError(
      err,
      {
        route: (req as any).route?.path ?? req.path,
        method: req.method,
        requestId: (req as any).requestId,
        extra: { query: req.query, params: req.params },
      },
      logger as any
    )
  }
  // Medusa's own handler owns the status code and the JSON shape. Calling it directly,
  // rather than via next(), is what keeps a 400 a 400.
  return delegate(err, req as any, res as any, next as any)
}

// Built once: the factory installs its own formatter chain.
const delegate = medusaErrorHandler()

/**
 * Multipart parsing for the one endpoint that takes files.
 *
 * Memory storage, matching what Medusa does for its own `/admin/uploads`: the bytes go
 * straight into sharp and then into Postgres or R2, so writing them to a temp file first
 * would be a round trip to a disk that in a container is not there tomorrow.
 *
 * The size cap is enforced *here* as well as in `media-ingest.ts`. Checking it only after
 * the file is parsed means a 500 MB body is fully read into memory before being refused,
 * which is the difference between rejecting an upload and being knocked over by one. The
 * check downstream stays, because that path is also reachable from the import script.
 */
const uploadImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 12 },
}).array('files')

/**
 * A phone number, if the shop requires one.
 *
 * Enforced **at completion**, on the server, rather than by the `required` attribute on an
 * input. A form-level requirement is a hint to a browser: anybody posting to
 * `/store/carts/:id/complete` directly ignores it, and a rule that only holds for people using
 * the form is not a rule. This is the last point at which the order does not yet exist, which
 * makes it the right place — refusing here costs a customer one field, refusing later would
 * mean unwinding a payment.
 *
 * Checked against the **shipping** address specifically. A carrier needs a number for a
 * delivery problem, and a personalised shirt returned as undeliverable is a total loss rather
 * than restock; the billing address is not what goes on the label.
 *
 * The setting fails open, so a database blip asks for a phone number rather than silently
 * dropping a requirement somebody chose.
 */
async function requirePhoneAtCheckout(
  req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction
) {
  try {
    if (!(await isSettingEnabled(req.scope as never, 'phone_required'))) return next()

    const cartId = (req.params as { id?: string })?.id
    if (!cartId) return next()

    const query = req.scope.resolve(CRK.QUERY)
    const { data } = await query.graph({
      entity: 'cart',
      fields: ['id', 'shipping_address.phone'],
      filters: { id: cartId } as any,
    })
    const address = (data as any[])[0]?.shipping_address
    const phone = String(
      (Array.isArray(address) ? address[0] : address)?.phone ?? ''
    ).trim()

    // Loose on format, strict on presence. Phone numbers are formatted a dozen ways across
    // the five regions this ships to, and a regex that rejects a valid international number
    // costs an order — while an obviously empty field costs nothing to refuse.
    if (phone.replace(/[^0-9]/g, '').length < 6) {
      return res.status(400).json({
        type: 'invalid_data',
        message:
          'A phone number is required on the delivery address. Carriers use it when there ' +
          'is a problem with a delivery.',
        field: 'shipping_address.phone',
      })
    }
    return next()
  } catch (e) {
    // Never block a completion because the check itself failed. The order is the thing that
    // matters; a missing phone number is recoverable by email.
    req.scope.resolve(CRK.LOGGER).error(
      `[checkout] phone check failed, allowing completion: ` +
      (e instanceof Error ? e.message : String(e))
    )
    return next()
  }
}


/**
 * Rate limits for Medusa's auth routes.
 *
 * **Every matcher here is spelled out, and that is not verbosity — it is the only thing that
 * works.** Medusa sorts middleware and routes together through `RoutesSorter` before handing
 * them to Express, in the order `global, wildcard, regex, static, params`. A middleware
 * matching `/auth/:actor/:provider` lands in *params*; the route it is meant to guard,
 * `/auth/customer/emailpass`, is *static*. Static registers first, Express calls handlers in
 * registration order, and the middleware never runs.
 *
 * It also never complains. The first version of this file had exactly that matcher, and the
 * only reason it is not still there is an integration test that sent eleven logins and
 * expected the eleventh to be refused. A limit that silently does nothing is worse than no
 * limit, because it is written down.
 *
 * So the rule, for anything added here later: **the middleware's matcher must land in the
 * same bucket as the route's, or an earlier one.** `/store/carts/:id/complete` works as a
 * params matcher because the route it guards is a params route too.
 *
 * Both actor types, because `/auth/user/emailpass` is the admin login and brute-forcing the
 * back office is a strictly better target than brute-forcing one customer.
 */
const authRateLimits = ['customer', 'user'].flatMap((actor) => [
  {
    // Ten wrong passwords a minute is generous for a person and useless to a script.
    method: ['POST'] as MiddlewareVerb[],
    matcher: `/auth/${actor}/emailpass`,
    middlewares: [rateLimit('auth-login', 10, 60_000)],
  },
  // Registration and the two password paths share one budget, because they are one abuse.
  // Reset in particular *sends an email* to an address the caller chose, which makes an
  // unlimited one a way to use this shop's domain to post mail at somebody.
  ...['register', 'reset-password', 'update'].map((action) => ({
    method: ['POST'] as MiddlewareVerb[],
    matcher: `/auth/${actor}/emailpass/${action}`,
    middlewares: [rateLimit('auth-credential', 5, 60_000)],
  })),
])

export default defineMiddlewares({
  errorHandler: (error, req, res, next) => {
    reportErrors(error as Error, req as MedusaRequest, res, next)
  },
  routes: [
    // '/*' covers everything user middleware can cover.
    //
    // Measured, because the first read of this was wrong: it looked as though built-in
    // /store and /admin routes were skipping the middleware entirely. They are not. User
    // middleware runs *after* the publishable-key and authentication gates, so a request
    // those gates reject never reaches it — /store/products without a key and
    // /admin/orders without a token get no request id, while the same paths with valid
    // credentials do. Listing '/store/*' and '/admin/*' explicitly changes nothing.
    //
    // That is acceptable: gate rejections are 4xx, which the error reporter deliberately
    // ignores anyway. It is documented because "the header is missing" otherwise reads as
    // a broken middleware rather than a request that was turned away at the door.
    { matcher: '/*', middlewares: [requestId] },
    {
      method: ['POST'],
      matcher: '/admin/media/upload',
      middlewares: [uploadImages],
      policies: can(RESOURCE.MEDIA, 'create'),
    },

    /**
     * Rate limits on routes Medusa owns.
     *
     * Every limit this application had was a guard inside one of its own handlers, which
     * left the five most valuable ones unprotected — because credential stuffing and card
     * testing both go through routes nobody here wrote. `defineMiddlewares` is the only
     * place a rule can be attached to somebody else's handler.
     *
     * These budgets are **per customer, not per storefront**, and that distinction is the
     * reason `INTERNAL_API_SECRET` exists. All of this traffic reaches the backend from the
     * Next server — the session token is httpOnly and never enters the browser — so before
     * the forwarded identity a limit here would have capped the whole shop rather than one
     * attacker. See `clientKey` in src/rate-limit.ts.
     *
     * The budgets are sized against what a *person* does, with room for a retry and a
     * mistyped password, not against what a load test does.
     */
    ...authRateLimits,
    {
      // The customer record, created with the JWT from registration. Limited separately
      // because a registration that stops halfway leaves an auth identity with no customer,
      // and retrying step two is a legitimate thing the storefront does.
      method: ['POST'],
      matcher: '/store/customers',
      middlewares: [rateLimit('customer-create', 5, 60_000)],
    },
    {
      // Cart creation writes a row per call and is otherwise free. Generous, because a
      // shopper legitimately gets a new cart on region switch and after completion.
      method: ['POST'],
      matcher: '/store/carts',
      middlewares: [rateLimit('cart-create', 30, 60_000)],
    },
    {
      /**
       * Card testing.
       *
       * The reason this limit exists is not our database — it is that a checkout which
       * accepts unlimited attempts is a free card-validity oracle, and Stripe charges for
       * every declined authorisation and eventually acts on the decline rate. A shop that
       * gets used this way finds out through its processor, not its logs.
       *
       * Payment session creation is where the PaymentIntent appears, so it is limited as
       * well as completion — refusing only at the end still lets somebody enumerate.
       */
      method: ['POST'],
      matcher: '/store/payment-collections/:id/payment-sessions',
      middlewares: [rateLimit('payment-session', 20, 60_000)],
    },

    // The one store route with two rules of ours on it. Medusa owns the handler; these run
    // first, and the order is deliberate — refusing a flood costs a lookup, checking the
    // phone number costs a query.
    {
      method: ['POST'],
      matcher: '/store/carts/:id/complete',
      middlewares: [rateLimit('cart-complete', 10, 60_000), requirePhoneAtCheckout],
    },

    /**
     * Authorisation, per route and per method.
     *
     * Medusa authenticates the whole `/admin` prefix at the router, which is why every route
     * in this application was already behind the login — and why none of them was behind
     * anything else. These are the missing half.
     *
     * **Read and write are separate entries on the same matcher**, because they are the
     * distinction the Staff role is built on: correcting a product's copy is daily work,
     * deleting it is not. Listing them by method rather than granting one policy per path is
     * what makes that expressible.
     *
     * A route with no entry here is authenticated and otherwise unrestricted, which is the
     * old behaviour — so anything added later is open until it appears in this list. That is
     * the wrong default and it is Medusa's, not ours; the test at the bottom of
     * `integration-tests/http/rbac.spec.ts` fails if an admin route is added without a
     * policy, which is the part that makes it hold.
     */

    // ---- catalogue: product records, their catalog fields, and their images
    { method: ['GET'], matcher: '/admin/jerseys', policies: can(RESOURCE.PRODUCT, 'read') },
    { method: ['POST'], matcher: '/admin/jerseys', policies: can(RESOURCE.PRODUCT, 'create') },
    { method: ['GET'], matcher: '/admin/jerseys/:id', policies: can(RESOURCE.PRODUCT, 'read') },
    { method: ['POST'], matcher: '/admin/jerseys/:id', policies: can(RESOURCE.PRODUCT, 'update') },
    { method: ['DELETE'], matcher: '/admin/jerseys/:id', policies: can(RESOURCE.PRODUCT, 'delete') },
    { method: ['GET'], matcher: '/admin/catalog', policies: can(RESOURCE.PRODUCT, 'read') },
    { method: ['POST'], matcher: '/admin/catalog/:id', policies: can(RESOURCE.PRODUCT, 'update') },
    { method: ['POST'], matcher: '/admin/catalog/bulk', policies: can(RESOURCE.PRODUCT, 'update') },
    { method: ['GET'], matcher: '/admin/custom', policies: can(RESOURCE.PRODUCT, 'read') },

    // ---- the image store itself, as distinct from the images on a product
    { method: ['GET'], matcher: '/admin/media', policies: can(RESOURCE.MEDIA, 'read') },
    { method: ['GET'], matcher: '/admin/media/orphans', policies: can(RESOURCE.MEDIA, 'read') },
    { method: ['DELETE'], matcher: '/admin/media/orphans', policies: can(RESOURCE.MEDIA, 'delete') },
    { method: ['GET'], matcher: '/admin/media/:sha', policies: can(RESOURCE.MEDIA, 'read') },
    { method: ['DELETE'], matcher: '/admin/media/:sha', policies: can(RESOURCE.MEDIA, 'delete') },

    // ---- curated collections
    { method: ['GET'], matcher: '/admin/curated-collections', policies: can(RESOURCE.COLLECTION, 'read') },
    { method: ['POST'], matcher: '/admin/curated-collections', policies: can(RESOURCE.COLLECTION, 'create') },
    { method: ['GET'], matcher: '/admin/curated-collections/:handle', policies: can(RESOURCE.COLLECTION, 'read') },
    { method: ['POST'], matcher: '/admin/curated-collections/:handle', policies: can(RESOURCE.COLLECTION, 'update') },
    { method: ['DELETE'], matcher: '/admin/curated-collections/:handle', policies: can(RESOURCE.COLLECTION, 'delete') },
    // Membership is an edit to the collection, not a delete of one: taking a product out of
    // Best Sellers is reversible in a way that deleting the collection is not.
    { method: ['POST', 'PUT', 'DELETE'], matcher: '/admin/curated-collections/:handle/products',
      policies: can(RESOURCE.COLLECTION, 'update') },

    // ---- reviews, first-party and imported
    { method: ['GET'], matcher: '/admin/reviews', policies: can(RESOURCE.REVIEW, 'read') },
    { method: ['POST'], matcher: '/admin/reviews/:id', policies: can(RESOURCE.REVIEW, 'update') },
    { method: ['DELETE'], matcher: '/admin/reviews/:id', policies: can(RESOURCE.REVIEW, 'delete') },
    { method: ['GET'], matcher: '/admin/store-reviews', policies: can(RESOURCE.REVIEW, 'read') },
    { method: ['POST'], matcher: '/admin/store-reviews/:id', policies: can(RESOURCE.REVIEW, 'update') },
    { method: ['DELETE'], matcher: '/admin/store-reviews/:id', policies: can(RESOURCE.REVIEW, 'delete') },

    // ---- returns
    { method: ['GET'], matcher: '/admin/return-requests', policies: can(RESOURCE.RETURN, 'read') },
    { method: ['POST'], matcher: '/admin/return-requests/:id', policies: can(RESOURCE.RETURN, 'update') },
    { method: ['DELETE'], matcher: '/admin/return-requests/:id', policies: can(RESOURCE.RETURN, 'delete') },

    // ---- contact and newsletter
    { method: ['GET'], matcher: '/admin/inbound-messages', policies: can(RESOURCE.INBOX, 'read') },
    { method: ['GET'], matcher: '/admin/inbound-messages/:id', policies: can(RESOURCE.INBOX, 'read') },
    { method: ['POST'], matcher: '/admin/inbound-messages/:id', policies: can(RESOURCE.INBOX, 'update') },
    { method: ['DELETE'], matcher: '/admin/inbound-messages/:id', policies: can(RESOURCE.INBOX, 'delete') },

    // ---- sourcing queue
    { method: ['GET'], matcher: '/admin/jersey-requests', policies: can(RESOURCE.JERSEY_REQUEST, 'read') },
    { method: ['POST'], matcher: '/admin/jersey-requests/:id', policies: can(RESOURCE.JERSEY_REQUEST, 'update') },
    { method: ['DELETE'], matcher: '/admin/jersey-requests/:id', policies: can(RESOURCE.JERSEY_REQUEST, 'delete') },
    // Notifying a demand group is working the queue, which is Staff's job — it closes the
    // requests it notifies, so it is an update rather than anything destructive.
    { method: ['POST'], matcher: '/admin/jersey-requests/notify', policies: can(RESOURCE.JERSEY_REQUEST, 'update') },

    // ---- what gets printed on a shirt
    { method: ['GET'], matcher: '/admin/personalisations', policies: can(RESOURCE.PERSONALISATION, 'read') },
    { method: ['POST'], matcher: '/admin/personalisations/:id', policies: can(RESOURCE.PERSONALISATION, 'update') },

    // ---- orders and money
    { method: ['GET'], matcher: '/admin/abandoned-carts', policies: can(RESOURCE.ORDER, 'read') },
    { method: ['POST'], matcher: '/admin/abandoned-carts/:id/recover', policies: can(RESOURCE.ORDER, 'update') },
    { method: ['GET'], matcher: '/admin/reports/overview', policies: can(RESOURCE.ORDER, 'read') },

    // ---- which keys are set, and which are missing
    { method: ['GET'], matcher: '/admin/integrations', policies: can(RESOURCE.INTEGRATION, 'read') },

    // ---- who at the shop gets told. Owner only: these addresses receive customer data.
    { method: ['GET'], matcher: '/admin/notification-recipients', policies: can(RESOURCE.NOTIFICATION, 'read') },
    { method: ['POST'], matcher: '/admin/notification-recipients', policies: can(RESOURCE.NOTIFICATION, 'create') },
    { method: ['GET'], matcher: '/admin/notification-recipients/:id', policies: can(RESOURCE.NOTIFICATION, 'read') },
    { method: ['POST'], matcher: '/admin/notification-recipients/:id', policies: can(RESOURCE.NOTIFICATION, 'update') },
    { method: ['DELETE'], matcher: '/admin/notification-recipients/:id', policies: can(RESOURCE.NOTIFICATION, 'delete') },

    // ---- switches for the automatic customer emails. Owner only for the same reason the
    // recipient list is: turning off order confirmations is not a daily-work decision.
    { method: ['GET'], matcher: '/admin/settings', policies: can(RESOURCE.NOTIFICATION, 'read') },
    { method: ['POST'], matcher: '/admin/settings/:key', policies: can(RESOURCE.NOTIFICATION, 'update') },

    // ---- subject access and erasure. Owner only: `read` here means every customer at once.
    { method: ['GET'], matcher: '/admin/privacy/subject', policies: can(RESOURCE.PRIVACY, 'read') },
    { method: ['DELETE'], matcher: '/admin/privacy/subject', policies: can(RESOURCE.PRIVACY, 'delete') },

    /**
     * Customers.
     *
     * Two permissions on one screen, and the split is the point. Staff can read the list —
     * finding a person is how they answer a question about an order. The CSV is
     * `privacy:read`, owner-only, because a file containing every customer's name, address,
     * phone and email is the same act subject access is gated for.
     *
     * The static `/admin/customers/export` entry is listed **before** the params entry it
     * would otherwise fall through to. Both are static here, so the sorter keeps insertion
     * order — but the shape of the mistake is the one Step 39 records, and being explicit
     * costs a line.
     */
    { method: ['GET'], matcher: '/admin/customer-list/export', policies: can(RESOURCE.PRIVACY, 'read') },
    { method: ['GET'], matcher: '/admin/customer-list', policies: can(RESOURCE.CUSTOMER, 'read') },

    /**
     * The order register, split the same way.
     *
     * Reading it is `order:read`, which Staff already has for the revenue report — working
     * the queue is what Staff is for. The export is `privacy:read` because a register carries
     * every customer's name, address and phone number: the same personal data the customer
     * export does, arranged differently. Gating it any lower would give the bulk extract this
     * shop is careful about a second door with a weaker lock.
     */
    { method: ['GET'], matcher: '/admin/order-list/export', policies: can(RESOURCE.PRIVACY, 'read') },
    { method: ['GET'], matcher: '/admin/order-list', policies: can(RESOURCE.ORDER, 'read') },
  ],
})
