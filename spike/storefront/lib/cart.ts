import { cookies } from 'next/headers'
import { getRegionId } from './region'
import { forwardedIdentity } from './internal'

const BASE = process.env.NEXT_PUBLIC_MEDUSA_URL ?? 'http://localhost:9000'
const PK = process.env.NEXT_PUBLIC_MEDUSA_PK ?? ''
const COOKIE = 'aj_cart'

/**
 * Shipping rate and free-shipping threshold, read from the backend.
 *
 * research.md §9.1: a 20% discount code gives away $13.00 and raises the effective card
 * rate, because the fixed $0.30 does not shrink. Free shipping over a threshold costs
 * the freight and protects the processed amount.
 *
 * These used to be hardcoded here as $4.99 / $75, which was correct only for the US and
 * silently wrong for every other zone — the cart promised free shipping over $75 on an
 * order that actually costs $24.99 to ship. Now there is one source of truth
 * (backend src/shipping-zones.ts) and the cart asks for it.
 */
export type Zone = {
  zone: number; name: string; rate: number; freeOver: number; leadTime: string
}

export async function getZone(regionId?: string): Promise<Zone | null> {
  // Defaults to the *chosen* region, not the env default. Reading REGION_ID here was the
  // reason a visitor who switched to Canada still saw the US rate and the US threshold in
  // the cart — the same class of bug as hardcoding $4.99, one layer up.
  const id = regionId ?? (await getRegionId())
  try {
    const res = await fetch(`${BASE}/store/shipping-zones?region_id=${id}`, {
      headers: { 'x-publishable-api-key': PK },
      next: { revalidate: 300 },
    })
    if (!res.ok) return null
    return (await res.json()).zone as Zone
  } catch {
    return null
  }
}

export type Line = {
  id: string; title: string; quantity: number; unit_price: number; subtotal: number
  thumbnail: string | null; variant_sku?: string | null
  variant?: { id: string; title: string; sku: string; product?: { handle: string; title: string } } | null
}
export type Promotion = {
  id: string
  code: string | null
  is_automatic?: boolean
  application_method?: { type?: string; value?: number; currency_code?: string } | null
}
export type Cart = {
  id: string; email: string | null; currency_code: string; region_id?: string
  items: Line[]
  promotions?: Promotion[]
  subtotal: number; shipping_total: number; tax_total: number; total: number
  discount_total?: number
  shipping_address?: Record<string, unknown> | null
  shipping_methods?: { id: string; name: string; amount: number }[]
  payment_collection?: {
    id: string
    payment_sessions?: { id: string; provider_id: string; data?: { client_secret?: string } }[]
  } | null
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Every call through here is request-scoped and `no-store`, which is what makes it
  // safe to name the customer: the header never becomes part of a shared cache key.
  const identity = await forwardedIdentity()
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PK,
      ...identity,
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${body.slice(0, 300)}`)
  return (body ? JSON.parse(body) : {}) as T
}

const FIELDS =
  '*items,*items.variant,*items.variant.product,*shipping_methods,*payment_collection,' +
  // `+discount_total`, and the `+` is the entire point.
  //
  // Written as a bare `discount_total`, this list stopped being "the defaults plus these
  // relations" and became "only these fields" — so `subtotal`, `shipping_total` and `total`
  // vanished from every cart response. The cart page rendered a $0.00 subtotal above a
  // $4.99 total while the API, asked without the field, still said $64.99. Nothing threw.
  //
  // This is the trap the README already records one layer down: computed fields do not
  // resolve when requested individually, and they fail as zeros rather than as errors. `+`
  // means "in addition to the defaults", the same way the product query uses
  // `+jersey_detail.*`. Pinned by a test in lib/cart-fields.test.ts.
  '*payment_collection.payment_sessions,*promotions,+discount_total'

export async function getCartId(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null
}

export async function getCart(): Promise<Cart | null> {
  const id = await getCartId()
  if (!id) return null
  try {
    const { cart } = await api<{ cart: Cart }>(`/store/carts/${id}?fields=${FIELDS}`)
    return cart
  } catch {
    return null // stale cookie — treated as empty rather than an error page
  }
}

export async function ensureCart(): Promise<Cart> {
  const existing = await getCart()
  if (existing) return existing
  const { cart } = await api<{ cart: Cart }>('/store/carts', {
    method: 'POST',
    body: JSON.stringify({ region_id: await getRegionId() }),
  })
  ;(await cookies()).set(COOKIE, cart.id, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
  })
  return cart
}

export const addLine = async (variantId: string, quantity = 1) => {
  const cart = await ensureCart()
  await api(`/store/carts/${cart.id}/line-items`, {
    method: 'POST',
    // Only variant id and quantity. The price is the server's — research.md §5.2 rule 1.
    body: JSON.stringify({ variant_id: variantId, quantity }),
  })
}

/**
 * Add a shirt with personalisation.
 *
 * Three server calls, in this order, and the order is the whole design:
 *
 *   1. add the shirt line
 *   2. add the matching add-on variant, so the price comes from the pricing engine rather
 *      than from the browser (research.md §5.2 rule 1 — a client that can name a price can
 *      name $0.01)
 *   3. attach the parameters, which re-validates everything from scratch server-side and
 *      refuses if the add-on tier in the cart does not match what is being requested
 *
 * If step 3 fails, steps 1 and 2 are rolled back — the add-on line is removed and the shirt
 * is left plain. The alternative is a cart charging $19.99 for printing that no queue will
 * ever see, which is strictly worse than not selling the personalisation.
 */
export const addPersonalisedLine = async (
  variantId: string,
  productId: string,
  sel: { name: string | null; number: string | null; patch: string | null; preview?: string },
  /**
   * True for a custom jersey, where the printing is already inside the shirt's own price.
   *
   * Read from the server's offer, never decided here — the attach endpoint re-reads
   * `is_custom` from the product, so a client claiming a shirt is custom to get free
   * printing is refused there rather than trusted here.
   */
  opts: { included?: boolean } = {}
) => {
  const cart = await ensureCart()

  const before = new Set(((await getCart())?.items ?? []).map((i: any) => i.id))
  await api(`/store/carts/${cart.id}/line-items`, {
    method: 'POST',
    body: JSON.stringify({ variant_id: variantId, quantity: 1 }),
  })

  let addonVariant: string | null = null
  if (!opts.included) {
    // Step 2 of the three-call dance, and only on a shirt that has to be charged for. A
    // custom jersey has nothing to add: inventing a $0 add-on product to keep the shape
    // symmetrical would put a zero-priced line in the cart, on the order, and on the
    // invoice, for no reason.
    const tier = tierFor(sel)
    addonVariant = await personalisationVariant(tier)
    if (!addonVariant) {
      // No add-on product seeded: sell the plain shirt rather than failing the whole add.
      return { personalised: false as const, reason: 'add-on product not configured' }
    }
    await api(`/store/carts/${cart.id}/line-items`, {
      method: 'POST',
      body: JSON.stringify({ variant_id: addonVariant, quantity: 1 }),
    })
  }

  const after = ((await getCart())?.items ?? []) as any[]
  const fresh = after.filter((i) => !before.has(i.id))
  const shirtLine = fresh.find((i) => i.variant_id === variantId)
  const addonLine = addonVariant
    ? fresh.find((i) => i.variant_id === addonVariant)
    : undefined

  try {
    await api('/store/personalisation/attach', {
      method: 'POST',
      body: JSON.stringify({
        cart_id: cart.id,
        line_id: shirtLine?.id,
        addon_line_id: addonLine?.id ?? null,
        product_id: productId,
        name: sel.name,
        number: sel.number,
        patch: sel.patch,
        preview: sel.preview,
      }),
    })
    return { personalised: true as const }
  } catch (e) {
    // Roll back only what was added for the personalisation. On a custom shirt there is no
    // add-on line, and the shirt itself stays in the bag — it is a real product the
    // customer chose, just without printing on it.
    if (addonLine?.id) await removeLine(addonLine.id)
    return { personalised: false as const, reason: (e as Error).message }
  }
}

/** The bundle is implicit: choosing both is one tier, never two lines. */
const tierFor = (sel: { name: string | null; number: string | null; patch: string | null }) => {
  if (sel.patch && !sel.name && !sel.number) return 'PATCH'
  if (sel.name && sel.number) return 'BUNDLE'
  if (sel.name) return 'NAME'
  return 'NUMBER'
}

let addonVariants: Record<string, string> | null = null
async function personalisationVariant(tier: string): Promise<string | null> {
  if (!addonVariants) {
    const id = process.env.PERSONALISATION_PRODUCT_ID
    if (!id) return null
    // The add-on product is a draft and outside every collection, so it is fetched by id
    // rather than found by browsing — it must never appear in the catalogue.
    const { product } = await api<{ product: { variants: { id: string; sku: string }[] } }>(
      `/store/products/${id}`
    ).catch(() => ({ product: null as any }))
    if (!product) return null
    addonVariants = Object.fromEntries(
      product.variants.map((v: { id: string; sku: string }) =>
        [String(v.sku).replace('PERS-', ''), v.id])
    )
  }
  return addonVariants[tier] ?? null
}

export const setQty = async (lineId: string, quantity: number) => {
  const id = await getCartId()
  if (!id) return
  if (quantity <= 0) return removeLine(lineId)
  await api(`/store/carts/${id}/line-items/${lineId}`, {
    method: 'POST', body: JSON.stringify({ quantity }),
  })
}

export const removeLine = async (lineId: string) => {
  const id = await getCartId()
  if (!id) return
  await api(`/store/carts/${id}/line-items/${lineId}`, { method: 'DELETE' })
}

/**
 * Apply a discount code.
 *
 * `POST /store/carts/:id/promotions` with `promo_codes`, which is the only path — the price
 * is recalculated by Medusa's promotion engine, and the storefront never computes a
 * discount. Same rule as line prices (research.md §5.2 rule 1): a client that can name a
 * discount can name 100%.
 *
 * Errors are returned rather than thrown. An invalid code is the expected case, not an
 * exception, and the cart page has to say *which* code failed while keeping the rest of the
 * page intact.
 *
 * research.md §9.1 is worth remembering before creating any of these: the fixed $0.30 does
 * not shrink with a discount, so a 20% code lifts the effective card rate from 3.33% to
 * 3.43% on top of the $13.00 it gives away. Free-shipping thresholds are the preferred
 * mechanic, and this exists for the codes that are worth making an exception for.
 */
export const applyPromo = async (
  code: string
): Promise<{ ok: true } | { ok: false; message: string }> => {
  const id = await getCartId()
  if (!id) return { ok: false, message: 'Your bag is empty.' }
  const trimmed = code.trim()
  if (!trimmed) return { ok: false, message: 'Enter a code.' }
  try {
    await api(`/store/carts/${id}/promotions`, {
      method: 'POST',
      body: JSON.stringify({ promo_codes: [trimmed] }),
    })
    // Medusa accepts an unknown code without error rather than rejecting it, so "applied"
    // has to be verified by reading the cart back. Reporting success on the request alone
    // shows a code as accepted while the total never moves — the worst of both outcomes.
    const cart = await getCart()
    const applied = (cart?.promotions ?? []).some(
      (p) => (p.code ?? '').toLowerCase() === trimmed.toLowerCase()
    )
    if (!applied) return { ok: false, message: `“${trimmed}” is not a valid code.` }
    return { ok: true }
  } catch (e) {
    const raw = e instanceof Error ? e.message : ''
    // Medusa's message names the code and the reason; anything else is not worth surfacing.
    return {
      ok: false,
      message: /not\s*found|invalid|expired|no longer/i.test(raw)
        ? `“${trimmed}” is not a valid code.`
        : 'That code could not be applied.',
    }
  }
}

export const removePromo = async (code: string) => {
  const id = await getCartId()
  if (!id) return
  await api(`/store/carts/${id}/promotions`, {
    method: 'DELETE',
    body: JSON.stringify({ promo_codes: [code] }),
  }).catch(() => {})
}

/**
 * Move an existing cart to a different region.
 *
 * Called after the region cookie changes. Without it, a visitor who switches to Canada keeps
 * a cart pinned to the US region, and the mismatch surfaces at checkout as an unfulfillable
 * cart rather than as a wrong rate — the shipping options are region-scoped.
 *
 * Failure is swallowed on purpose: the cookie has already changed and the catalog will
 * follow it. A cart that could not be moved is a worse outcome than a silent one only if the
 * customer is not told, and the cart page reads the region off the cart itself.
 */
export const setCartRegion = async (regionId: string) => {
  const id = await getCartId()
  if (!id) return
  await api(`/store/carts/${id}`, {
    method: 'POST',
    body: JSON.stringify({ region_id: regionId }),
  }).catch(() => {})
}

export const setCustomer = async (email: string, address: Record<string, string>) => {
  const id = await getCartId()
  if (!id) throw new Error('no cart')
  await api(`/store/carts/${id}`, {
    method: 'POST',
    body: JSON.stringify({ email, shipping_address: address, billing_address: address }),
  })
}

/**
 * What the checkout form should ask for.
 *
 * Defaults to requiring a phone number when the call fails, matching the server's own
 * fail-open direction — a form that asks for one field too many during an outage is better
 * than one that lets somebody through to a completion the server will refuse.
 */
export const checkoutSettings = async (): Promise<{ phone_required: boolean }> => {
  const data = await api<{ phone_required: boolean }>('/store/checkout-settings')
    .catch(() => null)
  return { phone_required: data?.phone_required ?? true }
}

export const shippingOptions = async () => {
  const id = await getCartId()
  if (!id) return []
  const { shipping_options } = await api<{ shipping_options: { id: string; name: string; amount: number }[] }>(
    `/store/shipping-options?cart_id=${id}`
  )
  return shipping_options ?? []
}

export const setShipping = async (optionId: string) => {
  const id = await getCartId()
  if (!id) throw new Error('no cart')
  await api(`/store/carts/${id}/shipping-methods`, {
    method: 'POST', body: JSON.stringify({ option_id: optionId }),
  })
}

/** Creates a PaymentIntent through Medusa's Stripe provider and returns its secret. */
export async function initPayment(): Promise<string | null> {
  const cart = await getCart()
  if (!cart) throw new Error('no cart')
  let collectionId = cart.payment_collection?.id
  if (!collectionId) {
    const { payment_collection } = await api<{ payment_collection: { id: string } }>(
      '/store/payment-collections', { method: 'POST', body: JSON.stringify({ cart_id: cart.id }) }
    )
    collectionId = payment_collection.id
  }
  const { payment_collection } = await api<{
    payment_collection: { payment_sessions?: { data?: { client_secret?: string } }[] }
  }>(`/store/payment-collections/${collectionId}/payment-sessions`, {
    method: 'POST', body: JSON.stringify({ provider_id: 'pp_stripe_stripe' }),
  })
  return payment_collection.payment_sessions?.[0]?.data?.client_secret ?? null
}

export async function completeCart(): Promise<{ ok: boolean; orderId?: string; message?: string }> {
  const id = await getCartId()
  if (!id) return { ok: false, message: 'no cart' }
  try {
    const res = await api<{ type?: string; order?: { id: string } }>(
      `/store/carts/${id}/complete`, { method: 'POST' }
    )
    if (res.order?.id) {
      ;(await cookies()).delete(COOKIE)
      return { ok: true, orderId: res.order.id }
    }
    return { ok: false, message: 'cart did not complete' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'failed' }
  }
}

export async function getOrder(id: string) {
  const { order } = await api<{ order: Record<string, any> }>(
    `/store/orders/${id}?fields=*items,*items.variant,*shipping_methods`
  )
  return order
}
