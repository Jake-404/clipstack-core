#!/usr/bin/env bash
# Cross-tenant RLS integration runner.
#
# Connects to a running Postgres instance, applies all 6 SQL migrations in
# order, then runs cross-tenant-rls.sql. Exits non-zero on any assertion
# failure (psql's ON_ERROR_STOP).
#
# Configured via env vars:
#   PGHOST     (default: localhost)
#   PGPORT     (default: 5432)
#   PGUSER     (default: postgres)
#   PGPASSWORD (default: postgres)
#   PGDATABASE (default: clipstack_test — created if missing)
#
# Used by .github/workflows/ci.yml (rls-integration job) with the standard
# postgres:16-alpine service container; works locally against any PG 14+
# you have running.

set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
TARGET_DB="${PGDATABASE:-clipstack_test}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATIONS_DIR="${ROOT}/services/shared/db/migrations"
TEST_SQL="${ROOT}/tests/integration/cross-tenant-rls.sql"

echo "[rls-test] target: ${PGUSER}@${PGHOST}:${PGPORT}/${TARGET_DB}"

# psql -tAc reads from the postgres maintenance DB; we always issue
# DROP / CREATE so each run starts from a clean slate.
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -tAc \
  "DROP DATABASE IF EXISTS ${TARGET_DB};" >/dev/null
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -tAc \
  "CREATE DATABASE ${TARGET_DB};" >/dev/null
echo "[rls-test] fresh database created"

# Apply migrations in lexical order — naming convention 000N_name.sql
# guarantees correct sequencing.
for migration in "${MIGRATIONS_DIR}"/*.sql; do
  name="$(basename "$migration")"
  echo "[rls-test] applying ${name}"
  # Pipe through psql with -v ON_ERROR_STOP=1 so any SQL error fails fast.
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" \
       -v ON_ERROR_STOP=1 -q -f "$migration" \
    || { echo "[rls-test] FAILED applying ${name}"; exit 1; }
done

echo "[rls-test] migrations applied; running cross-tenant assertions"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" \
     -v ON_ERROR_STOP=1 -f "$TEST_SQL"

echo "[rls-test] PASS"
