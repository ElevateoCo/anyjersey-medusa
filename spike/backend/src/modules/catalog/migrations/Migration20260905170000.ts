import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Schema fixes from the data-layer map.
 *
 * **1. `media_asset` joins the migration history.** It was created by
 * `CREATE TABLE IF NOT EXISTS` executed from application code on the first upload or ingest —
 * so it had no migration id, no `down`, and `medusa db:migrate` did not produce it. A fresh
 * database ended up with a schema that depended on which endpoint happened to be called
 * first, and the media route's own health check ("is `media_asset` empty?") could fail
 * against a database where the table did not exist at all.
 *
 * The DDL is identical to `CREATE_TABLE_SQL` in `src/media-store.ts`, deliberately.
 * `ensureTable()` stays there as a safety net for the ingest scripts, which are run against
 * databases of unknown age; it is now a no-op on any database that has been migrated.
 *
 * The table is not a module model — bytea is not expressible through `model.define`, which is
 * why it was hand-written in the first place — so it lives here as raw SQL rather than as a
 * generated migration. It is in the catalog module's history because that is the only
 * migration history this application has.
 *
 * **2. The dead B-tree on `search_text` is dropped.** `/store/jerseys?q=` filters with
 * `ILIKE '%…%'`, and a leading wildcard cannot use a B-tree — so
 * `IDX_jersey_detail_search_text` has never served a single query it was created for. Since
 * `Migration20260905101500` the trigram GIN index does that work. The B-tree was pure write
 * cost on a 4,300-row table that is rewritten by every catalog sync.
 */
export class Migration20260905170000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "media_asset" (
        id          text primary key,
        sha256      char(64) not null unique,
        mime        text     not null,
        width       integer,
        height      integer,
        bytes       integer  not null,
        data        bytea,
        created_at  timestamptz not null default now()
      );
    `);
    // Idempotent for databases where the runtime path created the table with the older
    // `not null` on data, before object storage was an option.
    this.addSql(`alter table "media_asset" alter column "data" drop not null;`);
    this.addSql(`create index if not exists "media_asset_sha_idx" on "media_asset" (sha256);`);

    this.addSql(`DROP INDEX IF EXISTS "IDX_jersey_detail_search_text";`);
  }

  override async down(): Promise<void> {
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_jersey_detail_search_text" ` +
      `ON "jersey_detail" ("search_text") WHERE deleted_at IS NULL;`
    );
    // `media_asset` is deliberately not dropped. It holds every product image in the
    // catalogue — around 410 MB of bytes that exist nowhere else — and a rollback of a
    // schema migration must not be the thing that deletes them.
  }

}
