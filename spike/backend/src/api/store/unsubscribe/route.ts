import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { limited } from '../../../rate-limit'
import { addressFromToken, isSuppressed, suppress } from '../../../suppression'
import { maskEmail } from '../../../privacy'

/**
 * Unsubscribe, from a link in an email.
 *
 * Two callers with different needs, which is why both verbs exist:
 *
 *  - **A person clicking the link.** The storefront page `GET`s to confirm the token is real
 *    and show whose address it is, then `POST`s when they confirm. Two steps, because a
 *    link-scanner in a corporate mail gateway follows every URL in an email and would
 *    otherwise unsubscribe people who never opened it.
 *  - **A mail provider.** RFC 8058 one-click: Gmail and Yahoo `POST` to the
 *    `List-Unsubscribe` URL with `List-Unsubscribe=One-Click` and expect it to work with no
 *    further interaction. That is the same `POST`, which is why it takes the token from the
 *    query string as well as the body.
 *
 * Unauthenticated by necessity — the whole point is that it works from an email without
 * logging in — and safe because the token is an HMAC over the address. Somebody can
 * unsubscribe themselves and nobody else.
 */
const tokenFrom = (req: MedusaRequest): string =>
  String(
    (req.query.token as string) ??
    ((req.body ?? {}) as { token?: string }).token ??
    ''
  ).trim()

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (await limited(req, res, 'unsubscribe', 20, 60_000)) return

  const email = addressFromToken(tokenFrom(req))
  if (!email) {
    return res.status(400).json({
      valid: false,
      message: 'That link is not valid. It may have been altered in transit.',
    })
  }

  res.json({
    valid: true,
    // Masked. The page only has to show enough for somebody to recognise their own address,
    // and a full one in a URL-driven response is a small disclosure for no benefit.
    email: maskEmail(email),
    already: await isSuppressed(req.scope as never, email),
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (await limited(req, res, 'unsubscribe', 20, 60_000)) return

  const email = addressFromToken(tokenFrom(req))
  if (!email) {
    return res.status(400).json({
      ok: false,
      message: 'That link is not valid. It may have been altered in transit.',
    })
  }

  await suppress(req.scope as never, email, 'unsubscribe-link')

  // Deliberately the same answer whether they were on a list or not, and whether or not this
  // was the second click. "You were not subscribed" is both unhelpful and a way to test
  // whether an address is known to us.
  res.json({
    ok: true,
    message: 'Done. You will not receive marketing email from us.',
  })
}
