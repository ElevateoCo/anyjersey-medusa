import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Switches for the automatic customer emails, with an audit trail.
 *
 * A row exists only once a switch has been touched — absence means on. The `disabled_at` and
 * `disabled_by` columns are the reason this is a table rather than an environment variable:
 * "order confirmations have been off since Tuesday" is a question somebody asks after a week
 * of support tickets, and there is no other way to answer it.
 */
export class Migration20260905210000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "message_setting" (
      "id" text not null,
      "key" text not null,
      "enabled" boolean not null default true,
      "disabled_at" timestamptz null,
      "disabled_by" text null,
      "reason" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "message_setting_pkey" primary key ("id")
    );`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_setting_deleted_at" ON "message_setting" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_message_setting_key_unique" ON "message_setting" ("key") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "message_setting" cascade;`);
  }

}
