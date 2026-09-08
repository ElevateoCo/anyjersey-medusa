# AnyJersey deployment foundation

This directory defines the production-shaped Compose topology only. It does not
deploy anything, create infrastructure, change DNS or grant access.

## Isolation model

Use distinct project names for every environment:

- `anyjersey-staging`
- `anyjersey-prod`

`COMPOSE_PROJECT_NAME` is mandatory. Compose uses it to scope the network,
Postgres and Redis volumes, and immutable image tags. No resource is external
and no service publishes a host port. A deployment platform or reverse proxy
may attach HTTP routing to `backend:9000` and `storefront:3000`; Postgres and
Redis remain reachable only on the stack-local network.

The five services are:

- `postgres`: the dedicated Medusa database.
- `redis`: persistent cache, event-bus and workflow state.
- `backend`: Medusa API/admin with `MEDUSA_WORKER_MODE=server`.
- `worker`: the same backend image with `MEDUSA_WORKER_MODE=worker` and the
  admin disabled.
- `storefront`: the repository's Next.js storefront image.

Do not share a database, Redis instance, volume, R2 prefix, network or secrets
with KC Family Home, Paraguay Plan, Verbiest, any other client, or any personal data
or personal project. Staging and production are isolated from each other as well.

## Environment and secrets

Copy `.env.example` to a secure, environment-specific location outside Git.
Keep staging and production values in separate Infisical paths and give the
deployment identity access only to its own path. The Compose file refuses to
render without the database/Redis credentials, application signing secrets,
critical provider credentials and immutable Git SHA.

Use strong URL-safe random values for `DB_PASSWORD` and `REDIS_PASSWORD`, since
they are also embedded in connection URLs. Never commit the resulting env file.
Values beginning `NEXT_PUBLIC_` are compiled into the storefront and are not
secrets; all other credentials stay server-side.

Assign separate domains per environment, including the API/admin origin and the
storefront origin. Keep `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS`,
`STOREFRONT_URL`, `MEDUSA_ADMIN_URL`, `NEXT_PUBLIC_MEDUSA_URL` and
`NEXT_PUBLIC_SITE_URL` consistent with those domains. Staging must keep
`NEXT_PUBLIC_ALLOW_INDEXING=false` and should use `RESEND_REDIRECT_TO`.

R2 is environment-specific. Give staging and production different buckets, or
at minimum different non-overlapping prefixes and credentials. Media objects
must never share the WAL/database-backup prefix.

## Immutable promotion and migration order

Build the backend and storefront from one reviewed full Git SHA. Deploy that
exact SHA to staging, record the image digests, complete acceptance there, then
promote the same digests to production. Do not rebuild from a moving branch or
substitute a different SHA during promotion.

Database migration happens before either serving process receives traffic:

1. Start only `postgres` and `redis` for the target project name.
2. Take and verify the pre-migration backup.
3. Run `npx medusa db:migrate` once from the exact backend image being promoted.
4. Run required idempotent seed/bootstrap commands, including RBAC ownership,
   before enabling RBAC readiness.
5. Start `backend` and `worker`; wait for dependency health and backend
   `/health/ready`.
6. Start/reroute the storefront only after the backend is ready.

If migration fails, stop. Do not start the new backend or retry a partially
understood migration. Restore or roll back according to the tested release
procedure.

## Backup and restore gates

Production requires continuous WAL archiving or an equivalently bounded-RPO
Postgres backup, plus scheduled full backups to a dedicated R2 backup prefix.
Retention, encryption, alerting and last-success monitoring must be configured
before traffic. Back up the media bucket separately; a database backup does not
contain R2 objects. Redis persistence is enabled, but Postgres and object
storage remain the recovery sources of record.

No production launch is allowed until a remote restore drill has recovered a
backup into an isolated disposable project and verified migrations, aggregate
row counts, admin login, a storefront read, and representative media objects.
Record the backup identifier, Git SHA, timestamps and verification results.
Repeat the restore drill after material schema or backup-system changes.

## Render-only validation

The repository validator renders both staging and production with dummy values
and checks service topology, build contexts, health gates, role separation,
absence of host ports, project-scoped volumes/network and required variables:

```sh
bash infra/tests/validate-infra.sh
```

This validation is not a deployment and must not be followed by `up` in review
or CI. Host, Coolify, access and DNS changes are separate authorised work.
