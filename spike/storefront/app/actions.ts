'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import * as cart from '@/lib/cart'
import { REGION_COOKIE } from '@/lib/region'
import { getRegions } from '@/lib/medusa'

export async function addToCartAction(variantId: string) {
  await cart.addLine(variantId, 1)
  revalidatePath('/cart')
  revalidatePath('/', 'layout')
}

export async function addPersonalisedAction(
  variantId: string,
  productId: string,
  sel: { name: string | null; number: string | null; patch: string | null; preview?: string },
  // Whether the printing is included in the shirt's price (a custom jersey). Comes from the
  // server's own offer payload; the attach endpoint verifies it against the product again.
  opts: { included?: boolean } = {}
) {
  const result = await cart.addPersonalisedLine(variantId, productId, sel, opts)
  revalidatePath('/cart')
  revalidatePath('/', 'layout')
  // Returned rather than thrown: the shirt is in the bag either way, and the buy box needs
  // to say so honestly instead of showing a generic failure over a successful add.
  return result
}

export async function setQtyAction(lineId: string, quantity: number) {
  await cart.setQty(lineId, quantity)
  revalidatePath('/cart')
  revalidatePath('/', 'layout')
}

export async function removeLineAction(lineId: string) {
  await cart.removeLine(lineId)
  revalidatePath('/cart')
  revalidatePath('/', 'layout')
}

/**
 * Apply a discount code.
 *
 * Returns the outcome instead of throwing. An invalid code is the expected case: the cart is
 * still valid, the rest of the page must stay on screen, and the customer needs to be told
 * which code failed rather than shown an error page.
 */
export async function applyPromoAction(code: string) {
  const result = await cart.applyPromo(code)
  revalidatePath('/cart')
  revalidatePath('/checkout')
  revalidatePath('/', 'layout')
  return result
}

export async function removePromoAction(code: string) {
  await cart.removePromo(code)
  revalidatePath('/cart')
  revalidatePath('/checkout')
  revalidatePath('/', 'layout')
}

/**
 * Switch region.
 *
 * Two writes, and both are required. The cookie steers every catalog query and the shipping
 * zone; moving the existing cart is what stops a Canada-shopping visitor arriving at checkout
 * with a cart still pinned to the US region, where the region-scoped shipping options do not
 * apply and the cart cannot be fulfilled.
 *
 * The id is validated against the live region list before it is stored. Accepting an
 * arbitrary string here would put it into `region_id` on every subsequent request, where it
 * produces empty listings and a cart that will not create — a failure that reads as the
 * backend being down.
 */
export async function setRegionAction(regionId: string) {
  const regions = await getRegions()
  if (!regions.some((r) => r.id === regionId)) {
    return { ok: false as const, message: 'That is not a region we ship to.' }
  }

  ;(await cookies()).set(REGION_COOKIE, regionId, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
  })
  await cart.setCartRegion(regionId)

  revalidatePath('/', 'layout')
  revalidatePath('/cart')
  revalidatePath('/jerseys')
  return { ok: true as const }
}

export async function setCustomerAction(form: FormData) {
  const email = String(form.get('email') ?? '')
  const address = {
    first_name: String(form.get('first_name') ?? ''),
    last_name: String(form.get('last_name') ?? ''),
    address_1: String(form.get('address_1') ?? ''),
    city: String(form.get('city') ?? ''),
    province: String(form.get('province') ?? ''),
    postal_code: String(form.get('postal_code') ?? ''),
    // Was hardcoded 'us'. Every non-US order that reached checkout was therefore labelled
    // as domestic — wrong on the customs declaration, wrong for tax, and invisible because
    // the storefront only offered one region anyway.
    country_code: String(form.get('country_code') ?? 'us').toLowerCase(),
    // Carriers use it when a delivery goes wrong, and on a made-to-order shirt an
    // undeliverable parcel is a total loss rather than restock. Whether it is required is a
    // setting; whether it is *sent* is not — an optional number still belongs on the label.
    phone: String(form.get('phone') ?? '').trim(),
  }
  await cart.setCustomer(email, address)
  const options = await cart.shippingOptions()
  if (options[0]) await cart.setShipping(options[0].id)
  revalidatePath('/checkout')
  redirect('/checkout?step=payment')
}

export async function completeAction() {
  const res = await cart.completeCart()
  if (res.ok && res.orderId) redirect(`/order/${res.orderId}`)
  return res
}
