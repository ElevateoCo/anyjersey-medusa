import { defineLink } from '@medusajs/framework/utils'
import ProductModule from '@medusajs/medusa/product'
import CatalogModule from '../modules/catalog'

/**
 * One jersey_detail per product. Medusa stays the source of truth for commerce
 * entities; the catalog module carries what Medusa has no place for.
 */
export default defineLink(
  ProductModule.linkable.product,
  CatalogModule.linkable.jerseyDetail
)
