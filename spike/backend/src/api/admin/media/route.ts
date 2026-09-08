import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { mediaBackend } from '../../../integrations'
import { assetStats, MEDIA_TABLE, pg } from '../../../media-store'

/**
 * GET /admin/media — how big the image table has become.
 *
 * Exists because the cost of storing images in the database is invisible until a restore
 * takes too long. This puts the number somewhere a human will see it.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const stats = await assetStats(req.scope as never)
  const knex = pg(req.scope as never)

  const [{ size: tableSize }] = await knex.raw(
    `select pg_size_pretty(pg_total_relation_size('${MEDIA_TABLE}')) as size`
  ).then((r: any) => r.rows)

  const [{ db_size: dbSize }] = await knex.raw(
    'select pg_size_pretty(pg_database_size(current_database())) as db_size'
  ).then((r: any) => r.rows)

  const widest = await knex(MEDIA_TABLE)
    .select('sha256', 'width', 'height', 'bytes')
    .orderBy('bytes', 'desc')
    .limit(5)

  res.json({
    assets: stats.count,
    stored_bytes: stats.total_bytes,
    stored_mb: Math.round((stats.total_bytes / 1048576) * 10) / 10,
    average_kb: stats.count
      ? Math.round(stats.total_bytes / stats.count / 1024)
      : 0,
    media_table_size: tableSize,
    database_size: dbSize,
    largest: widest.map((r: any) => ({
      sha256: r.sha256.slice(0, 12), width: r.width, height: r.height,
      kb: Math.round(r.bytes / 1024),
    })),
    // The flag this reports is now read by src/media-store.ts rather than only described
    // here. It was a string in this payload, a comment, a compose entry and a line in the
    // deploy template, and no code path anywhere — which is how it came to be marked
    // critical in production while being impossible to satisfy.
    backend: mediaBackend(),
    note: mediaBackend() === 'r2'
      ? 'Images are written to Cloudflare R2 and the rows keep metadata only. Rows ' +
        'created before the switch still carry their bytes and are served from Postgres, ' +
        'so the two coexist and a migration is a background job rather than a cutover.'
      : 'Images live in Postgres by decision. They ride along in every base backup and ' +
        'point-in-time restore, so the number to watch is restore time rather than size. ' +
        'Set MEDIA_BACKEND=r2, with the four R2_* keys, to move them out without touching ' +
        'product records.',
  })
}
