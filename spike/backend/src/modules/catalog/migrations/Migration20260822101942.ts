import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260822101942 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "jersey_detail" add column if not exists "search_text" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_jersey_detail_search_text" ON "jersey_detail" ("search_text") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_jersey_detail_search_text";`);
    this.addSql(`alter table if exists "jersey_detail" drop column if exists "search_text";`);
  }

}
