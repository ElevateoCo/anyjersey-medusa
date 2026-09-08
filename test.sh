#!/usr/bin/env bash
# Run every test suite in the project.
#
#   ./test.sh
#
# Three suites, three runners, because three languages:
#   tools/            python unittest  — parsing, description generation, dedupe
#   spike/backend     jest (unit)      — email templates, returns rule, rate limit, zones
#   spike/backend     jest (http)      — the money path against a real database
#   spike/storefront  vitest           — size ordering, money, query building, structured data
#
# Plus two static audits that do not need a browser:
#   spike/contrast_check.py  — WCAG AA contrast over the colour tokens
#   spike/a11y_selftest.py   — proves the a11y checks can actually fail
#
# Integration tests need Postgres and Redis up, and take about 70s. Pass --fast to skip
# them; CI should not.
set -uo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

fail=0
FAST=0
[ "${1:-}" = "--fast" ] && FAST=1
line() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

line "tools — python unittest"
python3 -m unittest discover -s tools/tests -t . 2>&1 | tail -4 || fail=1

line "backend — jest (unit)"
(cd spike/backend && TEST_TYPE=unit npx jest --silent 2>&1 | tail -6) || fail=1

if [ "$FAST" -eq 0 ]; then
  line "backend — jest (integration, real database)"
  if docker exec aj-postgres pg_isready -U aj >/dev/null 2>&1; then
    (cd spike/backend && LOG_LEVEL=error npm run test:integration:http 2>&1 \
      | grep -E 'PASS|FAIL|Tests:|Suites:') || fail=1
  else
    echo "  skipped — Postgres container not running (docker start aj-postgres aj-redis)"
  fi
fi

line "storefront — vitest"
(cd spike/storefront && npx vitest run 2>&1 | tail -5) || fail=1

line "storefront — typecheck"
(cd spike/storefront && npx tsc --noEmit && echo "  clean") || fail=1

line "contrast — WCAG AA over the colour tokens"
python3 spike/contrast_check.py 2>&1 | tail -2 || fail=1

line "accessibility — the checks can fail"
# A check that cannot fail passes whether the thing it guards works or not, which is
# exactly where "0 issues across 18 pages" would hide a broken audit.
python3 spike/a11y_selftest.py 2>&1 | tail -2 || fail=1

line "accessibility — static audit"
if curl -sf -o /dev/null http://localhost:3000/; then
  python3 spike/a11y_check.py 2>&1 | tail -4 || fail=1
else
  echo "  skipped (storefront not running)"
fi

if [ "$fail" -eq 0 ]; then
  printf '\n\033[32mall suites passed\033[0m\n\n'
else
  printf '\n\033[31mfailures above\033[0m\n\n'
fi
exit "$fail"
