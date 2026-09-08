import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * A trigram index for free-text search.
 *
 * `/store/jerseys?q=` filters on `search_text ILIKE '%…%'`. A leading wildcard cannot use a
 * B-tree, so the existing `IDX_jersey_detail_search_text` is dead weight for exactly the
 * query it was created for: every search is a sequential scan over the whole table, folding
 * and comparing 4,300 rows. That is fine today and is the first thing to fall over under
 * load or at 40,000 products — and it degrades as a slow page rather than as an error, which
 * is the kind of problem that gets noticed late.
 *
 * `pg_trgm` with a GIN index is what makes `LIKE '%…%'` indexable in Postgres. The planner
 * uses it for any pattern with at least three non-wildcard characters; shorter queries still
 * scan, which is acceptable — a two-letter search is not a search.
 *
 * Notes for whoever runs this against managed Postgres:
 *
 *  - `CREATE EXTENSION` needs rds_superuser (RDS), or is granted by default on Neon and
 *    Supabase. If the role cannot create it, ask the provider to enable `pg_trgm` on the
 *    database and re-run — do not drop the statement, because the index below cannot be
 *    created without it and a silent skip would leave the scan in place looking fixed.
 *  - Built non-concurrently on purpose. Migrations run inside a transaction and
 *    `CREATE INDEX CONCURRENTLY` cannot; at this table's size the lock is milliseconds. If
 *    this is ever run against a jersey_detail with millions of rows, take it out of the
 *    migration and build it by hand.
 */
export class Migration20260905101500 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create extension if not exists pg_trgm;`);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_jersey_detail_search_text_trgm" ` +
      `ON "jersey_detail" USING gin ("search_text" gin_trgm_ops) WHERE deleted_at IS NULL;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_jersey_detail_search_text_trgm";`);
    // The extension is deliberately left in place. Dropping it would break any other index
    // or query that has come to depend on it, and an unused extension costs nothing.
  }

}
