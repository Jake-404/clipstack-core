# Deployment

Production runbook for taking `core/` from local dev to a real public deployment.

## 1. Audience and scope

This is for engineers deploying `core/` to production — Mission Control (the `services/approval-ui` Next.js app), the eight Python backend services (`agent-crewai`, `agent-langgraph`, `pii-detection`, `output-moderation`, `voice-scorer`, `performance-ingest`, `percentile-predictor`, `bandit-orchestrator`), and the shared substrate (Postgres with pgvector + RLS, Qdrant, Redpanda, Langfuse, LiteLLM). It does not cover the proprietary `signals/` or `hosted/` trees — those live in private repos under separate licenses and ship through their own deployment paths. The local-dev parallel for everything below is `UI_QUICKSTART.md` and `CONTRIBUTING.md`; the end-to-end behaviour the deploy must preserve is in `docs/closed-loop.md`.

## 2. Production topology

The recommended shape — a Vercel front, a Railway / Fly.io back, a managed-data middle.

### App tier

- **`approval-ui` (Next.js 15)**: Vercel is the path of least resistance. The framework is Vercel-native, the typedRoutes + page-data collection in `pnpm build` matches their build pipeline exactly, and the platform's serverless function model fits the API routes under `app/api/`. Other targets work — Cloudflare Pages, AWS Amplify, a self-managed Node 20 host behind a load balancer — but you take on more wiring per surface.
- **The eight Python services**: Railway, Fly.io, or Render. Each ships its own `Dockerfile` under `services/<name>/Dockerfile` (verified for all 8). FastAPI behind `uvicorn`, no shared filesystem requirement except `bandit-orchestrator` (see §9). Heroku, ECS, or any other container platform works the same way.

### Data tier

- **Postgres**: Neon. Provision in the same region as your app tier — `eu-west-2` is the baseline (matches the legacy stack). Postgres 16 is the production target; `pg_upgrade` to 17 is supported when Neon offers it. The schema requires the `pgvector` extension (`company_lessons.embedding` and `content_embeddings.embedding` are `vector(384)` columns with ivfflat indexes — see migration `0007_alter_embedding_to_vector.sql`). Confirm pgvector is available before provisioning.
- **Qdrant**: Qdrant Cloud or self-hosted. Per-workspace cosine collections (the voice-scorer creates one per company on first write). The footprint is tiny by default; the `1GB` free tier holds dozens of workspaces' lesson + voice corpora.
- **Redpanda**: Redpanda Cloud is the closest match to the local docker-compose Redpanda binary. Confluent Cloud or Upstash Kafka are drop-in alternatives — every producer in `core/` speaks the Kafka wire protocol via `aiokafka`. The 9 named topics live in `services/shared/events/topics.py`; partition keys are always `company_id`.

### Observability

- **Langfuse**: self-host on the same infra as the app tier (cheaper at scale, no SaaS bill, you already have Postgres) or Langfuse Cloud (paid, zero ops). Either way, set `LANGFUSE_ENABLED=true` and copy the public + secret keys into the service env. Trace conventions are in `docs/observability.md`.
- **Errors**: Sentry, Datadog, OTLP — every service emits structured JSON via `structlog`, so any aggregator with a JSON parser handles the firehose.

### LLM router

- **LiteLLM**: self-host on the app tier (the local-dev image `ghcr.io/berriai/litellm:main-latest` deploys cleanly to Railway / Fly with the config at `infra/litellm/config.yaml`) or LiteLLM Cloud. `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are pass-throughs; `OPENROUTER_API_KEY` is optional.

## 3. Deployment order

Each step is runnable independently. Capture the connection string at every step — later steps consume them as env vars.

### Step 1 — Provision Postgres

Pick Neon (or any Postgres ≥ 14 with pgvector). Match the region to your app tier. Capture `DATABASE_URL` in the form `postgresql://<user>:<pass>@<host>/<db>`.

### Step 2 — Provision Qdrant

Qdrant Cloud free tier (1GB) is enough to start. Capture `QDRANT_URL` (e.g. `https://xyz.qdrant.io`) and `QDRANT_API_KEY`.

### Step 3 — Provision Redpanda

Redpanda Cloud, Confluent Cloud, or Upstash Kafka. Capture `REDPANDA_BROKERS` (a comma-separated `host:port` list).

### Step 4 — Apply migrations

The seven SQL files in `services/shared/db/migrations/` apply in lexical order against any Postgres ≥ 14 with pgvector available:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f services/shared/db/migrations/0001_init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f services/shared/db/migrations/0002_enable_rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f services/shared/db/migrations/0003_rbac_seed.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f services/shared/db/migrations/0004_post_metrics.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f services/shared/db/migrations/0005_content_claims.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f services/shared/db/migrations/0006_draft_revisions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f services/shared/db/migrations/0007_alter_embedding_to_vector.sql
```

The same pattern that `tests/integration/run-rls-test.sh` and `services/approval-ui/scripts/dev-setup.sh` use locally — there is no migration runner today; lexical order is the contract. Drizzle's `pnpm db:push` from `services/approval-ui/` is also valid once the team commits to it.

### Step 5 — Deploy LiteLLM

Self-host: deploy the `ghcr.io/berriai/litellm:main-latest` image to Railway / Fly with `infra/litellm/config.yaml` mounted at `/app/config.yaml` and `LITELLM_MASTER_KEY` set. Cloud: provision a LiteLLM Cloud project. Capture `LITELLM_BASE_URL` and `LITELLM_MASTER_KEY`.

### Step 6 — Generate the inter-service token

```bash
openssl rand -base64 32
```

This is `SERVICE_TOKEN` — the shared secret every Python service uses to authenticate against `approval-ui` and against each other. 32+ chars. Rotation lands in A.3+; for now, generate once and propagate.

### Step 7 — Generate the session cookie secret

```bash
openssl rand -base64 48
```

This is `SESSION_COOKIE_SECRET` — iron-session's AES-256-GCM key for the WorkOS session cookie. Must be 32+ chars.

### Step 8 — Deploy the eight Python services

Each service has its own `Dockerfile` under `services/<name>/Dockerfile`. For each, deploy and set:

```
DATABASE_URL=...
QDRANT_URL=...
QDRANT_API_KEY=...
REDPANDA_BROKERS=...
LITELLM_BASE_URL=...
LITELLM_MASTER_KEY=...
SERVICE_TOKEN=...
LANGFUSE_HOST=...
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_ENABLED=true
ENVIRONMENT=production
EVENTBUS_ENABLED=true
CLIPSTACK_RELEASE=<your-deploy-tag>
```

Per-service base URLs (set on every service that calls another):

```
APPROVAL_UI_BASE_URL=https://your-app.example.com
VOICE_SCORER_BASE_URL=https://voice-scorer.example.com
PERCENTILE_PREDICTOR_BASE_URL=https://percentile-predictor.example.com
BANDIT_ORCHESTRATOR_BASE_URL=https://bandit-orchestrator.example.com
PII_DETECTION_BASE_URL=https://pii-detection.example.com
OUTPUT_MODERATION_BASE_URL=https://output-moderation.example.com
PERFORMANCE_INGEST_BASE_URL=https://performance-ingest.example.com
```

Use the public URLs from your platform deployment — not the docker-compose hostnames the local stack uses (`http://bandit-orchestrator:8008`, etc.). Set `EVENTBUS_ENABLED=true` once Redpanda is reachable; until then, the producers stay disabled and the closed loop runs degraded (see `docs/closed-loop.md` "Fail-soft semantics").

Stub flags (`PII_STUB_MODE`, `MODERATION_STUB_MODE`, `VOICE_SCORER_STUB_MODE`, `PREDICTOR_STUB_MODE`, `BANDIT_STUB_MODE`, `INGEST_STUB_MODE`, `CREWAI_DRY_RUN`, `LANGGRAPH_DRY_RUN`) default to `0` in production. Setting any to `1` is permitted but the service logs a structured warning per request.

### Step 9 — Deploy approval-ui to Vercel

```bash
cd services/approval-ui
vercel link
```

Set env vars in the Vercel dashboard or via `vercel env add`:

```
DATABASE_URL=...
SESSION_COOKIE_SECRET=...
SERVICE_TOKEN=...
WORKOS_API_KEY=...
WORKOS_CLIENT_ID=...
WORKOS_REDIRECT_URI=https://your-app.example.com/api/auth/callback
WORKOS_AUTO_PROVISION=0
NODE_ENV=production
LANGFUSE_HOST=...
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_ENABLED=true
VOICE_SCORER_BASE_URL=...
PERCENTILE_PREDICTOR_BASE_URL=...
BANDIT_ORCHESTRATOR_BASE_URL=...
PII_DETECTION_BASE_URL=...
OUTPUT_MODERATION_BASE_URL=...
PERFORMANCE_INGEST_BASE_URL=...
AGENT_LANGGRAPH_BASE_URL=...
AGENT_CREWAI_BASE_URL=...
```

Public URLs from step 8. Then deploy:

```bash
vercel deploy --prod
```

### Step 10 — Verify

Hit the fleet-health endpoint:

```bash
curl https://your-app.example.com/api/health/services
```

Every service should report `reachable: true`. The endpoint is implemented at `services/approval-ui/app/api/health/services/route.ts`, has no auth requirement (so monitors can poll it), and is fail-soft per service — a `baseUrlConfigured: false` row means the env var is unset; a configured-but-unreachable row means the service is down. Both surface in the response.

## 4. WorkOS setup

The auth flow is documented in full at `docs/auth.md`. Production-specific notes:

1. Create a WorkOS account (free tier covers small workspaces) and an organisation for your domain.
2. Configure Authkit with at least one connection (Google / Microsoft / email-password / SAML).
3. Add `https://your-app.example.com/api/auth/callback` to the WorkOS allowed redirect URIs.
4. Set `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI` in the approval-ui env.
5. Set `WORKOS_AUTO_PROVISION=0` in production. The default flips to `0` when `NODE_ENV=production` so this is belt-and-braces — the platform refuses auto-provision in production unless explicitly enabled. Set `=1` only after a real onboarding flow takes over the new-user path.

The AUTH_STUB env-var path (`AUTH_STUB_USER_ID` + `AUTH_STUB_COMPANY_ID`) is refused at runtime when `NODE_ENV=production` — `services/approval-ui/lib/api/auth.ts` throws a 500 if either is set in a production build.

## 5. Smoke tests

Run after every production deploy. Match the smoke-test rule in `CONTRIBUTING.md` — verify the layer you touched, top to bottom.

```bash
# 1. Liveness — approval-ui responds with its envelope shape.
curl https://your-app.example.com/api/health
# → 200, { ok: true, data: { service: "approval-ui", ... } }

# 2. Fleet — every backend service reachable.
curl https://your-app.example.com/api/health/services
# → 200, every service `reachable: true`

# 3. Login — visit /login in a browser, confirm 302 to WorkOS.
open https://your-app.example.com/login

# 4. After completing WorkOS auth, you land on Mission Control.
#    Tiles render with empty arrays until first content lands — that's
#    the fail-soft contract, not a bug.

# 5. Agent service dry-run — exercise the publish pipeline without
#    actually invoking LiteLLM.
curl -X POST https://agent-langgraph.example.com/workflows/publish_pipeline/start \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"draft_id": "test", "company_id": "test"}'
# With LANGGRAPH_DRY_RUN=1 set on the service, returns a stub run_id
# without calling LiteLLM.
```

## 6. Migrations and zero-downtime upgrades

Migrations are forward-only and forward-compatible. The contract: any new migration must work with both the old and the new application code for at least one deploy cycle.

**Two-phase pattern for incompatible changes** (column drops, type changes, NOT NULL on existing rows):

- **Phase 1 — additive deploy.** Ship the new schema (new column / new index / new table) plus application code that reads the new shape and writes both new and old. Backfill any historical rows.
- **Phase 2 — cleanup deploy.** Ship application code that reads only the new shape. Then ship a migration that drops the old column.

Forward-only means rollback is not a database operation. Rolling an app version back rolls the schema reads back; the schema itself stays where it is.

There is no migration runner today. Production should apply `services/shared/db/migrations/*.sql` in lexical order at deploy time — same as `tests/integration/run-rls-test.sh` and `services/approval-ui/scripts/dev-setup.sh`. Drizzle's `pnpm db:push` from `services/approval-ui/` is the alternative once the team commits to running `db:generate` on every schema change.

## 7. Backups

- **Postgres**: Neon ships automatic point-in-time recovery — 7-day retention on the free tier, 30-day on Pro. Configure to your tolerance. RPO and RTO targets live in `docs/dr/sla.md`.
- **Bandit state**: `bandit-orchestrator` keeps per-bandit Thompson posteriors at `BANDIT_DATA_DIR/{bandit_id}.json` on the container's filesystem. The optional periodic S3-compatible backup ships in `services/bandit-orchestrator/backup.py` — set `BANDIT_BACKUP_ENABLED=true` and `BANDIT_BACKUP_S3_BUCKET=<bucket>` (and `BANDIT_BACKUP_S3_ENDPOINT_URL` for R2 / MinIO / Wasabi). The backup writes one object per bandit plus a `_manifest.json` index keyed by sha256. Restore is scriptable from the manifest. See `services/bandit-orchestrator/README.md` and the `backup.py` module docstring for the full contract.
- **Qdrant**: snapshot via the Qdrant API or your cloud's automated backup feature. Per-workspace collections mean a partial restore can target a single tenant.
- **Redpanda**: replication factor `≥ 3` in production. Snapshot via the cloud's tools; Redpanda Cloud and Confluent Cloud both ship managed snapshots.

## 8. Monitoring

- **App tier**: Vercel's built-in (web vitals, function invocations, edge cache hit rate). Errors surface in the Vercel dashboard.
- **Python services**: stdout / stderr to your platform's log aggregator. Every service emits structured JSON via `structlog`. Any JSON parser handles it.
- **Traces**: Langfuse — set `LANGFUSE_ENABLED=true` and the public + secret keys per service. Trace conventions and the per-service coverage matrix are in `docs/observability.md`.
- **Errors**: integrate Sentry, Datadog, or any OTLP-compatible aggregator. The structlog firehose is your input.
- **Uptime**: external probe (Pingdom, Better Uptime, UptimeRobot) against `/api/health/services`. The endpoint is auth-free by design, returns one envelope for the whole fleet, and distinguishes "not configured" from "configured but down."

## 9. Scaling

- **`approval-ui`**: stateless. Horizontal scale on Vercel — concurrency cap is per-account and lifts on request.
- **The eight Python services**: stateless except `bandit-orchestrator`. The orchestrator persists Thompson posteriors at `BANDIT_DATA_DIR` on the container's filesystem. Pin to one replica until `BANDIT_BACKUP_ENABLED=true` is wired and you have a restore drill that works; once backups are in place, shard by `company_id` to scale horizontally.
- **Postgres**: vertical first (Neon's compute scaling is the lowest-friction lever). Partition by `company_id` second — the schema is built for it; `withTenant(companyId, fn)` in `services/approval-ui/lib/db` already enforces RLS scoping per request.
- **Redpanda**: partition counts live in `services/shared/events/topics.py` (one constant per topic, partition key is `company_id` everywhere). If metric ingest is the bottleneck, bump `content.metric_update` first — that is the highest-volume topic in the closed loop.
- **LiteLLM**: per-model rate limits + the fallback chain in `infra/litellm/config.yaml`. Self-hosted scales by replicating the proxy behind a load balancer; LiteLLM Cloud handles it for you.

## 10. Rollback

- **App tier**: `vercel rollback` for approval-ui, `fly deploy --image <previous>` for the Python services. Sub-second on Vercel; tens of seconds on Fly. Both are non-destructive — the previous build artefact is retained.
- **Schema**: forward-only migrations means rollback is the *application-version* rollback above. The schema stays where it is; the previous app version reads it correctly because every migration is forward-compatible.
- **Bandit state**: restore from the S3 manifest — see `services/bandit-orchestrator/backup.py` and the README. Restore one bandit's `<bandit_id>.json` from S3 to `BANDIT_DATA_DIR` and the orchestrator's lifespan rescan picks it up on next start.

## 11. Cost estimates

All figures below are rough monthly costs in USD as of 2026-Q2 — provider pricing changes frequently; treat as a planning floor, not a quote.

| Component | Floor | Notes |
|---|---|---|
| Neon Postgres | `$19/mo` (Pro) | Most workspaces fit. Free tier covers dev only. |
| Vercel | `$0` (Hobby) / `$20` (Pro) / `$40+` (Team) | Hobby works for solo; Pro for production. |
| Railway (Python services × 8) | `$40-100/mo` | `$5/mo` base + per-service usage. Fly.io is similar. |
| Qdrant Cloud | `$0` (free 1GB) / `$9` (starter) / `$35` (standard) | Free tier holds dozens of workspaces. |
| Redpanda Cloud | `$0` (free dev) / `$99` (starter) | Confluent / Upstash priced similarly. |
| Langfuse | `$0` (self-hosted) / `$29+` (cloud) | Self-host on the existing Postgres + app-tier saves the line item. |
| LiteLLM | `$0` (self-hosted) | Model API costs (Anthropic, OpenAI) pass through. |

**Total floor**: `$40-200/mo` for a small workspace running everything self-hosted-where-possible. LLM API costs dominate at scale — a workspace publishing daily across 5 platforms with full agent orchestration runs `$200-1000/mo` in model spend alone. The rebate path (USP 10 metering, CLIP discount on metered debits) is what compresses that envelope at the platform level.

## 12. Open questions

What this doc does not yet answer — pinned for the next sprint.

- **Status page**: not yet deployed (per `CLAUDE.md` "Status page deployed: not started"). Candidate stack lives at `docs/dr/status-page.md`. Current decision tree: `statuspage.io` (paid, zero ops, polished), `cstate` (free, GitHub Pages, manual incident posts), or a custom surface fed by `/api/health/services`. No commitment yet.
- **Cross-region Postgres replica**: not yet provisioned (per `CLAUDE.md` "Cross-region Postgres replica: not started"). RPO and RTO targets are in `docs/dr/sla.md`. Triggered by the first SLA-bearing contract.
- **WorkOS production carve-outs**: email-domain workspace mapping (currently auto-provision creates a *solo* workspace per user — the `*@acme.com → acme workspace` mapping is a separate config table), multi-workspace switching UI (currently picks the latest non-revoked membership), and MFA enforcement for admin roles (`users.mfa_enrolled_at` is written but not yet read). All flagged in `docs/auth.md` "What this slice does NOT include."
