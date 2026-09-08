import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Two fixes that were found by mapping the data layer.
 *
 * **1. `line_personalisation.line_ref`.** `order_id` and `order_line_id` were indexed and
 * queried and written by nothing, because a cart line's id does not survive checkout. This
 * column carries a ref that does — see the model for why metadata is the thing that crosses
 * that boundary.
 *
 * **2. A unique index on `product_review (product_id, email)`.** The "one review per email
 * per product" rule was a read followed by a write in the route, so two concurrent
 * submissions both passed. Partial on `deleted_at IS NULL` like every other unique index in
 * this module, so a soft-deleted review frees the address again.
 *
 * The unique index is created **after** de-duplicating, because it cannot be created over
 * existing duplicates and a migration that fails halfway through a deploy is worse than the
 * race it was fixing. The de-duplication keeps the earliest review of each pair — the one
 * the customer wrote first, and the one the application would have kept.
 */
export class Migration20260905143000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "line_personalisation" add column if not exists "line_ref" text null;`);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_line_personalisation_line_ref" ` +
      `ON "line_personalisation" ("line_ref") WHERE deleted_at IS NULL;`
    );

    // Soft-delete the later duplicate of any pair that already exists, so the unique index
    // below can be created. Nothing is destroyed: `deleted_at` is what the partial index
    // keys off, so the row survives and simply stops blocking.
    this.addSql(`
      update "product_review" r set "deleted_at" = now()
      where "deleted_at" is null
        and exists (
          select 1 from "product_review" e
          where e."deleted_at" is null
            and e."product_id" = r."product_id"
            and lower(e."email") = lower(r."email")
            and (e."created_at" < r."created_at"
                 or (e."created_at" = r."created_at" and e."id" < r."id"))
        );
    `);
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_product_review_product_id_email_unique" ` +
      `ON "product_review" ("product_id", "email") WHERE deleted_at IS NULL;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_product_review_product_id_email_unique";`);
    this.addSql(`DROP INDEX IF EXISTS "IDX_line_personalisation_line_ref";`);
    this.addSql(`alter table if exists "line_personalisation" drop column if exists "line_ref";`);
    // The de-duplication is deliberately not reversed: which rows were soft-deleted is not
    // recorded, and resurrecting every soft-deleted review would undo real moderation too.
  }

}
