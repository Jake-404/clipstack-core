#!/usr/bin/env bash
# Clipstack Mission Control — one-command local dev setup.
#
# Brings up Postgres, applies migrations, seeds a demo workspace, writes
# .env.local with auth-stub bypass, and tells you to run pnpm dev. Idempotent;
# safe to re-run after schema or seed changes.
#
# Usage (from the approval-ui dir or the repo root):
#   bash services/approval-ui/scripts/dev-setup.sh
#
# Prereqs: docker (for the postgres container), node 20+, pnpm 9+, psql.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APPROVAL_UI_DIR="$REPO_ROOT/services/approval-ui"
MIGRATIONS_DIR="$REPO_ROOT/services/shared/db/migrations"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"

DB_USER="clipstack"
DB_PASS="change-me-locally"
DB_NAME="clipstack"
DB_HOST="localhost"
DB_PORT="5432"
LOCAL_DB_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# These match the seed script's deterministic UUIDs so AUTH_STUB resolves
# to the seeded user + workspace without a WorkOS round-trip.
DEMO_USER_ID="00000000-0000-0000-0000-000000000002"
DEMO_COMPANY_ID="00000000-0000-0000-0000-000000000001"

step() { printf "\n\033[1;36m[setup]\033[0m %s\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m⚠\033[0m %s\n" "$*"; }
die()  { printf "\n\033[31m[setup] %s\033[0m\n" "$*" >&2; exit 1; }

# ─── 1. Prereq checks ──────────────────────────────────────────────────────

step "Checking prerequisites"
command -v pnpm >/dev/null 2>&1   || die "pnpm not found. Install: npm i -g pnpm"
command -v node >/dev/null 2>&1   || die "node not found. Install Node 20+."

NODE_MAJOR="$(node -v | sed -E 's/v([0-9]+).*/\1/')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node 20+ required (you have $(node -v))."
fi

# Postgres + pgvector path: prefer Docker if available; fall back to a
# local brew-managed postgres@16 + pgvector for Mac users without
# Docker. Either way, by the end of section 2 we have a Postgres
# accepting connections on localhost:5432 with pgvector available.
HAVE_DOCKER=""
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  HAVE_DOCKER="yes"
fi

ok "pnpm + node $(node -v) present; docker=${HAVE_DOCKER:-no}"

# ─── 2. Postgres ───────────────────────────────────────────────────────────

if [ -n "$HAVE_DOCKER" ]; then
  step "Bringing up Postgres (docker compose)"
  if ! docker ps --format '{{.Names}}' | grep -q '^clipstack-postgres'; then
    (cd "$REPO_ROOT" && docker compose up -d postgres)
    ok "postgres container started"
  else
    ok "postgres container already running"
  fi
else
  step "No Docker — using local Postgres via Homebrew"
  command -v brew >/dev/null 2>&1 || die "no docker AND no brew. Install one: https://docs.docker.com/desktop/ or https://brew.sh"

  # Install postgresql@17 + pgvector if missing. Both are quick
  # installs on a fresh Mac (~30s). pgvector links against the running
  # postgres install so order matters: postgresql first, then pgvector.
  if ! brew list postgresql@17 >/dev/null 2>&1; then
    step "Installing postgresql@17 via brew (one-time, ~30s)"
    brew install postgresql@17
  else
    ok "postgresql@17 already installed"
  fi
  if ! brew list pgvector >/dev/null 2>&1; then
    step "Installing pgvector via brew"
    brew install pgvector
  else
    ok "pgvector already installed"
  fi

  # psql + dropdb live under postgresql@17's bin dir; add to PATH for
  # this script's lifetime so the migration loop works.
  PG_BIN="$(brew --prefix)/opt/postgresql@17/bin"
  export PATH="$PG_BIN:$PATH"
  command -v psql >/dev/null 2>&1 || die "psql still not on PATH after brew install — try 'brew link postgresql@17'"

  # Start the service if not already running.
  if ! brew services list | grep -E '^postgresql@17\s+started' >/dev/null 2>&1; then
    step "Starting postgresql@17 service"
    brew services start postgresql@17
    sleep 2
  else
    ok "postgresql@17 service already running"
  fi

  # Create the clipstack role + db if they don't exist. The brew
  # default user is the current shell user; we don't touch that, just
  # add a clipstack role on top so the rest of the script (which
  # connects as the clipstack user) works without surgery.
  CURRENT_USER_DB="$(whoami)"
  if ! psql -h localhost -p 5432 -U "$CURRENT_USER_DB" -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" 2>/dev/null | grep -q 1; then
    step "Creating clipstack role + database"
    # SUPERUSER for local dev only — migration 0002 creates the
    # clipstack_admin BYPASSRLS role and assigns ownership; that
    # requires CREATEROLE. SUPERUSER subsumes that and matches the
    # admin role Neon hands out for migrations on the production path.
    # The runtime app connects as clipstack_app (per migration 0002),
    # which is the role with NOBYPASSRLS — so prod safety is preserved.
    psql -h localhost -p 5432 -U "$CURRENT_USER_DB" -d postgres \
      -c "CREATE ROLE ${DB_USER} WITH LOGIN SUPERUSER PASSWORD '${DB_PASS}';" \
      || die "failed to create role"
    psql -h localhost -p 5432 -U "$CURRENT_USER_DB" -d postgres \
      -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" \
      || die "failed to create database"
    ok "role + database created (SUPERUSER for local-dev migrations)"
  else
    # Idempotent: if the role exists from a prior run with CREATEDB-only,
    # bump it to SUPERUSER. Cheap; lets re-runs heal a half-set-up DB.
    psql -h localhost -p 5432 -U "$CURRENT_USER_DB" -d postgres \
      -c "ALTER ROLE ${DB_USER} WITH SUPERUSER;" >/dev/null 2>&1 || true
    ok "clipstack role + database already exist"
  fi
fi

# Wait for it to accept connections.
step "Waiting for Postgres to be ready"
for i in $(seq 1 30); do
  if PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c 'SELECT 1' >/dev/null 2>&1; then
    ok "postgres reachable on $DB_HOST:$DB_PORT"
    break
  fi
  if [ "$i" -eq 30 ]; then
    die "postgres didn't come up after 30s. Check 'docker compose logs postgres'."
  fi
  sleep 1
done

# ─── 3. Migrations ─────────────────────────────────────────────────────────

step "Applying migrations from $MIGRATIONS_DIR"
shopt -s nullglob
applied=0
for mig in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$mig")"
  # Idempotent: each migration uses CREATE ... IF NOT EXISTS / ALTER ... or
  # its own guard. Re-applying is a no-op for already-applied ones; new ones
  # land. The output below is concise; enable -v for verbose.
  if PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
       -v ON_ERROR_STOP=1 -q -f "$mig" >/dev/null 2>&1; then
    ok "applied $name"
    applied=$((applied + 1))
  else
    # Re-run with output so the user sees which migration broke.
    warn "$name failed — re-running with output:"
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
      -v ON_ERROR_STOP=1 -f "$mig" || die "migration $name failed"
  fi
done
shopt -u nullglob
ok "$applied migrations applied"

# ─── 4. Install pnpm deps ──────────────────────────────────────────────────

step "Installing pnpm deps"
# --ignore-workspace bypasses any parent pnpm-workspace.yaml that may exist
# above the repo root (Jake's local has one). Without this, pnpm walks up
# and refuses to install in the right place, which silently breaks the
# seed step that needs `tsx` available via `pnpm exec`.
(cd "$APPROVAL_UI_DIR" && pnpm install --ignore-workspace --silent)
ok "deps installed"

# ─── 5. Run seed (the seed script handles its own idempotency) ─────────────

step "Seeding demo workspace"
export DATABASE_URL="$LOCAL_DB_URL"
# Use the locally-installed tsx binary directly so we don't bounce through
# pnpm's workspace resolution (which walks up to a parent pnpm-workspace.yaml
# on Jake's machine and breaks the resolve).
TSX_BIN="$APPROVAL_UI_DIR/node_modules/.bin/tsx"
[ -x "$TSX_BIN" ] || die "tsx not at $TSX_BIN — pnpm install must have failed"
(cd "$APPROVAL_UI_DIR" && "$TSX_BIN" scripts/seed-demo.ts) || die "seed-demo failed"

# ─── 6. Write .env.local with AUTH_STUB bypass ─────────────────────────────

step "Writing $APPROVAL_UI_DIR/.env.local (AUTH_STUB bypass for local dev)"
ENV_LOCAL="$APPROVAL_UI_DIR/.env.local"
SESSION_PWD="$(openssl rand -base64 48 | tr -d '=+/' | cut -c1-64)"

# Inherit ANTHROPIC_API_KEY + FAL_KEY from the parent .env if it exists.
# Jake keeps these at /Users/jakecampton/Documents/Claude/clipstack/.env.
# Without them the agent services can't make real LLM/media calls — the
# UI still renders, but bandit allocate / Strategist kickoff / asset.
# generate all hit unauthorized.
PARENT_ENV="$REPO_ROOT/../.env"
ANTHROPIC_KEY=""
FAL_KEY_VAL=""
OPENAI_KEY=""
if [ -f "$PARENT_ENV" ]; then
  # Source the parent .env in a subshell + extract just the keys we want.
  # Avoids polluting the current shell with the rest of the parent's vars.
  while IFS='=' read -r k v; do
    case "$k" in
      ANTHROPIC_API_KEY) ANTHROPIC_KEY="$v" ;;
      FAL_KEY) FAL_KEY_VAL="$v" ;;
      OPENAI_API_KEY) OPENAI_KEY="$v" ;;
    esac
  done < "$PARENT_ENV"
  ok "inherited keys from $PARENT_ENV"
else
  warn "no parent .env at $PARENT_ENV — agent services will run keyless"
fi

cat > "$ENV_LOCAL" <<ENVEOF
# Generated by services/approval-ui/scripts/dev-setup.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Local-dev only. Re-run dev-setup.sh to regenerate.

NODE_ENV=development
DATABASE_URL=$LOCAL_DB_URL

# AUTH_STUB bypasses WorkOS so you can poke at the UI without the OAuth
# round-trip. Refused at NODE_ENV=production by lib/api/auth.ts. The IDs
# here resolve to the seeded "Demo User" + "Demo Workspace".
AUTH_STUB_USER_ID=$DEMO_USER_ID
AUTH_STUB_COMPANY_ID=$DEMO_COMPANY_ID

# Iron-session cookie key. Random per setup so you can't accidentally
# reuse a key across machines. Don't commit .env.local. Both names
# exported because the codebase reads SESSION_COOKIE_SECRET (per
# lib/api/session.ts) and dev-setup historically wrote SESSION_COOKIE_
# PASSWORD; keeping both keeps either side working without a converge.
SESSION_COOKIE_SECRET=$SESSION_PWD
SESSION_COOKIE_PASSWORD=$SESSION_PWD

# Inherited from parent ../.env when present. Empty values mean the
# agent services run without LLM/media access — the UI still renders
# but bandit kickoff / Strategist / asset.generate all fail.
ANTHROPIC_API_KEY=$ANTHROPIC_KEY
FAL_KEY=$FAL_KEY_VAL
OPENAI_API_KEY=$OPENAI_KEY

# Backend service URLs left empty — Mission Control's tiles fail-soft
# (empty data, "service unreachable" indicators) when these are unset.
# Set them when you bring up the python services via docker compose.
BANDIT_ORCH_BASE_URL=
PERFORMANCE_INGEST_BASE_URL=
AGENT_LANGGRAPH_BASE_URL=
AGENT_CREWAI_BASE_URL=
PII_DETECTION_BASE_URL=
OUTPUT_MODERATION_BASE_URL=
VOICE_SCORER_BASE_URL=
PERCENTILE_PREDICTOR_BASE_URL=

# Service-token for cross-service auth. Empty in local dev = stub-mode
# fallbacks return [] / skipped=true.
SERVICE_TOKEN=
ENVEOF
chmod 600 "$ENV_LOCAL"
ok "wrote $ENV_LOCAL (chmod 600)"

# ─── 7. Done ───────────────────────────────────────────────────────────────

# Detect a running pnpm dev process so we can yell at the user to restart.
# The dev server reads .env.local at boot; rotating SESSION_COOKIE_SECRET
# without restart leaves stale-cookie sessions that read as logged-out and
# render the page empty — the most likely "nothing there" symptom.
DEV_RUNNING=""
if pgrep -f "next dev" >/dev/null 2>&1 || pgrep -f "pnpm.*dev" >/dev/null 2>&1; then
  DEV_RUNNING="yes"
fi

cat <<DONEEOF

\033[1;32m[setup] Done.\033[0m

DONEEOF

if [ -n "$DEV_RUNNING" ]; then
  cat <<RESTART
\033[1;33m[setup] WARNING: a dev server appears to be running.\033[0m

You MUST kill it and restart — this script just rotated
SESSION_COOKIE_SECRET so any session cookie issued before now is
invalid. The page will render empty until you restart.

  pkill -f "next dev" || pkill -f "pnpm.*dev"
  cd $APPROVAL_UI_DIR
  pnpm dev --ignore-workspace

RESTART
else
  cat <<START
To start Mission Control:

  cd $APPROVAL_UI_DIR
  pnpm dev --ignore-workspace

Then open http://localhost:3000.

START
fi

cat <<TAIL

You'll land on Mission Control logged in as the Demo User in the
"Demo Workspace" tenant — populated by the seed script with:
  • 12 drafts (4 awaiting approval, 4 published, mix of others)
  • 30 audit-log rows over the last 7d
  • 8 captured editorial lessons
  • 40 metric snapshots driving the KPI tiles
  • 6 agents (1 working, 1 blocked, 4 idle)

Pages to visit:
  /                                — Mission Control bento
  /inbox                           — pending-approval queue
  /drafts/<draft-id>               — draft body + metric history (click any
                                     row in /inbox or the queue tile)
  /experiments                     — bandits list (empty until orchestrator
                                     ships state — running this stack is
                                     out of scope for the seed)
  /activity                        — audit-log feed
  /performance?range=7d            — workspace KPI history
  /workspace, /calendar, /members,
  /settings                        — placeholder pages

To reset: re-run this script. The seed deletes-then-inserts the demo
tenant so it's safe to run repeatedly.

TAIL
