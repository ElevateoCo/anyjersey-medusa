import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

/**
 * Move stored image URLs from the old /store/media prefix to /media.
 *
 * Written because the media route had to leave the /store namespace: /store is gated on
 * the x-publishable-api-key header and an `<img src>` cannot send a header, so every one
 * of the 4,825 URLs already written to the database pointed at an endpoint that returns
 * 400 to a browser.
 *
 * Raw SQL rather than updateProductsWorkflow: this is a prefix swap on a text column with
 * nothing derived from it, and running 3,155 products through the workflow to change one
 * string would take minutes and emit 3,155 product-updated events for no reason. Both
 * statements are idempotent — the LIKE guard means a second run touches nothing.
 */
export default async function repoint({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any

  const images = await knex.raw(
    `update image set url = '/media/' || substring(url from '[^/]+$')
     where url like '/store/media/%'`
  )
  const thumbs = await knex.raw(
    `update product set thumbnail = '/media/' || substring(thumbnail from '[^/]+$')
     where thumbnail like '/store/media/%'`
  )

  const left = await knex.raw(
    `select (select count(*) from image where url like '/store/media/%') as images,
            (select count(*) from product where thumbnail like '/store/media/%') as thumbs`
  )
  logger.info('')
  logger.info(`  image rows repointed   ${images.rowCount ?? 0}`)
  logger.info(`  thumbnails repointed   ${thumbs.rowCount ?? 0}`)
  logger.info(`  still on /store/media  ${left.rows[0].images} images, ${left.rows[0].thumbs} thumbnails`)
  logger.info('')
}
