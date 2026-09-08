#!/usr/bin/env bash
#
# Time a restore. That number decides whether the images stay in Postgres.
#
# The media decision has been open since the images went into the database, and the trigger
# for moving them was always stated as restore time — the 410 MB of WebP rides along in every
# base backup and every point-in-time restore. Nobody has ever measured it, so nobody could
# make the decision.
#
# This dumps the live database, restores it into a scratch one, and prints how long each half
# took with and without the image bytes. Run it against a copy, never against production.
#
#   ./restore-drill.sh                    # uses .env's DATABASE_URL
#   DATABASE_URL=postgres://… ./restore-drill.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/.env" ] && set -a && . "$HERE/.env" && set +a

: "${DATABASE_URL:?DATABASE_URL is not set — put it in backend/.env or pass it in}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

SCRATCH="restore_drill_$$"
BASE="${DATABASE_URL%/*}"

say() { printf '  %s\n' "$*"; }
secs() { printf '%.1f' "$1"; }

say ""
say "┌─ RESTORE DRILL ─────────────────────────────────────────"
say "│ source   ${DATABASE_URL%%\?*}"
say "│ scratch  $SCRATCH"
say "│"

# ---------------------------------------------------------------- dump
t0=$(date +%s.%N)
pg_dump --format=custom --no-owner --no-acl --file="$WORK/full.dump" "$DATABASE_URL"
t1=$(date +%s.%N)
DUMP_ALL=$(echo "$t1 - $t0" | bc)
SIZE_ALL=$(du -m "$WORK/full.dump" | cut -f1)

# The same dump without the image bytes, which is what a move to object storage would leave.
t0=$(date +%s.%N)
pg_dump --format=custom --no-owner --no-acl --exclude-table-data='media_asset' \
        --file="$WORK/nomedia.dump" "$DATABASE_URL"
t1=$(date +%s.%N)
DUMP_LEAN=$(echo "$t1 - $t0" | bc)
SIZE_LEAN=$(du -m "$WORK/nomedia.dump" | cut -f1)

say "│ dump, with images     $(secs "$DUMP_ALL")s   ${SIZE_ALL} MB"
say "│ dump, without images  $(secs "$DUMP_LEAN")s   ${SIZE_LEAN} MB"
say "│"

# ---------------------------------------------------------------- restore
psql "$BASE/postgres" -q -c "drop database if exists \"$SCRATCH\";"
psql "$BASE/postgres" -q -c "create database \"$SCRATCH\";"

t0=$(date +%s.%N)
pg_restore --no-owner --no-acl --dbname="$BASE/$SCRATCH" "$WORK/full.dump" >/dev/null 2>&1 || true
t1=$(date +%s.%N)
RESTORE_ALL=$(echo "$t1 - $t0" | bc)

psql "$BASE/postgres" -q -c "drop database if exists \"$SCRATCH\";"
psql "$BASE/postgres" -q -c "create database \"$SCRATCH\";"

t0=$(date +%s.%N)
pg_restore --no-owner --no-acl --dbname="$BASE/$SCRATCH" "$WORK/nomedia.dump" >/dev/null 2>&1 || true
t1=$(date +%s.%N)
RESTORE_LEAN=$(echo "$t1 - $t0" | bc)

psql "$BASE/postgres" -q -c "drop database if exists \"$SCRATCH\";"

say "│ restore, with images     $(secs "$RESTORE_ALL")s"
say "│ restore, without images  $(secs "$RESTORE_LEAN")s"
say "│"

TOTAL_ALL=$(echo "$DUMP_ALL + $RESTORE_ALL" | bc)
TOTAL_LEAN=$(echo "$DUMP_LEAN + $RESTORE_LEAN" | bc)
SAVED=$(echo "$TOTAL_ALL - $TOTAL_LEAN" | bc)

say "│ round trip, with images     $(secs "$TOTAL_ALL")s"
say "│ round trip, without images  $(secs "$TOTAL_LEAN")s"
say "│ the images cost             $(secs "$SAVED")s"
say "└─────────────────────────────────────────────────────────"
say ""
say "This is the number the R2 decision was waiting on."
say "If the round trip with images is an outage you would not accept,"
say "set MEDIA_BACKEND=r2 — the adapter is built and the two coexist."
say ""
