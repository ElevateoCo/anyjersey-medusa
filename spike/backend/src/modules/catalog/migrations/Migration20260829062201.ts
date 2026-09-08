import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260829062201 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "return_request" drop constraint if exists "return_request_kind_check";`);

    this.addSql(`alter table if exists "return_request" alter column "kind" type text using ("kind"::text);`);
    this.addSql(`alter table if exists "return_request" alter column "kind" set default 'fault';`);
    this.addSql(`alter table if exists "return_request" add constraint "return_request_kind_check" check("kind" in ('fault', 'wrong_item', 'withdrawal'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "return_request" drop constraint if exists "return_request_kind_check";`);

    this.addSql(`alter table if exists "return_request" alter column "kind" type text using ("kind"::text);`);
    this.addSql(`alter table if exists "return_request" alter column "kind" set default 'refund';`);
    this.addSql(`alter table if exists "return_request" add constraint "return_request_kind_check" check("kind" in ('exchange', 'refund', 'fault'));`);
  }

}
