import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * A third kind of inbound message: `suppression`.
 *
 * Somebody who clicks unsubscribe in a cart-recovery email may never have signed up for the
 * newsletter — they gave their address at a checkout, which is what PECR's soft opt-in rests
 * on. Recording that refusal as a `newsletter` row would misstate where the address came from,
 * and the point of `consented_at` and `source` is that the defensible record is when and where.
 *
 * The index is the one the suppression check runs on before every commercial send.
 */
export class Migration20260905223000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inbound_message" drop constraint if exists "inbound_message_kind_check";`);
    this.addSql(`alter table if exists "inbound_message" add constraint "inbound_message_kind_check" check ("kind" in ('contact', 'newsletter', 'suppression'));`);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_inbound_message_suppressed" ` +
      `ON "inbound_message" ("email") WHERE unsubscribed_at IS NOT NULL;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_inbound_message_suppressed";`);
    // Any suppression rows are removed first, or the narrowed constraint cannot be applied.
    // They are refusals, so this is destructive in the direction that matters — a rollback
    // that resurrects the right to email somebody who said no.
    this.addSql(`delete from "inbound_message" where "kind" = 'suppression';`);
    this.addSql(`alter table if exists "inbound_message" drop constraint if exists "inbound_message_kind_check";`);
    this.addSql(`alter table if exists "inbound_message" add constraint "inbound_message_kind_check" check ("kind" in ('contact', 'newsletter'));`);
  }

}
