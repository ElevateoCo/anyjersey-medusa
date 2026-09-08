import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260829072628 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "curated_collection" drop constraint if exists "curated_collection_handle_unique";`);
    this.addSql(`alter table if exists "collection_membership" drop constraint if exists "collection_membership_collection_handle_product_id_unique";`);
    this.addSql(`create table if not exists "collection_membership" ("id" text not null, "collection_handle" text not null, "product_id" text not null, "position" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "collection_membership_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collection_membership_deleted_at" ON "collection_membership" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collection_membership_collection_handle_position" ON "collection_membership" ("collection_handle", "position") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collection_membership_product_id" ON "collection_membership" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_collection_membership_collection_handle_product_id_unique" ON "collection_membership" ("collection_handle", "product_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "curated_collection" ("id" text not null, "handle" text not null, "title" text not null, "description" text null, "position" integer not null default 0, "active" boolean not null default true, "source" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "curated_collection_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_curated_collection_deleted_at" ON "curated_collection" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_curated_collection_handle_unique" ON "curated_collection" ("handle") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_curated_collection_active_position" ON "curated_collection" ("active", "position") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "collection_membership" cascade;`);

    this.addSql(`drop table if exists "curated_collection" cascade;`);
  }

}
