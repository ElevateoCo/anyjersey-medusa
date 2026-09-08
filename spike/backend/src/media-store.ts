import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import type { MedusaContainer } from '@medusajs/framework/types'
import { mediaBackend } from './integrations'
import { getObject, objectKey, putObject, r2Config } from './object-store'

/**
 * Image bytes in Postgres.
 *
 * This is a deliberate departure from research.md §13.2, which argued for object storage.
 * The reasoning there still holds in general — but two things make it affordable here:
 *
 *  1. **Optimise once on ingest.** WebP at q78, capped at 1400px, is ~21% of the raw
 *     archive: about **410 MB** rather than 3.09 GB. Measured, not assumed.
 *  2. **One canonical asset, derivatives on the fly.** Nothing is stored per breakpoint.
 *     Smaller widths are rendered on request and held in a bounded in-memory cache, so
 *     bandwidth drops without the database growing.
 *
 * What that does not fix, and is worth knowing:
 *  - every base backup and PITR restore carries the images
 *  - image requests hold a database connection, so they compete with checkout
 *  - large values pressure the buffer cache
 *
 * Mitigation: responses are content-addressed and served `immutable` with a one-year
 * max-age plus an ETag, so a warm browser or CDN never asks twice. The single number that
 * should trigger a move to R2 is restore time — if a restore drill stops finishing in
 * minutes, the images are the reason.
 *
 * `MEDIA_BACKEND=r2` switches to object storage without touching product records — and it
 * is now a switch rather than a comment. Under `r2` the bytes go to the bucket and the row
 * keeps only its metadata, so the same content address resolves either way and nothing in
 * the catalog, the storefront or the media route has to know which backend is in use. The
 * `R2_*` keys become `criticalInProduction` exactly when that flag is set, so a container
 * configured for R2 without credentials refuses to start rather than writing images
 * somewhere nobody expects.
 *
 * Reads fall back. A row written under Postgres still has its bytes in `data` and is served
 * from there even when the backend is now `r2`, which is what makes a migration between the
 * two a background job rather than a cutover.
 */
export const MEDIA_TABLE = 'media_asset'

export type MediaRow = {
  id: string
  sha256: string
  mime: string
  width: number | null
  height: number | null
  bytes: number
  data?: Buffer
}

/**
 * bytea, which Medusa's model.define cannot express — hence a hand-written table.
 *
 * `data` is nullable. It was `not null`, which was right while Postgres was the only
 * backend and is wrong the moment a row's bytes live in a bucket instead. The `alter` below
 * runs against tables created by the earlier version; `create table if not exists` will not
 * change a column on a table that already exists, which is the trap in writing schema this
 * way rather than as a migration.
 */
export const CREATE_TABLE_SQL = `
create table if not exists ${MEDIA_TABLE} (
  id          text primary key,
  sha256      char(64) not null unique,
  mime        text     not null,
  width       integer,
  height      integer,
  bytes       integer  not null,
  data        bytea,
  created_at  timestamptz not null default now()
);
alter table ${MEDIA_TABLE} alter column data drop not null;
create index if not exists media_asset_sha_idx on ${MEDIA_TABLE} (sha256);
`

export const pg = (container: MedusaContainer) =>
  container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any

/**
 * Create the table if it is not there, safely under concurrency.
 *
 * Two things are going on, and both were found by a test rather than reasoned about.
 *
 * **`create table if not exists` is not concurrency-safe.** It checks, then creates, and
 * two sessions doing that at the same moment race in the catalog — Postgres answers the
 * loser with `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`,
 * which names an internal index and gives no hint that the real event was a harmless race.
 * The admin upload endpoint made this reachable: dropping two images sends one request that
 * processes them in parallel, so the second file failed with a wall of DDL in its error
 * message while the first succeeded.
 *
 * So the outcome — the table exists — is what matters, and the errors that mean "somebody
 * else just created it" are swallowed. Anything else is re-thrown, because a genuine
 * permissions or connection failure here must not look like success.
 *
 * **Deliberately not memoised.** The obvious optimisation is to remember, per process, that
 * this has already been done — and it was written that way first. It broke the integration
 * suite immediately: the runner rebuilds the schema between tests, so the second upload of
 * a run asked for a table the process was certain existed and got `relation "media_asset"
 * does not exist`. The general lesson is worth more than the round trip it saves — cached
 * knowledge about a schema is a guess about something another process controls. One
 * `create table if not exists` costs about a millisecond.
 */
const RACE = [
  '23505',  // unique_violation, from the shared catalog indexes
  '42P07',  // duplicate_table
  '42710',  // duplicate_object
]

export async function ensureTable(container: MedusaContainer) {
  try {
    await pg(container).raw(CREATE_TABLE_SQL)
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const raced = RACE.includes(err?.code ?? '') ||
      /already exists|duplicate key value/i.test(err?.message ?? '')
    if (!raced) throw e
  }
}

/**
 * The bucket, or null when this deployment is not using one.
 *
 * Throws rather than falling back when `MEDIA_BACKEND=r2` and the credentials are absent.
 * Silently writing to Postgres instead would be the worst of the three outcomes: the images
 * would work, the flag would be wrong, and nobody would find out until a restore.
 */
const bucket = () => {
  if (mediaBackend() !== 'r2') return null
  const cfg = r2Config()
  if (!cfg) {
    throw new Error(
      'MEDIA_BACKEND=r2 but R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / ' +
      'R2_BUCKET are not all set. Refusing to fall back to Postgres silently.'
    )
  }
  return cfg
}

export async function putAsset(container: MedusaContainer, row: Required<MediaRow>) {
  const cfg = bucket()

  // Object first, row second. The reverse order can leave a row promising bytes that were
  // never written — and because the row is what the media route reads, that is a 404 on a
  // product image with nothing in the logs to say why. A written object with no row is
  // instead an orphan that costs storage and nothing else.
  if (cfg) {
    await putObject(cfg, objectKey(row.sha256), row.data, row.mime)
  }

  await pg(container)(MEDIA_TABLE)
    .insert({
      id: row.id, sha256: row.sha256, mime: row.mime,
      width: row.width, height: row.height, bytes: row.bytes,
      data: cfg ? null : row.data,
    })
    .onConflict('sha256')
    .ignore()
}

export async function getAsset(container: MedusaContainer, sha256: string) {
  const rows = await pg(container)(MEDIA_TABLE)
    .select('sha256', 'mime', 'width', 'height', 'bytes', 'data')
    .where({ sha256 })
    .limit(1)
  const row = (rows[0] ?? null) as MediaRow | null
  if (!row) return null

  // A row with bytes is served from the row whatever the backend is. That is what lets the
  // two coexist during a migration instead of requiring a cutover.
  if (row.data) return row

  const cfg = bucket()
  if (!cfg) return row

  const data = await getObject(cfg, objectKey(sha256))
  return data ? { ...row, data } : row
}

/**
 * Which stored assets no reference points at.
 *
 * Images are content-addressed and therefore shared: two products can legitimately carry
 * identical bytes, which is why deleting a product deliberately keeps its images. That is
 * correct and it is also why orphans accumulate — nothing was ever collecting them.
 *
 * "Referenced" means: named by a product's `thumbnail`, or by a row in Medusa's `image`
 * table, or quoted by a personalisation's `approved_preview`. All three are checked in one
 * statement rather than by loading the catalogue into memory — at 4,300 products with 1,700
 * images the in-memory version is a few megabytes of strings for a query Postgres can answer
 * with three anti-joins.
 *
 * `image`, not `product_images`: the latter is the join table and holds only ids. Getting
 * that wrong would have made every asset look orphaned.
 *
 * Soft-deleted products still count as references. A soft-deleted product can be restored,
 * and restoring one whose images were swept is worse than paying for the bytes.
 */
export async function findOrphanAssets(container: MedusaContainer, limit = 500) {
  const rows = await pg(container).raw(
    `
    select m.sha256, m.bytes, m.created_at
    from ${MEDIA_TABLE} m
    where not exists (
      select 1 from product p
      where p.thumbnail like '%' || m.sha256 || '%'
    )
    and not exists (
      select 1 from image i
      where i.url like '%' || m.sha256 || '%'
    )
    and not exists (
      select 1 from line_personalisation lp
      where lp.approved_preview like '%' || m.sha256 || '%'
    )
    order by m.created_at asc
    limit ?
    `,
    [limit]
  )
  return (rows.rows ?? []) as { sha256: string; bytes: number; created_at: string }[]
}

/** Remove stored assets by content address. Returns how many rows went. */
export async function deleteAssets(container: MedusaContainer, shas: string[]) {
  if (!shas.length) return 0
  return pg(container)(MEDIA_TABLE).whereIn('sha256', shas).del()
}

export async function assetStats(container: MedusaContainer) {
  const [row] = await pg(container)(MEDIA_TABLE)
    .count('* as count')
    .sum('bytes as total_bytes')
  return {
    count: Number(row?.count ?? 0),
    total_bytes: Number(row?.total_bytes ?? 0),
  }
}

/**
 * Public URL for an asset. Content-addressed, so it can be cached forever.
 *
 * Deliberately still an app URL even under R2. The route is what renders the `?w=`
 * derivatives and the `.png` transcode the Open Graph card needs, so pointing product
 * records straight at the bucket would trade a database read for a broken share card and a
 * full-size image on a phone. `R2_PUBLIC_BASE` exists for a CDN to be put in front of the
 * *route*, which is the arrangement that keeps both.
 */
export const assetUrl = (sha256: string) => `/media/${sha256}.webp`
