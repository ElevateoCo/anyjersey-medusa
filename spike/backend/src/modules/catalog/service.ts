import { MedusaService } from '@medusajs/framework/utils'
import { JerseyDetail } from './models/jersey-detail'
import { JerseyRequest } from './models/jersey-request'
import { LinePersonalisation } from './models/line-personalisation'
import { ProductReview } from './models/product-review'
import { ReturnRequest } from './models/return-request'
import { CollectionMembership, CuratedCollection } from './models/curated-collection'
import { InboundMessage } from './models/inbound-message'
import { StoreSetting } from './models/store-setting'
import { NotificationRecipient } from './models/notification-recipient'
import { StoreReview } from './models/store-review'

class CatalogModuleService extends MedusaService({
  JerseyDetail,
  JerseyRequest,
  LinePersonalisation,
  ProductReview,
  ReturnRequest,
  StoreReview,
  InboundMessage,
  CuratedCollection,
  CollectionMembership,
  NotificationRecipient,
  StoreSetting,
}) {}

export default CatalogModuleService
