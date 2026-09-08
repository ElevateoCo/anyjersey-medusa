#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
medusa_config="$repo_root/spike/backend/medusa-config.ts"
backend_env="$repo_root/spike/backend/.env.template"
deploy_env="$repo_root/spike/.env.deploy.template"

node - "$medusa_config" "$backend_env" "$deploy_env" <<'NODE'
const fs = require('node:fs')

const configPath = process.argv[2]
const source = fs.readFileSync(configPath, 'utf8')
const backendEnv = fs.readFileSync(process.argv[3], 'utf8')
const deployEnv = fs.readFileSync(process.argv[4], 'utf8')

function assertMatch(description, pattern, value = source) {
  if (!pattern.test(value)) {
    console.error(`FAIL: ${description}`)
    process.exit(1)
  }
}

assertMatch(
  'medusa-config reads MEDUSA_WORKER_MODE with a shared default',
  /process\.env\.MEDUSA_WORKER_MODE\s*\|\|\s*['"]shared['"]/
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

console.log('PASS: Medusa worker mode is parsed, validated, mapped, and documented')
NODE
