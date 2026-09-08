import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * `message_setting` becomes `store_setting`, with a group.
 *
 * The table was only ever message-specific in its name — `key`, `enabled`, `disabled_at`,
 * `disabled_by`, `reason` describes any switch. The moment a second kind of setting appeared
 * (whether a phone number is required at checkout) the choice was a second table with the
 * same five columns, or one table that says what it is. A second table would have been the
 * kind of quiet duplication that ends with two admin screens, two audit trails and two places
 * to look when somebody asks why a toggle did nothing.
 *
 * Existing rows are messages, so the backfill is a constant. The unique index moves to
 * `(group, key)` — keys are only unique within their group, and a future `checkout` key that
 * happened to match a message key should not collide.
 */
export class Migration20260906090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "message_setting" rename to "store_setting";`);
    this.addSql(`alter table if exists "store_setting" add column if not exists "group" text not null default 'message';`);

    this.addSql(`DROP INDEX IF EXISTS "IDX_message_setting_key_unique";`);
    this.addSql(`DROP INDEX IF EXISTS "IDX_message_setting_deleted_at";`);
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_store_setting_group_key_unique" ` +
      `ON "store_setting" ("group", "key") WHERE deleted_at IS NULL;`
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_store_setting_deleted_at" ` +
      `ON "store_setting" ("deleted_at") WHERE deleted_at IS NULL;`
    );

    // For a database that never had the old table — a fresh one migrating straight through.
    this.addSql(`create table if not exists "store_setting" (
      "id" text not null,
      "group" text not null default 'message',
      "key" text not null,
      "enabled" boolean not null default true,
      "disabled_at" timestamptz null,
      "disabled_by" text null,
      "reason" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "store_setting_pkey" primary key ("id")
    );`);
  }

  override async down(): Promise<void> {
    this.addSql(`delete from "store_setting" where "group" <> 'message';`);
    this.addSql(`DROP INDEX IF EXISTS "IDX_store_setting_group_key_unique";`);
    this.addSql(`alter table if exists "store_setting" drop column if exists "group";`);
    this.addSql(`alter table if exists "store_setting" rename to "message_setting";`);
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_message_setting_key_unique" ` +
      `ON "message_setting" ("key") WHERE deleted_at IS NULL;`
    );
  }

}
