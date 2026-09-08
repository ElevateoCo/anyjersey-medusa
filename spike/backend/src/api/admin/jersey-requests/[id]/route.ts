import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../../../../modules/catalog'
import { productUrl } from '../../../../request-notify'

const STATUSES = ['new', 'sourcing', 'quoted', 'fulfilled', 'declined']

/** POST /admin/jersey-requests/:id — move a request through the queue. */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)
  const body = (req.body ?? {}) as { status?: string; notes?: string; product_id?: string }

  if (body.status && !STATUSES.includes(body.status)) {
    return res.status(400).json({ message: `status must be one of ${STATUSES.join(', ')}` })
  }

  const [before] = await catalog.listJerseyRequests({ id: req.params.id }, { take: 1 })

  const [updated] = await catalog.updateJerseyRequests([
    {
      id: req.params.id,
      ...(body.status ? { status: body.status } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
  ])
  // Tell the customer when a request actually gets sourced — the moment the whole
  // mechanic exists for (research.md §12.1). Only on the transition, never on a re-save.
  if (body.status === 'fulfilled' && before?.status !== 'fulfilled') {
    try {
      /**
       * The link is the point of the message, and it was never being sent.
       *
       * `request-sourced` renders a "View it" button when it is given a `url`, and nothing
       * passed one — so the one email whose entire job is to turn a sourcing request into a
       * purchase arrived with no way to purchase. Optional here rather than required, because
       * a request can legitimately be fulfilled by a shirt that is not in the catalogue; pass
       * `product_id` and the customer gets somewhere to go.
       */
      let url: string | null = null
      let productTitle: string | undefined
      if (body.product_id) {
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: 'product',
          fields: ['id', 'title', 'handle', 'status'],
          filters: { id: body.product_id } as any,
        })
        const product = (data as any[])[0]
        if (product?.status === 'published') {
          url = productUrl(product.handle)
          productTitle = product.title
        }
      }

      const notification = req.scope.resolve(Modules.NOTIFICATION)
      await notification.createNotifications({
        to: updated.email,
        channel: 'email',
        template: 'request-sourced',
        data: {
          raw_request: updated.raw_request,
          team: updated.team,
          player: updated.player,
          size_code: updated.size_code,
          ...(productTitle ? { product_title: productTitle } : {}),
          ...(url ? { url } : {}),
        },
      })
    } catch (e) {
      req.scope.resolve('logger').error(
        `request-sourced email failed: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  res.json({ request: updated })
}

/**
 * DELETE /admin/jersey-requests/:id — erasure.
 *
 * A request row is an email address plus a free-text description a stranger typed, held
 * indefinitely with no expiry. It is the second-most likely target of an erasure request
 * after the contact inbox, and there was no way to action one.
 *
 * Hard delete for the same reason as the inbox: a soft-deleted row still holds the address.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const catalog: any = req.scope.resolve(CATALOG_MODULE)

  const [existing] = await catalog.listJerseyRequests({ id: req.params.id }, { take: 1 })
  if (!existing) {
    return res.status(404).json({ message: 'No such request.' })
  }

  await catalog.deleteJerseyRequests([req.params.id])
  res.json({ id: req.params.id, deleted: true })
}
