import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260829051753 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "jersey_detail" add column if not exists "is_custom" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "jersey_detail" drop column if exists "is_custom";`);
  }

}
