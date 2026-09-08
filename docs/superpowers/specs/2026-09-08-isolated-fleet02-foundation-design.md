# Isolated fleet-02 foundation design

## Decision

AnyJersey will run as its own stack on fleet-02. It will not reuse KC Family Home,
Paraguay Plan, Verbiest, or any shared Supabase database, Redis instance, volume,
network, credential, bucket, or backup prefix.

The application topology is PostgreSQL 17, Redis 7, a Medusa API instance in
`server` mode, a Medusa background instance in `worker` mode, and the Next.js
storefront. The two Medusa instances use the same image and isolated data plane.
Only the API and storefront are candidates for proxy exposure; PostgreSQL, Redis,
and the worker have no host ports.

## Environment boundary

Staging and production may live in one future Coolify project, but each must use a
different Compose project name, PostgreSQL volume, Redis volume, object-storage
bucket or prefix, domain set, and Infisical environment. A production promotion
must use a tested immutable Git SHA and run database migrations before traffic is
accepted.

No deployment is part of this change. fleet-02 still runs Coolify 4.1.2 and its
owner is unchanged; both remain gated on Arnis's explicit instruction after the
host inventory and release delta have been recorded.

No human message is part of this change. In particular, Emil is not contacted
unless Arnis gives separate, explicit instruction.

## Developer access

Emil receives a dedicated `emil-anyjersey` Unix identity. It has no password, sudo
membership, Docker membership, interactive shell, port forwarding, agent
forwarding, X11 forwarding, or tunnel capability. The supplied Ed25519 key is kept
outside the repository in root-owned OpenSSH configuration. The account is forced
into an SFTP chroot and can write only `/workspace` inside that chroot.

Repository access remains the primary path for code. Broader terminal or Coolify
access requires a separate decision because either would expand the trust boundary.

## Secret and data boundary

The repository records variable names only. Runtime values belong in the dedicated
AnyJersey Infisical project and are injected per environment. Live payment keys,
customer data, production domains, and production databases remain out of scope.

## Verification

The repository must prove that both Compose environments render without host port
bindings, that Medusa's server and worker modes are explicit, that databases and
volumes are environment-scoped, and that no committed credential-like value is
introduced. The access provisioner must pass shell syntax checks, OpenSSH must pass
`sshd -t` before reload, and the resulting effective user configuration must show
the forced SFTP command and disabled forwarding.
