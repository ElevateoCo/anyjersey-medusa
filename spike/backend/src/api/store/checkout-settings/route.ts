import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { isSettingEnabled } from '../../../settings'

/**
 * GET /store/checkout-settings — what the checkout form should ask for.
 *
 * Public, and it discloses nothing: whether a phone number is required is visible to anybody
 * who opens the checkout anyway. The form reads it so the `required` attribute matches what
 * the server will actually enforce — a field marked optional that then blocks completion is
 * worse than either state on its own.
 *
 * This is presentation only. The rule itself lives in the middleware on
 * `/store/carts/:id/complete`, and the form agreeing with it is a convenience rather than
 * the enforcement.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.json({
    phone_required: await isSettingEnabled(req.scope as never, 'phone_required'),
  })
}
