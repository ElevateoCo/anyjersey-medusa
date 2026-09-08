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
