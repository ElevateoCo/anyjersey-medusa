import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260823095551 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "line_personalisation" ("id" text not null, "cart_line_id" text null, "order_line_id" text null, "order_id" text null, "product_id" text not null, "kind" text check ("kind" in ('name', 'number', 'patch')) not null, "value" text not null, "price" integer not null, "typeface" text not null, "placement" text check ("placement" in ('back', 'front', 'sleeve', 'chest')) not null, "render_sha256" text null, "review_status" text check ("review_status" in ('pending', 'approved', 'rejected')) not null default 'pending', "rejection_reason" text check ("rejection_reason" in ('blocklist', 'trademark', 'illegible', 'unavailable_patch', 'other')) null, "reviewed_by" text null, "reviewed_at" timestamptz null, "approved_preview" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "line_personalisation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_line_personalisation_deleted_at" ON "line_personalisation" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_line_personalisation_review_status" ON "line_personalisation" ("review_status") WHERE review_status = 'pending' AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_line_personalisation_order_id" ON "line_personalisation" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_line_personalisation_cart_line_id" ON "line_personalisation" ("cart_line_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "line_personalisation" cascade;`);
  }

}
