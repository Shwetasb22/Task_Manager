#!/usr/bin/env bash
# Applies the database updates in supabase/migrations that this database has not had yet, in order,
# and records each one in opl_admin.schema_migrations (a schema the app's API cannot see).
#
#   DATABASE_URL=postgresql://... supabase/apply-migrations.sh            apply what is missing
#   DATABASE_URL=... supabase/apply-migrations.sh --dry-run                only list what would run
#   DATABASE_URL=... supabase/apply-migrations.sh --baseline 0014          first use on a database where
#        0001-0014 were already run by hand in the SQL Editor: records them without running them
#
# DATABASE_URL: Supabase → Project Settings → Database → Connection string (URI, "Session pooler").
# Needs psql (PostgreSQL client tools). Stops at the first error; each update is recorded only when it succeeded.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/migrations"
DRY=0 BASELINE=
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --baseline) BASELINE=$2; shift 2 ;;
    *) echo "Unknown option $1"; exit 2 ;;
  esac
done
[ -n "${DATABASE_URL:-}" ] || { echo "Set DATABASE_URL (Supabase → Project Settings → Database → Connection string)."; exit 2; }
PSQL=(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" <<'SQL' >/dev/null
set client_min_messages = warning;
create schema if not exists opl_admin;
revoke all on schema opl_admin from public;
create table if not exists opl_admin.schema_migrations (
  name text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);
SQL

applied=$("${PSQL[@]}" -At -c "select name || ' ' || checksum from opl_admin.schema_migrations")
pending=0
for f in "$DIR"/[0-9]*.sql; do
  name=$(basename "$f" .sql); num=${name%%_*}
  sum=$(md5sum "$f" | cut -d' ' -f1)
  prev=$(printf '%s\n' "$applied" | awk -v n="$name" '$1 == n { print $2 }')
  if [ -n "$prev" ]; then
    [ "$prev" = "$sum" ] || echo "note: $name changed since it was applied (not run again)"
    continue
  fi
  if [ -n "$BASELINE" ] && [ "$((10#$num))" -le "$((10#$BASELINE))" ]; then
    echo "recorded as already applied: $name"
    [ "$DRY" = 1 ] || "${PSQL[@]}" -c "insert into opl_admin.schema_migrations (name, checksum) values ('$name', '$sum')"
    continue
  fi
  pending=$((pending + 1))
  if [ "$DRY" = 1 ]; then echo "would apply: $name"; continue; fi
  echo "applying: $name"
  { echo "set client_min_messages = warning;"; cat "$f"; echo; echo "insert into opl_admin.schema_migrations (name, checksum) values ('$name', '$sum');"; } |
    "${PSQL[@]}" -f - || { echo "FAILED: $name. Fix the cause and run this again; it starts from $name."; exit 1; }
done
[ "$pending" = 0 ] && echo "The database is up to date." || true
