import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Recording the refund on the return request.
 *
 * The returns queue has always recorded a decision and deliberately not moved money, because
 * a retry whose response was lost refunds twice. Medusa's `refundPaymentWorkflow` takes no
 * idempotency key — its Stripe provider passes one from a payment context the workflow does
 * not expose — so the guarantee cannot live in the call and has to live in a row.
 *
 * `refunded_at` is that row: written as part of issuing the refund, and checked before any
 * second attempt is allowed. The partial index is what the check reads.
 */
export class Migration20260906120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "return_request" add column if not exists "refunded_at" timestamptz null;`);
    this.addSql(`alter table if exists "return_request" add column if not exists "refunded_by" text null;`);
    this.addSql(`alter table if exists "return_request" add column if not exists "refund_amount" integer null;`);
    this.addSql(`alter table if exists "return_request" add column if not exists "refund_payment_id" text null;`);
    this.addSql(`alter table if exists "return_request" add column if not exists "refund_error" text null;`);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_return_request_refunded" ` +
      `ON "return_request" ("refunded_at") WHERE refunded_at IS NOT NULL;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_return_request_refunded";`);
    // Deliberately not dropped: a record that money was returned outlives a schema rollback,
    // and re-running the migration must not make an already-refunded return refundable again.
  }

}
