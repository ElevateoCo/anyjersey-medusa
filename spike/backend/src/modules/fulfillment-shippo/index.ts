import { ModuleProvider, Modules } from '@medusajs/framework/utils'
import ShippoFulfillmentProvider from './service'

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [ShippoFulfillmentProvider],
})
