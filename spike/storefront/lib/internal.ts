import { headers } from 'next/headers'

/**
 * Speaking to the backend on a customer's behalf.
 *
 * Almost nothing this storefront does reaches the backend from the browser. The session
 * token is httpOnly and never enters client JavaScript (see `lib/account.ts`), so every
 * authenticated call is made here; so is every cart mutation and the whole of checkout. From
 * the backend's side those requests all arrive on one socket from one address.
 *
 * That is fine until the backend tries to rate-limit them. A per-IP budget on login or cart
 * completion, applied to traffic that has one IP, is not a limit on an attacker — it is a
 * global cap on the shop, and the first busy hour is when everyone discovers it. The failure
 * is a 429 on checkout for customers who did nothing wrong.
 *
 * So the request states whose it is, and proves it may. `x-client-ip` carries the address;
 * `INTERNAL_API_SECRET` is what makes the backend believe it. `x-forwarded-for` cannot do
 * this job: a proxy in front of the backend overwrites it — that is precisely what makes it
 * trustworthy there — and the backend is directly reachable by the browser components
 * anyway, so a header any caller can set is not an identity.
 *
 * **Server-only.** `INTERNAL_API_SECRET` has no `NEXT_PUBLIC_` prefix deliberately: shipping
 * it to the browser would hand every visitor the ability to claim any address they like, and
 * with it the ability to step around every limit the backend has.
 */
export async function forwardedIdentity(): Promise<Record<string, string>> {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) return {}

  try {
    const h = await headers()
    // The first entry is the one our own edge wrote; later ones are whatever the client
    // sent. `x-real-ip` is the fallback for proxies that set it instead.
    const ip =
      (h.get('x-forwarded-for') ?? '').split(',')[0].trim() ||
      (h.get('x-real-ip') ?? '').trim()

    if (!ip) return { 'x-internal-secret': secret }
    return { 'x-internal-secret': secret, 'x-client-ip': ip }
  } catch {
    // `headers()` throws outside a request — a background revalidation, a build-time render.
    // There is no customer to name in that case, and the backend treats an unnamed internal
    // call as one caller, which is correct.
    return {}
  }
}
