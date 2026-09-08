import type { Readable } from 'stream'

/**
 * Cloudflare R2, behind the two calls `media-store.ts` actually makes.
 *
 * R2 speaks S3, so this is the AWS SDK pointed at
 * `https://<account>.r2.cloudflarestorage.com` with the region fixed to `auto` — R2 has no
 * regions, and the SDK refuses to sign a request without one.
 *
 * **Why this exists at all.** `MEDIA_BACKEND=r2` appeared in a comment, an admin string,
 * the compose file and the deploy template, and was read by no code: the `R2_*` variables
 * were listed in the integration registry and referenced nowhere else, while the flag was
 * marked critical in production. So the store carried a blocking dependency that could not
 * be satisfied by any code path, and the only thing switching it on would have done was
 * change a number on a dashboard. Either the flag had to go or this file did.
 *
 * It does **not** decide the storage question. Postgres remains the default and remains a
 * defensible one — WebP at q78 capped at 1400px is about 410 MB, content-addressed and
 * served immutable. What this changes is that the alternative is now a configuration flip
 * after a restore drill rather than a project. The number that should trigger it is restore
 * time, which nobody has measured, because the images ride along in every base backup.
 *
 * The client is built lazily and cached. Constructing it at import time would mean an
 * unconfigured deployment paid for the SDK's credential resolution chain on every boot, and
 * would move a configuration error from the point of use to module load, where the message
 * is less useful.
 */
export type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /** Optional public origin, for serving bytes without touching the app at all. */
  publicBase?: string
}

export const r2Config = (): R2Config | null => {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return {
    accountId, accessKeyId, secretAccessKey, bucket,
    publicBase: process.env.R2_PUBLIC_BASE?.replace(/\/$/, '') || undefined,
  }
}

/**
 * The object key for a content address.
 *
 * Content-addressed and therefore immutable, which is what lets the bucket be fronted by a
 * CDN with a one-year max-age and no invalidation story. The two-character shard prefix is
 * not for performance — R2 does not need it — but for the operator: `aws s3 ls` against a
 * flat bucket of 4,300 objects is unusable, and against 256 prefixes it is not.
 */
export const objectKey = (sha256: string, ext = 'webp') =>
  `media/${sha256.slice(0, 2)}/${sha256}.${ext}`

let client: unknown = null

const s3 = (cfg: R2Config) => {
  if (client) return client as any
  // Required lazily so that a Postgres-backed deployment never loads the SDK.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { S3Client } = require('@aws-sdk/client-s3')
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })
  return client as any
}

/** Test seam — the client is cached, and a suite that changes credentials needs it dropped. */
export const __resetClient = () => { client = null }

export async function putObject(
  cfg: R2Config,
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PutObjectCommand } = require('@aws-sdk/client-s3')
  await s3(cfg).send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Immutable by construction, so say so once here rather than on every response.
      CacheControl: 'public, max-age=31536000, immutable',
    })
  )
}

/** Returns null for a missing object rather than throwing, so a caller can fall back. */
export async function getObject(cfg: R2Config, key: string): Promise<Buffer | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { GetObjectCommand } = require('@aws-sdk/client-s3')
  try {
    const out = await s3(cfg).send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }))
    return await collect(out.Body as Readable)
  } catch (e) {
    const name = (e as { name?: string; $metadata?: { httpStatusCode?: number } })
    if (name.name === 'NoSuchKey' || name.$metadata?.httpStatusCode === 404) return null
    throw e
  }
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
