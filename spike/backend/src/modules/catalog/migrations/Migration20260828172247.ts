import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260828172247 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "return_request" ("id" text not null, "order_id" text not null, "order_display_id" text null, "email" text not null, "line_item_id" text null, "item_title" text null, "kind" text check ("kind" in ('exchange', 'refund', 'fault')) not null default 'refund', "requested_size" text null, "reason" text check ("reason" in ('too_small', 'too_large', 'not_as_described', 'faulty', 'wrong_item', 'arrived_late', 'changed_mind', 'other')) not null default 'other', "comment" text null, "status" text check ("status" in ('new', 'approved', 'label_sent', 'received', 'resolved', 'declined')) not null default 'new', "decision_note" text null, "return_shipping_paid_by" text check ("return_shipping_paid_by" in ('us', 'customer')) null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "return_request_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_return_request_deleted_at" ON "return_request" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_return_request_status" ON "return_request" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_return_request_order_id" ON "return_request" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_return_request_email" ON "return_request" ("email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_return_request_created_at" ON "return_request" ("created_at") WHERE status in ('new', 'approved', 'label_sent', 'received') AND deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "return_request" cascade;`);
  }

}
