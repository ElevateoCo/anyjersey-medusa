import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260821202454 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "jersey_detail" ("id" text not null, "sport" text null, "league" text null, "team" text null, "player" text null, "colourway" text null, "season" text null, "edition" text null, "garment" text not null default 'jersey', "seo_title" text null, "seo_description" text null, "manufacturer_name" text null, "manufacturer_address" text null, "eu_responsible_person" text null, "country_of_origin" text null, "fibre_composition" text null, "care_instructions" text null, "safety_information" text null, "hs_code" text null, "needs_review" boolean not null default false, "review_notes" jsonb null, "source_platform" text not null default 'shopify', "source_handle" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "jersey_detail_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_jersey_detail_deleted_at" ON "jersey_detail" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_jersey_detail_team" ON "jersey_detail" ("team") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_jersey_detail_league" ON "jersey_detail" ("league") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_jersey_detail_player" ON "jersey_detail" ("player") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_jersey_detail_sport" ON "jersey_detail" ("sport") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_jersey_detail_garment" ON "jersey_detail" ("garment") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_jersey_detail_needs_review" ON "jersey_detail" ("needs_review") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "jersey_request" ("id" text not null, "email" text not null, "raw_request" text not null, "team" text null, "player" text null, "colourway" text null, "season" text null, "size_code" text null, "garment" text null, "source" text check ("source" in ('homepage', 'product', 'search_empty', 'collection')) not null default 'homepage', "source_product_id" text null, "status" text check ("status" in ('new', 'sourcing', 'quoted', 'fulfilled', 'declined')) not null default 'new', "notes" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "jersey_request_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_jersey_request_deleted_at" ON "jersey_request" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_jersey_request_status" ON "jersey_request" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_jersey_request_team_player" ON "jersey_request" ("team", "player") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_jersey_request_email" ON "jersey_request" ("email") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "jersey_detail" cascade;`);

    this.addSql(`drop table if exists "jersey_request" cascade;`);
  }

}
