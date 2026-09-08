import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260828173857 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "store_review" drop constraint if exists "store_review_fingerprint_unique";`);
    this.addSql(`create table if not exists "store_review" ("id" text not null, "product_id" text null, "source_item" text null, "rating" integer not null, "title" text null, "body" text not null, "author_name" text not null, "source" text not null, "reviewed_at" timestamptz not null, "match_method" text check ("match_method" in ('exact_title', 'manual', 'unmatched')) not null default 'unmatched', "fingerprint" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "store_review_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_store_review_deleted_at" ON "store_review" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_store_review_product_id" ON "store_review" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_store_review_reviewed_at" ON "store_review" ("reviewed_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_store_review_fingerprint_unique" ON "store_review" ("fingerprint") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "store_review" cascade;`);
  }

}
