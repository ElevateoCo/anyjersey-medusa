import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Who at the shop gets told when something happens.
 *
 * Every email the application sent addressed the customer; nothing ever notified an operator.
 * This is the list that fixes it — a table rather than an environment variable, so adding a
 * colleague is not a redeploy and so returns and orders can go to different people.
 */
export class Migration20260905193000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "notification_recipient" (
      "id" text not null,
      "email" text not null,
      "name" text null,
      "events" jsonb not null,
      "active" boolean not null default true,
      "note" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "notification_recipient_pkey" primary key ("id")
    );`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_notification_recipient_deleted_at" ON "notification_recipient" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_notification_recipient_active" ON "notification_recipient" ("active") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_notification_recipient_email_unique" ON "notification_recipient" ("email") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "notification_recipient" cascade;`);
  }

}
