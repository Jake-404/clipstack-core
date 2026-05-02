# UI quickstart

One command to spin up Mission Control with a populated demo workspace.

## TL;DR

```bash
cd /path/to/clipstack/core
bash services/approval-ui/scripts/dev-setup.sh
cd services/approval-ui && pnpm dev
```

Open `http://localhost:3000`. You're logged in as Demo User in Demo Workspace.

## What `dev-setup.sh` does

1. Verifies prereqs (`docker`, `pnpm`, `psql`, `node 20+`)
2. Runs `docker compose up -d postgres` if it's not already running
3. Waits for Postgres to be reachable on `localhost:5432`
4. Applies every SQL file under `services/shared/db/migrations/` in lexical order
5. Runs `pnpm install` in `services/approval-ui/`
6. Runs the demo seed (`scripts/seed-demo.ts`) — populates one workspace with:
   - 12 drafts across the status spectrum (4 awaiting approval, 4 published, mix of others)
   - 30 audit-log rows over the last 7 days
   - 8 captured editorial lessons
   - 40 metric snapshots driving the KPI tiles
   - 6 agents (1 working, 1 blocked, 4 idle)
   - 7 approvals, 20 meter events
7. Writes `services/approval-ui/.env.local` with:
   - `DATABASE_URL` pointing at the local Postgres
   - `AUTH_STUB_USER_ID` + `AUTH_STUB_COMPANY_ID` matching the seeded user + workspace
   - A random `SESSION_COOKIE_PASSWORD`
   - Empty backend URLs (the tiles fail-soft to "no data" when those aren't set; that's expected for a UI-only run)

The `.env.local` is `chmod 600` and includes a comment indicating it's local-dev-only — the auth-stub bypass is refused at `NODE_ENV=production` by `lib/api/auth.ts`.

## What you can poke at

| Route | What you'll see |
|---|---|
| `/` | Mission Control bento — 9 real-data tiles populated by the seed |
| `/inbox` | 4 drafts awaiting your decision, oldest first |
| `/drafts/<id>` | Click any inbox row → body + 20-snapshot metric history table; if the draft is `awaiting_approval`, real approve/deny buttons land here |
| `/experiments` | Empty until you bring up `bandit-orchestrator` (out of scope for the seed) |
| `/experiments/<id>` | Per-arm posteriors + body excerpts + α/β math (also gated on the orchestrator) |
| `/activity` | 30+ audit rows grouped by date |
| `/performance?range=7d` | CTR, reach, impressions, engagement-percentile aggregations + per-platform table + weekly trend |
| `/performance?range=30d` or `?range=12w` | Same with different time windows |
| `/workspace`, `/calendar`, `/members`, `/settings` | Forward-looking placeholder pages — these surfaces ship with their product specs |

## What's NOT live without more setup

The Python backend services aren't started by `dev-setup.sh` (deliberately — they need API keys, model downloads, broker setup). The UI is **fail-soft** for every backend it can't reach: empty arrays, "service unreachable" indicators on the bus-health tile. That's intentional design, not a bug.

To bring up the full stack:

```bash
cd /path/to/clipstack/core
docker compose up -d
```

Then set the backend URLs in `services/approval-ui/.env.local`:

```bash
BANDIT_ORCH_BASE_URL=http://localhost:8008
PERFORMANCE_INGEST_BASE_URL=http://localhost:8006
AGENT_LANGGRAPH_BASE_URL=http://localhost:8002
SERVICE_TOKEN=<32-char secret>
# ... etc per the .env.local comments
```

## Resetting

Re-run `dev-setup.sh`. The seed deletes-then-inserts the demo tenant before re-seeding — idempotent.

To wipe everything (including the Postgres volume):

```bash
docker compose down -v
bash services/approval-ui/scripts/dev-setup.sh
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `setup: postgres didn't come up after 30s` | Docker isn't running, or `docker compose up -d postgres` failed. Check `docker compose logs postgres`. |
| `migration N failed` | Schema drift between migrations + your local DB. Run `docker compose down -v` to wipe and start fresh. |
| `seed-demo failed: foreign-key violation` | Migration 0003 (RBAC seed) didn't run. Re-run the setup script — it applies migrations in order. |
| Mission Control 401s on every API call | `.env.local` is missing or `AUTH_STUB_USER_ID` doesn't match the seed's user UUID. Re-run the setup script. |
| Tiles show "service unreachable" | Expected when the Python backends aren't running. See "What's NOT live" above. |

## Where this fits

- `services/approval-ui/scripts/dev-setup.sh` — the script
- `services/approval-ui/scripts/seed-demo.ts` — the seed
- `services/approval-ui/scripts/README.md` — seed-script details + idempotency notes
- `core/CONTRIBUTING.md` — full repo onboarding for design partners
- `core/docs/closed-loop.md` — what the product actually does end-to-end
