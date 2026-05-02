# Contributing to Clipstack Core

## Welcome

This is the engine room of Clipstack — an MIT-licensed orchestration framework, Mission Control UI shell, and adapter scaffolding for an AI-native marketing platform. The repo holds n8n workflow templates, CrewAI role-based crews, LangGraph stateful workflows, the approval-UI Next.js shell, eight backend FastAPI services, the multi-tenant Postgres schema with row-level security, vector recall in Qdrant, observability via Langfuse, and the bandit pipeline that closes the generate→publish→measure→learn loop. Design partners — VeChain today, others in flight — clone this repo, run it against their own keys, and integrate against the documented API surface.

This is not the SaaS. The proprietary `signals/` tree (regulatory regime YAMLs, per-platform algorithm heuristics, crisis playbooks, vertical-pack persona libraries, KOL roster sub-product) and the proprietary `hosted/` tree (Stripe + USDC settlement, workspace provisioning, onboarding, customer-success tooling) live in separate private repos under separate licenses. The hard rule — `core/` cannot import from `signals/` — is enforced in CI by `scripts/check-core-isolation.sh`, and is the load-bearing property that keeps this repo runnable end-to-end with the proprietary trees deleted from disk. If you ever find yourself reaching for a regulatory regime, an algorithm heuristic, a persona library, or a crisis playbook from inside `core/`, the abstraction lives in the wrong place — open an issue, not a PR with the import.

## Quick start

Prerequisites — Node 20+ (CI runs Node 20), pnpm 9+, Python 3.11+, [uv](https://docs.astral.sh/uv/), Docker + Docker Compose. ffmpeg is only needed if you wire the legacy Hyperframes path; it is not on the `core/` critical path.

```bash
# 1. Clone + bring up the platform deps.
git clone https://github.com/ClipstackHQ/core.git
cd core
cp .env.example .env  # edit with your keys

# 2. Start the stack (postgres + qdrant + redpanda + langfuse + litellm + n8n + ollama + traefik).
docker compose up -d
docker compose ps  # all services should reach healthy within ~5 minutes

# 3. Apply DB migrations against the running Postgres. The 7 SQL files in
#    services/shared/db/migrations/ are designed to apply in lexical order;
#    the integration-test runner is the canonical applier and works locally.
chmod +x tests/integration/run-rls-test.sh
PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres \
  PGDATABASE=clipstack tests/integration/run-rls-test.sh

# 4. Seed a demo workspace with realistic content so every Mission Control
#    tile renders (idempotent — wipes + rebuilds the demo tenant on rerun).
cd services/approval-ui
pnpm install
pnpm exec tsx scripts/seed-demo.ts

# 5. Run the UI.
pnpm dev
# → http://localhost:3000
```

You can run the Python services individually when you need them — each follows the same pattern:

```bash
cd services/agent-crewai
uv sync
uv run uvicorn main:app --reload --port 8001
# → http://localhost:8001/health
```

The other ports — `agent-langgraph` 8002, `pii-detection` 8003, `output-moderation` 8004, `voice-scorer` 8005, `performance-ingest` 8006, `percentile-predictor` 8007, `bandit-orchestrator` 8008. Every service exposes `GET /health` and most expose a `/producer/status` or `/consumer/status` companion. The full route catalogue is in `core/docs/api.md`.

## Architecture overview

Three-tier open-core: `core/` (this repo, MIT, public) owns the orchestration framework, the Mission Control UI, the multi-tenant Postgres schema, and the closed-loop bandit pipeline. `signals/` (private, signed access) owns the regulated-vertical signal packs. `hosted/` (private) owns the SaaS commerce layer. Inside `core/`, the runtime is four-layer:

```
   ┌──────────────────────────────────────────────────────────────────┐
   │                         Mission Control                          │
   │              services/approval-ui  (Next.js 15)                  │
   │   ─ approval queue ─ branch view ─ experiments ─ anomalies       │
   └──────────────────────────────────────────────────────────────────┘
                                   │
                       ┌───────────┴───────────┐
                       ▼                       ▼
   ┌──────────────────────────┐   ┌──────────────────────────┐
   │   agent-crewai  :8001    │   │   agent-langgraph :8002  │
   │   role-based crews       │◀─▶│   stateful workflows     │
   │   ─ content_factory      │   │   ─ publish_pipeline     │
   │   ─ trend_detector       │   │   ─ paid_campaign_review │
   │   ─ algorithm_probe …    │   │   ─ crisis_response …    │
   └──────────────────────────┘   └──────────────────────────┘
                       │                       │
                       ▼                       ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │                       Backend services                           │
   │   ─ pii-detection      :8003  Presidio + custom recognisers      │
   │   ─ output-moderation  :8004  Llama Guard 3 via Ollama           │
   │   ─ voice-scorer       :8005  Qdrant cosine retrieval            │
   │   ─ performance-ingest :8006  histograms + anomaly + bus emit    │
   │   ─ percentile-predict :8007  LightGBM per workspace             │
   │   ─ bandit-orchestratr :8008  Thompson sampling + reward listener│
   └──────────────────────────────────────────────────────────────────┘
                                   │
   ┌──────────────────────────────────────────────────────────────────┐
   │   Shared substrate                                               │
   │   ─ postgres (RLS, pgvector)  ─ qdrant  ─ redpanda  ─ litellm    │
   │   ─ langfuse (traces)         ─ n8n     ─ ollama    ─ traefik    │
   └──────────────────────────────────────────────────────────────────┘
```

The closed loop — generate → publish → measure → learn — is documented in detail at `core/docs/closed-loop.md`. Auth flow at `core/docs/auth.md`. Trace conventions at `core/docs/observability.md`.

## Repo layout

```
core/
├── docs/                  Engineering docs — closed-loop, observability, auth, api
├── contracts/             Solidity contracts (escrow, agent-budget — Phase B+)
├── infra/                 LiteLLM router config, n8n workflow templates, traefik rules
├── legal/                 ToS / Privacy / IP / DPA / AI-Disclosure templates ("not legal advice")
├── prompts/               Generic prompt templates (compliance-pack overlays live in signals/)
├── scripts/               check-core-isolation.sh — the CI gate against signals/ imports
├── services/
│   ├── adapters/          CRM/CMS/Analytics/Ads/Chat/Email/Video/SEO interface scaffolds
│   ├── agent-crewai/      FastAPI :8001 — role-based crews
│   ├── agent-langgraph/   FastAPI :8002 — stateful workflows + PostgresSaver checkpoints
│   ├── approval-ui/       Next.js 15 — Mission Control UI + 14 API routes + Drizzle ORM
│   ├── bandit-orchestrator/    FastAPI :8008 — Thompson sampling + reward consumer
│   ├── compliance-pack/   Open-core scaffolding for compliance overlays from signals/
│   ├── crisis-monitor/    Doc 5 §1.6 placeholder — concrete impl lands with signals/
│   ├── crypto/            x402 server middleware + on-chain helpers (Phase B+)
│   ├── journalist-crm/    The one workflow we build ourselves (no viable OSS alt)
│   ├── metering/          USP 10 metering primitives
│   ├── output-moderation/ FastAPI :8004 — Llama Guard 3
│   ├── percentile-predictor/   FastAPI :8007 — LightGBM
│   ├── performance-ingest/     FastAPI :8006 — histograms, anomaly detector, bus producer
│   ├── pii-detection/     FastAPI :8003 — Presidio
│   ├── provenance/        USP 8 claim-verifier scaffolding
│   ├── shared/            zod + pydantic schema mirrors, event envelopes, SQL migrations
│   ├── signal-fetcher/    Stub adapter for signals/ — public interface, private impl
│   └── voice-scorer/      FastAPI :8005 — cosine retrieval + SetFit (gated)
├── tests/
│   ├── eval/              Agent eval harness (placeholder)
│   ├── integration/       cross-tenant-rls.sql + run-rls-test.sh — the RLS guard test
│   └── smoke/             End-to-end smoke checks (placeholder)
├── docker-compose.yml     8-service local stack with healthchecks
├── CLAUDE.md              Top-level project facts (read first)
├── README.md              The pitch + architecture summary
├── CONTRIBUTING.md        This file
└── LICENSE                MIT
```

## Local dev workflow

The typical loop:

```bash
# 1. Branch.
git checkout -b feat/your-change   # or fix/, chore/, docs/

# 2. Edit. For TypeScript work, typecheck after every meaningful change:
cd services/approval-ui
pnpm exec tsc --noEmit

# 3. For Python work, the per-service commands are uniform:
cd services/<your-service>
uv run ruff check .
uv run mypy .   # advisory until type coverage matures

# 4. Build (catches typedRoutes mismatches + page-data collection issues
#    that pnpm typecheck doesn't):
cd services/approval-ui
pnpm build

# 5. Smoke-test the change at the layer you touched. The HARD RULE is in
#    core/CLAUDE.md's "Smoke-test rule" — for a route, that means curling
#    or fetching the endpoint with a real session cookie or service token
#    and asserting the response shape; for a DB-bearing change, run the
#    cross-tenant RLS test against an ephemeral Postgres.

# 6. Commit + open a PR.
```

Drizzle migrations: `pnpm db:generate` (build a new migration from schema diff) and `pnpm db:push` (apply against the configured `DATABASE_URL`). New migrations land in `services/shared/db/migrations/` keyed by the `000N_` prefix; the integration-test runner applies them in lexical order.

## Coding standards

The full set is in `core/CLAUDE.md` under the "Security & code-quality standards" section — treat external input as hostile, auth on every route, no secrets in code, parameterised queries only, explicit errors, timeouts and rate limits, idempotency on mutating POSTs, type safety, pre-accept audit, and the smoke-test rule. Don't restate these here; read the source.

A few `core/`-specific reinforcements:

- **No new tokens, fonts, colours, animations, or shadows** outside `services/approval-ui/lib/design-tokens/` and `services/approval-ui/app/globals.css`. Doc 8 of the build spec is the source of truth; deviations get rejected in review.
- **Numbers are mono.** Every metric, ID, hash, price, timestamp uses `font-mono tabular-nums`. Non-negotiable.
- **No multi-agent chat surfaces.** Only the orchestrator (Mira) gets a chat dock. Hierarchy-of-interaction rule.
- **Adapters use the abstract interface.** Concrete CRM/CMS/Analytics/Ads adapters extend the base class in `services/adapters/<category>/base.py`. The platform calls against the interface only.
- **Every external-facing output passes through QA critics** — brand-safety, claim-verifier, devil's-advocate. No bypass.

## Testing

What exists today:

- **Cross-tenant RLS integration test** — `tests/integration/cross-tenant-rls.sql` + `tests/integration/run-rls-test.sh`. Applies all 7 SQL migrations against an ephemeral Postgres, then asserts: no-tenant session sees zero rows (fail-closed), tenant-A reads return only A's rows, cross-tenant INSERT denied by RLS WITH CHECK, switching `app.current_company_id` flips visibility, `include_client_children` flag widens reads only when set, and 384-d pgvector roundtrips through `company_lessons.embedding` with cosine self-distance ≈ 0. Runs in CI via the `rls-integration` job; runs locally against any PG 14+ with pgvector available.
- **Per-service unit tests** — Python services use pytest under `[project.optional-dependencies].dev`. The closed-loop pipeline ships with 61 local logic + contract assertions across the 5 service-side slices (reverse-index attribution, histogram percentile math, z-score anomaly, velocity edge cases, register_bandit + publish_to_channel + post_metrics + recent_anomalies + anomaly-scan contract mirrors). See `core/docs/closed-loop.md` for the breakdown.
- **TypeScript typecheck + Next build** — `pnpm typecheck` and `pnpm build` in `services/approval-ui` run in CI. The build step catches a class of issues `tsc --noEmit` doesn't (typedRoutes mismatches, page-data collection invoking module load, stricter end-to-end import resolution).

What's missing:

- **Page-level UI tests.** The Mission Control surfaces have no Playwright or Vitest coverage today. A planned slice ships happy-path coverage on `/inbox`, `/drafts/[id]`, `/experiments`, and `/performance`.
- **Agent service end-to-end tests.** `agent-crewai` and `agent-langgraph` have build-time validation (`_kickoff()` builds the crew/graph as part of the dry-run path) but no integration tests that exercise a live LiteLLM-backed run. Lands once the LiteLLM eval harness in `tests/eval/` matures.

To run them locally:

```bash
# RLS test (requires a running Postgres on $PGHOST:$PGPORT with pgvector available).
PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres \
  PGDATABASE=clipstack_test tests/integration/run-rls-test.sh

# Python service tests.
cd services/<your-service>
uv sync --extra dev
uv run pytest

# Approval-UI typecheck + build.
cd services/approval-ui
pnpm install
pnpm typecheck
pnpm build
```

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request. Five top-level jobs; the python-lint job runs as an 8-way matrix across the Python services, so the dashboard surfaces 11 jobs in total once GitHub expands the matrix:

- **`isolation`** — runs `scripts/check-core-isolation.sh`. Fails the build if any file under `core/` imports from `signals/`. The hard rule.
- **`ui-typecheck`** — `pnpm typecheck` followed by `pnpm build` against `services/approval-ui` with `NODE_ENV=production`.
- **`python-lint`** — for each of the 8 Python services, runs `uv sync --extra dev`, `uv run ruff check .`, and `uv run mypy . || true` (mypy advisory until type coverage matures).
- **`docker-compose-validate`** — `docker compose config --quiet` against the root `docker-compose.yml`. Catches schema drift in compose definitions before they hit a real boot.
- **`rls-integration`** — boots a `postgres:16` service container, apt-installs `postgresql-16-pgvector`, applies all 7 migrations, and runs `cross-tenant-rls.sql` with `ON_ERROR_STOP=1`. Catches the bug class typecheck/build/ruff don't — RLS policy regressions, missing pgvector, vector-column type or dimension drift.

PRs that touch only docs (`docs:` prefix) still run the full matrix — keeps the workflow definition simple, and doc-only PRs are usually green in under a minute anyway.

## Pull requests

1. **Fork** the repo on GitHub.
2. **Branch** from `main` with a descriptive prefix — `feat/`, `fix/`, `chore/`, `docs/`. One concern per branch.
3. **CI must pass.** All five jobs (11 with matrix expansion) green before review. If a check is red, fix it before requesting review — don't ask the reviewer to triage CI.
4. **Review.** Open the PR with a one-paragraph "why" and a verification note (`I tested X by Y` — match the smoke-test rule in `core/CLAUDE.md`). A reviewer with merge rights signs off; for sensitive areas (RLS, auth, billing) two reviewers are required.

By submitting a PR, you agree your contribution is MIT-licensed.

## Code of conduct

We use the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Be civil. Disagree on technical merits. Assume good faith. Maintainers reserve the right to remove contributions or contributors that violate the covenant — both happen rarely; both happen.

## License

MIT — see [LICENSE](./LICENSE). The MIT grant covers everything in this tree. The proprietary `signals/` and `hosted/` trees ship under separate licenses and are not in this repo; nothing in `core/` is gated on them.
