#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
medusa_config="$repo_root/spike/backend/medusa-config.ts"
backend_env="$repo_root/spike/backend/.env.template"
deploy_env="$repo_root/spike/.env.deploy.template"

node - "$medusa_config" "$backend_env" "$deploy_env" <<'NODE'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const configPath = process.argv[2]
const source = fs.readFileSync(configPath, 'utf8')
const backendEnv = fs.readFileSync(process.argv[3], 'utf8')
const deployEnv = fs.readFileSync(process.argv[4], 'utf8')
const backendDir = path.dirname(configPath)

function assertMatch(description, pattern, value = source) {
  if (!pattern.test(value)) {
    console.error(`FAIL: ${description}`)
    process.exit(1)
  }
}

const tsNodeRegister = require.resolve('ts-node/register/transpile-only', {
  paths: [backendDir],
})
const isolatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'anyjersey-worker-mode-'))
fs.symlinkSync(path.join(backendDir, 'src'), path.join(isolatedCwd, 'src'), 'dir')
const loadConfig = [
  'const config = require(process.argv[1])',
  'process.stdout.write(String(config.projectConfig.workerMode))',
].join(';')
const baseEnv = {
  ...process.env,
  NODE_ENV: 'test',
  STRIPE_WEBHOOK_SECRET: 'test-only-webhook-secret',
  TS_NODE_PROJECT: path.join(backendDir, 'tsconfig.json'),
}
delete baseEnv.MEDUSA_WORKER_MODE

function executeConfig(workerMode) {
  const env = { ...baseEnv }
  if (workerMode !== undefined) {
    env.MEDUSA_WORKER_MODE = workerMode
  }

  return spawnSync(
    process.execPath,
    ['-r', tsNodeRegister, '-e', loadConfig, configPath],
    { cwd: isolatedCwd, env, encoding: 'utf8' }
  )
}

function assertWorkerMode(workerMode, expected) {
  const result = executeConfig(workerMode)
  const label = workerMode === undefined ? 'unset' : JSON.stringify(workerMode)

  if (result.status !== 0 || result.stdout !== expected) {
    console.error(
      `FAIL: MEDUSA_WORKER_MODE=${label} should load as ${expected}; ` +
      `status=${result.status}, stdout=${JSON.stringify(result.stdout)}, ` +
      `stderr=${JSON.stringify(result.stderr)}`
    )
    process.exit(1)
  }
}

function assertWorkerModeRejected(workerMode) {
  const result = executeConfig(workerMode)

  if (
    result.status === 0 ||
    !`${result.stdout}\n${result.stderr}`.includes('MEDUSA_WORKER_MODE must be')
  ) {
    console.error(
      `FAIL: MEDUSA_WORKER_MODE=${JSON.stringify(workerMode)} should throw; ` +
      `status=${result.status}`
    )
    process.exit(1)
  }
}

try {
  assertWorkerMode(undefined, 'shared')
  assertWorkerMode('shared', 'shared')
  assertWorkerMode('server', 'server')
  assertWorkerMode('worker', 'worker')
  assertWorkerModeRejected('not-a-worker-mode')
  assertWorkerModeRejected('')
} finally {
  fs.rmSync(isolatedCwd, { recursive: true, force: true })
}

assertMatch(
  'medusa-config defaults MEDUSA_WORKER_MODE only when it is undefined',
  /process\.env\.MEDUSA_WORKER_MODE\s*\?\?\s*['"]shared['"]/
)

assertMatch(
  'medusa-config gives worker mode the shared/server/worker union type',
  /type\s+WorkerMode\s*=\s*['"]shared['"]\s*\|\s*['"]server['"]\s*\|\s*['"]worker['"]/
)

assertMatch(
  'medusa-config rejects every worker mode outside shared, server, and worker',
  /!==\s*['"]shared['"][\s\S]*!==\s*['"]server['"][\s\S]*!==\s*['"]worker['"][\s\S]*throw\s+new\s+Error/
)

const projectConfig = source.match(/projectConfig:\s*\{([\s\S]*?)\n\s*\},\n\s*modules:/)?.[1] || ''
assertMatch(
  'projectConfig maps the parsed value to workerMode',
  /\bworkerMode\s*[:,]/,
  projectConfig
)

assertMatch(
  'backend environment template documents the shared worker mode default',
  /^MEDUSA_WORKER_MODE=shared$/m,
  backendEnv
)

assertMatch(
  'deployment environment template documents the shared worker mode default',
  /^MEDUSA_WORKER_MODE=shared$/m,
  deployEnv
)

console.log('PASS: Medusa worker mode behaviour, mapping, validation, and templates')
NODE

compose_file="$repo_root/infra/compose.yml"
infra_env="$repo_root/infra/.env.example"
infra_readme="$repo_root/infra/README.md"
storefront_env="$repo_root/spike/storefront/.env.template"
storefront_dockerfile="$repo_root/spike/storefront/Dockerfile"

for required_file in "$compose_file" "$infra_env" "$infra_readme"; do
  if [[ ! -f "$required_file" ]]; then
    echo "FAIL: required infrastructure file is missing: $required_file" >&2
    exit 1
  fi
done

node - "$compose_file" "$infra_env" "$infra_readme" "$backend_env" "$storefront_env" "$storefront_dockerfile" <<'NODE'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const [composePath, envExamplePath, readmePath, backendEnvPath, storefrontEnvPath, storefrontDockerfilePath] =
  process.argv.slice(2)
const composeSource = fs.readFileSync(composePath, 'utf8')
const envExample = fs.readFileSync(envExamplePath, 'utf8')
const readme = fs.readFileSync(readmePath, 'utf8')
const backendTemplate = fs.readFileSync(backendEnvPath, 'utf8')
const storefrontTemplate = fs.readFileSync(storefrontEnvPath, 'utf8')
const storefrontDockerfile = fs.readFileSync(storefrontDockerfilePath, 'utf8')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyjersey-compose-'))

function fail(message) {
  throw new Error(`FAIL: ${message}`)
}

function templateNames(source) {
  return new Set(
    source
      .split('\n')
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter(Boolean)
  )
}

const dummyValues = {
  GIT_SHA: '0123456789abcdef0123456789abcdef01234567',
  DB_USER: 'anyjersey',
  DB_PASSWORD: 'test-only-db-password',
  DB_NAME: 'anyjersey_test',
  REDIS_PASSWORD: 'test-only-redis-password',
  JWT_SECRET: 'test-only-jwt-secret',
  COOKIE_SECRET: 'test-only-cookie-secret',
  INTERNAL_API_SECRET: 'test-only-internal-secret',
  STORE_CORS: 'https://store.test.invalid',
  ADMIN_CORS: 'https://admin.test.invalid',
  AUTH_CORS: 'https://store.test.invalid,https://admin.test.invalid',
  STOREFRONT_URL: 'https://store.test.invalid',
  TRUST_PROXY: 'true',
  STRIPE_API_KEY: 'test-only-stripe-api-key',
  STRIPE_WEBHOOK_SECRET: 'test-only-stripe-webhook-secret',
  STRIPE_TAX_ENABLED: 'false',
  RESEND_API_KEY: 'test-only-resend-api-key',
  RESEND_FROM: 'orders@test.invalid',
  SHIPPO_API_KEY: 'test-only-shippo-api-key',
  MEDIA_BACKEND: 'r2',
  R2_ACCOUNT_ID: 'test-only-r2-account',
  R2_ACCESS_KEY_ID: 'test-only-r2-access-key',
  R2_SECRET_ACCESS_KEY: 'test-only-r2-secret-key',
  R2_BUCKET: 'anyjersey-test-media',
  MEDUSA_ADMIN_URL: 'https://admin.test.invalid',
  MEDUSA_FF_RBAC: 'true',
  NEXT_PUBLIC_MEDUSA_URL: 'https://api.test.invalid',
  NEXT_PUBLIC_MEDUSA_PK: 'pk_test_publishable',
  NEXT_PUBLIC_REGION_ID: 'reg_test',
  NEXT_PUBLIC_STRIPE_PK: 'pk_test_stripe',
  NEXT_PUBLIC_SITE_URL: 'https://store.test.invalid',
  NEXT_PUBLIC_ALLOW_INDEXING: 'false',
  NEXT_PUBLIC_LEGAL_NAME: 'Test Trader',
}

function writeEnv(projectName) {
  const envPath = path.join(tempDir, `${projectName || 'missing-project'}.env`)
  const values = projectName
    ? { COMPOSE_PROJECT_NAME: projectName, ...dummyValues }
    : dummyValues
  fs.writeFileSync(
    envPath,
    `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`
  )
  return envPath
}

function composeConfig(projectName) {
  const envPath = writeEnv(projectName)
  const env = { ...process.env }
  delete env.COMPOSE_PROJECT_NAME
  const result = spawnSync(
    'docker',
    ['compose', '--env-file', envPath, '-f', composePath, 'config', '--format', 'json'],
    { cwd: path.dirname(composePath), env, encoding: 'utf8' }
  )

  if (result.status !== 0) {
    fail(
      `Compose did not render for ${projectName}: ` +
      `${result.stderr || result.stdout}`.trim()
    )
  }

  return JSON.parse(result.stdout)
}

function requireKeys(object, keys, owner) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(object || {}, key)) {
      fail(`${owner} is missing ${key}`)
    }
  }
}

function assertTopology(config, projectName) {
  const expectedServices = ['postgres', 'redis', 'backend', 'worker', 'storefront']
  requireKeys(config.services, expectedServices, 'services')

  if (config.name !== projectName) {
    fail(`rendered project name ${config.name} does not equal ${projectName}`)
  }

  for (const [serviceName, service] of Object.entries(config.services)) {
    if ((service.ports || []).length > 0) {
      fail(`${serviceName} publishes a host port`)
    }
  }

  const backendContext = path.resolve(path.dirname(composePath), '../spike/backend')
  const storefrontContext = path.resolve(path.dirname(composePath), '../spike/storefront')
  if (config.services.backend.build?.context !== backendContext) {
    fail('backend does not build from the repository backend Dockerfile context')
  }
  if (config.services.worker.build?.context !== backendContext) {
    fail('worker does not build from the repository backend Dockerfile context')
  }
  if (config.services.storefront.build?.context !== storefrontContext) {
    fail('storefront does not build from the repository storefront Dockerfile context')
  }

  if (config.services.backend.environment?.MEDUSA_WORKER_MODE !== 'server') {
    fail('backend must set MEDUSA_WORKER_MODE=server')
  }
  if (config.services.worker.environment?.MEDUSA_WORKER_MODE !== 'worker') {
    fail('worker must set MEDUSA_WORKER_MODE=worker')
  }
  if (config.services.worker.environment?.ADMIN_DISABLED !== 'true') {
    fail('worker must set ADMIN_DISABLED=true')
  }

  for (const dependency of ['postgres', 'redis']) {
    if (!config.services[dependency].healthcheck?.test) {
      fail(`${dependency} has no healthcheck`)
    }
    for (const service of ['backend', 'worker']) {
      if (config.services[service].depends_on?.[dependency]?.condition !== 'service_healthy') {
        fail(`${service} is not health-gated on ${dependency}`)
      }
    }
  }

  for (const [kind, resources] of [
    ['volume', config.volumes],
    ['network', config.networks],
  ]) {
    const entries = Object.entries(resources || {})
    if (entries.length === 0) fail(`Compose has no named ${kind}s`)
    for (const [resourceName, resource] of entries) {
      if (resource.external === true) fail(`${kind} ${resourceName} is external/shared`)
      if (!resource.name?.startsWith(`${projectName}_`)) {
        fail(`${kind} ${resourceName} is not scoped by the Compose project name`)
      }
    }
  }

  const backendNames = templateNames(backendTemplate)
  requireKeys(config.services.backend.environment, backendNames, 'backend environment')
  requireKeys(config.services.worker.environment, backendNames, 'worker environment')

  const storefrontNames = templateNames(storefrontTemplate)
  const publicNames = [...storefrontNames].filter((name) => name.startsWith('NEXT_PUBLIC_'))
  const privateNames = [...storefrontNames].filter((name) => !name.startsWith('NEXT_PUBLIC_'))
  requireKeys(config.services.storefront.build?.args, publicNames, 'storefront public build args')
  requireKeys(config.services.storefront.environment, privateNames, 'storefront runtime environment')

  for (const name of publicNames) {
    const argPattern = new RegExp(`^ARG\\s+${name}(?:=|\\s*$)`, 'm')
    const envPattern = new RegExp(
      `^\\s*(?:ENV\\s+)?${name}=\\$\\{?${name}\\}?(?:\\s*\\\\|\\s*$)`,
      'm'
    )
    if (!argPattern.test(storefrontDockerfile)) {
      fail(`storefront Dockerfile does not declare ARG ${name}`)
    }
    if (!envPattern.test(storefrontDockerfile)) {
      fail(`storefront Dockerfile does not export ${name} through ENV`)
    }
  }
}

try {
  const staging = composeConfig('anyjersey-staging')
  const production = composeConfig('anyjersey-prod')
  assertTopology(staging, 'anyjersey-staging')
  assertTopology(production, 'anyjersey-prod')

  const env = { ...process.env }
  delete env.COMPOSE_PROJECT_NAME
  const missingProject = spawnSync(
    'docker',
    ['compose', '--env-file', writeEnv(undefined), '-f', composePath, 'config'],
    { cwd: path.dirname(composePath), env, encoding: 'utf8' }
  )
  if (missingProject.status === 0) {
    fail('Compose renders without an explicit COMPOSE_PROJECT_NAME')
  }

  const requiredCredentials = [
    'COMPOSE_PROJECT_NAME',
    'GIT_SHA',
    'DB_PASSWORD',
    'REDIS_PASSWORD',
    'JWT_SECRET',
    'COOKIE_SECRET',
    'INTERNAL_API_SECRET',
    'STRIPE_API_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'RESEND_API_KEY',
    'SHIPPO_API_KEY',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
  ]
  for (const name of requiredCredentials) {
    const requiredPattern = new RegExp(`\\$\\{${name}:\\?[^}]+\\}`)
    if (!requiredPattern.test(composeSource)) {
      fail(`${name} is not required with :? interpolation`)
    }
  }

  const envNames = templateNames(envExample)
  const composeOwned = new Set(['DATABASE_URL', 'REDIS_URL', 'MEDUSA_WORKER_MODE', 'ADMIN_DISABLED'])
  for (const name of new Set([...templateNames(backendTemplate), ...templateNames(storefrontTemplate)])) {
    if (!composeOwned.has(name) && !envNames.has(name)) {
      fail(`infra/.env.example does not document ${name}`)
    }
  }

  for (const secret of requiredCredentials.filter(
    (name) => !['COMPOSE_PROJECT_NAME', 'GIT_SHA'].includes(name)
  )) {
    const value = envExample.match(new RegExp(`^${secret}=(.*)$`, 'm'))?.[1]
    if (value !== '') {
      fail(`infra/.env.example must leave credential ${secret} empty`)
    }
  }

  const requiredReadmePhrases = [
    'anyjersey-staging',
    'anyjersey-prod',
    'secrets',
    'database',
    'volumes',
    'r2',
    'prefix',
    'domains',
    'migration',
    'git sha',
    'backup',
    'restore',
    'kc family home',
    'paraguay plan',
    'verbiest',
    'personal data',
  ]
  const normalisedReadme = readme.toLowerCase()
  for (const phrase of requiredReadmePhrases) {
    if (!normalisedReadme.includes(phrase)) fail(`README does not document ${phrase}`)
  }

  console.log('PASS: staging and production Compose topology is isolated and complete')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}
NODE
