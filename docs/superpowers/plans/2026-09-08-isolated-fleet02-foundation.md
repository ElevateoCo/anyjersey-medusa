# Isolated fleet-02 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible isolated AnyJersey stack definition and a least-privilege, key-only fleet-02 access definition without deploying the stack or changing Coolify.

**Change boundary:** Do not deploy an application, change the Coolify owner,
change the Coolify version, or send a human message. A message to Emil requires
separate, explicit instruction from Arnis.

**Architecture:** A production-oriented Compose file creates environment-scoped PostgreSQL, Redis, Medusa server, Medusa worker, and storefront services without host port publication or shared resources. A root-run idempotent provisioner creates an SFTP-only `emil-anyjersey` identity whose public key is supplied at execution time and never committed.

**Tech Stack:** Docker Compose, Medusa 2.18, PostgreSQL 17, Redis 7, Next.js 16, OpenSSH, Bash.

---

### Task 1: Make Medusa's process role explicit

**Files:**
- Modify: `spike/backend/medusa-config.ts`
- Modify: `spike/backend/.env.template`
- Modify: `spike/.env.deploy.template`
- Test: `infra/tests/validate-infra.sh`

- [ ] **Step 1: Write the failing static assertion**

Add a check that `medusa-config.ts` maps `MEDUSA_WORKER_MODE` to
`projectConfig.workerMode` and rejects values outside `shared`, `server`, and
`worker`.

- [ ] **Step 2: Run it to verify it fails**

Run: `bash infra/tests/validate-infra.sh`

Expected: failure naming the missing worker-mode configuration.

- [ ] **Step 3: Implement the minimal configuration**

Parse `MEDUSA_WORKER_MODE`, throw on an invalid value, default to `shared`, and pass
the typed value as `projectConfig.workerMode`. Document the variable in both
environment templates.

- [ ] **Step 4: Run type and static checks**

Run: `cd spike/backend && npm ci --no-audit --no-fund && npx tsc --noEmit`

Expected: exit 0.

### Task 2: Define the isolated application stack

**Files:**
- Create: `infra/compose.yml`
- Create: `infra/.env.example`
- Create: `infra/README.md`
- Test: `infra/tests/validate-infra.sh`

- [ ] **Step 1: Add failing topology assertions**

Assert that Compose contains `postgres`, `redis`, `backend`, `worker`, and
`storefront`; server and worker modes differ; no service publishes `ports`; and
the Compose project name is supplied by `COMPOSE_PROJECT_NAME`.

- [ ] **Step 2: Verify the assertions fail**

Run: `bash infra/tests/validate-infra.sh`

Expected: failure because `infra/compose.yml` is absent.

- [ ] **Step 3: Add the Compose and environment definitions**

Use the repository Dockerfiles, health-gated PostgreSQL and Redis, named volumes,
an isolated default network, `MEDUSA_WORKER_MODE=server` for the API,
`MEDUSA_WORKER_MODE=worker` plus `ADMIN_DISABLED=true` for the worker, and no
host-published ports. Require all credential values with Compose's `:?` syntax;
keep `.env.example` to variable names and safe non-secret settings.

- [ ] **Step 4: Document staging and production isolation**

Document unique Compose project names, secrets, databases, buckets/prefixes and
domains; the migrate-before-serve sequence; backup/restore gates; and the explicit
prohibition on sharing KC Family Home, Paraguay Plan, Verbiest or personal data.

- [ ] **Step 5: Render both environments**

Run: `bash infra/tests/validate-infra.sh`

Expected: two successful Compose renders and `infra validation passed`.

### Task 3: Define and apply least-privilege Emil access

**Files:**
- Create: `infra/access/provision-emil-sftp.sh`
- Create: `infra/access/60-emil-anyjersey.conf`
- Modify: `infra/README.md`
- Test: `infra/tests/validate-infra.sh`

- [ ] **Step 1: Add failing access assertions**

Check that the provisioner requires root, reads exactly one public key from stdin,
validates it with `ssh-keygen`, never enables password authentication, never adds
sudo or Docker membership, installs a forced internal-SFTP `Match User` block, and
runs `sshd -t` before reload.

- [ ] **Step 2: Verify the assertions fail**

Run: `bash infra/tests/validate-infra.sh`

Expected: failure because the access files are absent.

- [ ] **Step 3: Implement the idempotent provisioner**

Create the `anyjersey` group, `emil-anyjersey` no-login user, root-owned chroot,
user-writable `/workspace`, root-owned authorised-key file and dedicated sshd
snippet. Roll back the snippet if validation fails; reload SSH only after a valid
configuration.

- [ ] **Step 4: Apply it to fleet-02 without exposing the key**

Retrieve Telegram message `77936` through the local Telegram beacon, extract and
validate the Ed25519 public key in a shell variable, and pipe it over the existing
Arnis SSH session into the provisioner. Do not echo the key or commit it.

- [ ] **Step 5: Verify the live account boundary**

Run read-only host checks for identity, groups, password lock, directory modes,
authorised-key fingerprint, `sshd -t`, and `sshd -T -C user=emil-anyjersey,...`.

Expected: no sudo or Docker group, locked password, `internal-sftp`, chroot set,
and forwarding/tunnelling disabled.

### Task 4: Verify and submit

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add infrastructure validation to CI**

Add a job that runs the repository validation script with Docker Compose available.

- [ ] **Step 2: Run the targeted checks**

Run: `bash infra/tests/validate-infra.sh`

Run: `cd spike/backend && npx tsc --noEmit`

Expected: exit 0 for both.

- [ ] **Step 3: Inspect the diff for credentials and scope**

Run: `git diff --check && git diff --stat && git grep -nE '(BEGIN (RSA|OPENSSH) PRIVATE KEY|ssh-ed25519 [A-Za-z0-9+/]{40,})' -- . ':!package-lock.json'`

Expected: clean whitespace and no key material.

- [ ] **Step 4: Commit, push and open a PR**

Commit the isolated foundation on `codex/anyjersey-infra-foundation`, push only
that branch, and open a PR to `main`. Do not merge, deploy, change the Coolify
owner, upgrade Coolify, or send Emil a message.
