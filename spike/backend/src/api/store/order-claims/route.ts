import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { requestOrderTransferWorkflow } from '@medusajs/medusa/core-flows'
import { limited } from '../../../rate-limit'

/**
 * POST /store/order-claims  { email, order_number }
 *
 * Start attaching a guest order to the signed-in account.
 *
 * **The order id never leaves the server**, and that is the reason this endpoint exists at
 * all rather than the storefront calling Medusa's transfer route directly. That route needs
 * an order id; the only way a customer could get one is from `/store/order-lookup`, which
 * deliberately returns no internal ids — "only fields the customer already knows". Adding the
 * id there to make this work would have quietly undone that decision for every caller.
 *
 * So the lookup and the request happen here, in one call, and nothing identifying comes back.
 *
 * Three things make it safe, and all three are needed:
 *
 *   1. **Signed in.** An anonymous caller cannot start a claim, so there is always an account
 *      the order would move to and always somebody to name in the confirmation email.
 *   2. **Email and order number**, checked together, with the same generic refusal and the
 *      same delay as the public lookup. Guessing order numbers yields nothing.
 *   3. **The confirmation goes to the address on the order**, not to the account asking.
 *      That is the part that actually stops a theft: knowing somebody's order number and
 *      email is not enough, because the link lands in *their* inbox.
 */
const DENY = { message: 'No order matches that number and email.' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // Tighter than the public lookup's ten: this one is authenticated, so a caller working
  // through numbers has already identified themselves and has less reason to be doing it.
  if (await limited(req, res, 'order-claims', 6, 60_000)) return

  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ message: 'Sign in first, then add the order.' })
  }

  const body = (req.body ?? {}) as { email?: string; order_number?: string | number }
  const email = String(body.email ?? '').trim().toLowerCase()
  const raw = String(body.order_number ?? '').trim().replace(/^#/, '')
  const orderNumber = Number(raw)

  if (!email || !raw || !Number.isFinite(orderNumber)) {
    return res.status(400).json({
      message: 'Both an order number and the email used to order are required.',
    })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: 'order',
    fields: ['id', 'email', 'display_id', 'customer_id', 'customer.has_account'],
    filters: { display_id: orderNumber } as any,
  }).catch(() => ({ data: [] as any[] }))

  const order = (orders as any[])[0]

  // One refusal for every failure — wrong number, wrong email, already claimed — with a
  // delay, so neither the body nor the timing distinguishes them.
  if (!order || String(order.email ?? '').toLowerCase() !== email) {
    await sleep(400)
    return res.status(404).json(DENY)
  }

  if (order.customer_id === customerId) {
    return res.json({ requested: false, message: 'That order is already on your account.' })
  }

  /**
   * "Guest order" does not mean "no customer".
   *
   * Medusa creates a customer record for every checkout email, so an order placed without an
   * account still carries a `customer_id` — of a customer whose `has_account` is false. An
   * ownership check on `customer_id` alone therefore refuses every genuine guest order, which
   * is exactly what the first version of this did and what the test caught.
   *
   * The real question is whether the order already belongs to somebody who can sign in. If it
   * does, it is not claimable by anyone else, and the refusal is the same generic one so that
   * "already owned" cannot be distinguished from "does not exist".
   */
  const customer = Array.isArray((order as any).customer)
    ? (order as any).customer[0]
    : (order as any).customer
  if (customer?.has_account) {
    await sleep(400)
    return res.status(404).json(DENY)
  }

  await requestOrderTransferWorkflow(req.scope).run({
    input: {
      order_id: order.id,
      customer_id: customerId,
      description: 'Requested from the account area',
    } as any,
  })

  res.json({
    requested: true,
    // Said explicitly, because the whole security model is that the email goes somewhere
    // other than where the request came from, and a customer who does not know that will
    // wait for a message that is not coming.
    message:
      'Check the inbox for the address on that order. We have sent a confirmation link ' +
      'there, not to the account you are signed in to.',
  })
}
