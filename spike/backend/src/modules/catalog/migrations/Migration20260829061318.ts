import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260829061318 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inbound_message" drop constraint if exists "inbound_message_email_unique";`);
    this.addSql(`create table if not exists "inbound_message" ("id" text not null, "kind" text check ("kind" in ('contact', 'newsletter')) not null, "email" text not null, "name" text null, "phone" text null, "body" text null, "source" text null, "status" text check ("status" in ('new', 'answered', 'closed')) not null default 'new', "notes" text null, "consented_at" timestamptz null, "unsubscribed_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "inbound_message_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbound_message_deleted_at" ON "inbound_message" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbound_message_kind_status" ON "inbound_message" ("kind", "status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbound_message_email" ON "inbound_message" ("email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbound_message_created_at" ON "inbound_message" ("created_at") WHERE kind = 'contact' AND status = 'new' AND deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_inbound_message_email_unique" ON "inbound_message" ("email") WHERE kind = 'newsletter' AND unsubscribed_at IS NULL AND deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "inbound_message" cascade;`);
  }

}
