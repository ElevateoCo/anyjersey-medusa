import { ModuleProvider, Modules } from '@medusajs/framework/utils'
import StripeTaxProvider from './service'

export default ModuleProvider(Modules.TAX, {
  services: [StripeTaxProvider],
})
