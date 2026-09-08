import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260822131715 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "product_review" ("id" text not null, "product_id" text not null, "rating" integer not null, "title" text null, "body" text not null, "author_name" text not null, "email" text not null, "verified_purchase" boolean not null default false, "order_id" text null, "status" text check ("status" in ('pending', 'approved', 'rejected')) not null default 'pending', "rejection_reason" text check ("rejection_reason" in ('spam', 'abusive', 'off_topic', 'personal_info', 'not_a_customer')) null, "moderated_by" text null, "moderated_at" timestamptz null, "fit_feedback" text check ("fit_feedback" in ('small', 'true', 'large')) null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_review_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_review_deleted_at" ON "product_review" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_review_product_id" ON "product_review" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_review_status" ON "product_review" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_review_verified_purchase" ON "product_review" ("verified_purchase") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_review" cascade;`);
  }

}
