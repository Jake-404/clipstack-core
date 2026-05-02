# Architecture

The canonical visual reference for Clipstack core's service mesh, data plane, and message bus. New engineers and design partners should be able to load this page and have the platform's wiring legible in five minutes — without grepping the repo to find which port a service runs on or which producer publishes which topic.

## 1. Overview

Clipstack ships as a three-tier open-core: `core/` (MIT, public, this tree), `signals/` (proprietary, sold separately, holds regime YAMLs + per-platform heuristics + vertical-pack libraries), and `hosted/` (proprietary, runs the SaaS at clipstack.app — Stripe + USDC settlement + provisioning). The hard rule is one-way: `core/` cannot import from `signals/` or `hosted/`, and CI enforces it via `core/scripts/check-core-isolation.sh`. Every architectural decision below sits inside `core/` and must run end-to-end with `SIGNALS_LOADED=false`.

This document covers `core/` only — the orchestration framework, Mission Control UI shell, real-time evaluator services, the closed-loop data plane, and the infrastructure that binds them. For the closed-loop pipeline trace see `core/docs/closed-loop.md`; for tracing conventions see `core/docs/observability.md`; for auth see `core/docs/auth.md`.

## 2. Service mesh

Eight first-party services plus eight shared infrastructure containers. The human-facing surface is `approval-ui` at `:3000`; everything else either serves it (orchestrators, evaluators) or feeds it (the data plane).

```
              ┌───────────────────────────────────┐
              │     approval-ui :3000             │
              │     Next.js 15 — Mission Control  │
              │     WorkOS Authkit + iron-session │
              └───────────────────────────────────┘
                  │            │            │
       ┌──────────┘            │            └──────────┐
       │                       │                       │
       ▼                       ▼                       ▼
┌───────────────┐    ┌──────────────────────┐    ┌──────────────────┐
│ Agent orch    │    │ Real-time evaluators │    │ Data plane       │
│               │    │                      │    │                  │
│ agent-crewai  │    │ pii-detection :8003  │    │ performance-     │
│        :8001  │    │ output-moder. :8004  │    │ ingest    :8006  │
│ FastAPI       │    │ voice-scorer  :8005  │    │ FastAPI          │
│ 8-role        │    │ percentile-          │    │ histograms +     │
│ content_      │    │   predictor   :8007  │    │ velocity +       │
│   factory +   │    │ bandit-              │    │ z-score anomaly  │
│ 5 real-time   │    │   orchestr.   :8008  │    │                  │
│ crews         │    │                      │    │                  │
│               │    │ Presidio / Llama     │    │                  │
│ agent-        │    │ Guard / Qdrant       │    │                  │
│   langgraph   │    │ cosine / LightGBM /  │    │                  │
│        :8002  │    │ Thompson sampling    │    │                  │
│ + Postgres    │    │                      │    │                  │
│ checkpointer  │    │                      │    │                  │
└───────────────┘    └──────────────────────┘    └──────────────────┘
       │                       │                       │
       ▼                       ▼                       ▼
┌────────────────────────────────────────────────────────────────┐
│                        Infrastructure                          │
│                                                                │
│  postgres :5432   qdrant :6333    redpanda :9092               │
│  langfuse :3030   litellm :4000   ollama   :11434              │
│  n8n      :5678   traefik :80/:443                             │
└────────────────────────────────────────────────────────────────┘
```

Dominant call paths — every cross-service hop is HTTP except the bus:

- `approval-ui` → `bandit-orchestrator` `/bandits/:id/state` for the experiments tile
- `approval-ui` ← `performance-ingest` POST `/post-metrics` (durability path for snapshots)
- `agent-crewai` → `litellm` `:4000` for every model call (Anthropic + OpenAI fallback chains)
- `agent-crewai` → `voice-scorer` `:8005` `/score` and `approval-ui` `/api/companies/:cid/lessons/recall` (HTTP) during draft generation
- `agent-langgraph` → `bandit-orchestrator` `/bandits/:id/allocate` from the `bandit_allocate` node
- `agent-langgraph` → `redpanda` topic `content.published` from `publish_to_channel`
- `performance-ingest` → `redpanda` topics `content.metric_update` + `content.anomaly` from `/ingest`
- `bandit-orchestrator` ← `redpanda` topic `content.metric_update` (auto-reward listener)
- `voice-scorer` → `qdrant` `:6333` for cosine retrieval; `voice-scorer` → `litellm` `:4000` for the `voice-embed` profile
- `output-moderation` → `ollama` `:11434` for Llama Guard 3
- `agent-crewai`, `agent-langgraph`, `litellm` → `langfuse` `:3030` for traces

`traefik` terminates TLS in front of `approval-ui` for any deployment that exposes a public hostname; everything else stays on the docker network.

## 3. Data plane

Postgres `:5432` holds 15 tables across 7 idempotent migrations in `services/shared/db/migrations/0001_init.sql` → `0007_alter_embedding_to_vector.sql`. Drizzle mirrors live alongside the Next.js app at `services/approval-ui/lib/db/schema/`. Every tenant-scoped table runs RLS — `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY` against the `clipstack_app` role since `0002_enable_rls.sql`, with policies that compare `row.company_id` against the session-local `app.current_company_id` setting that `withTenant(companyId, fn)` populates on every connection.

**Tenancy.** `companies` (workspaces — agencies, in-house teams, design partners), `users` (one row per humans + service principal), `memberships` (the join — links a user to a company with a role and ownership of nested-tenancy via `parent_company_id`).

**Roles + permissions.** `roles` (per-workspace role definitions, seeded by `0003_rbac_seed.sql`), `permissions` (the (role, resource, action) tuples granted to a role).

**Content lifecycle.** `drafts` (every artifact generated by an agent, pre- or post-approval), `draft_revisions` (immutable history per draft since `0006_draft_revisions.sql`), `approvals` (approve/deny rows with USP 5 rationale), `content_claims` (claim-extraction rows since `0005_content_claims.sql`, the substrate for ClaimVerifier + USP 8 provenance), `content_embeddings` (per-claim 384-d vectors since `0007_alter_embedding_to_vector.sql`).

**Performance + learning.** `post_metrics` (snapshots emitted by `performance-ingest` since `0004_post_metrics.sql` — one row per `(draft_id, platform, metric, observed_at)` plus the derived `percentile` + `z_score` + `velocity`), `company_lessons` (the mistake-ledger — every approval rationale becomes a recallable lesson with a 384-d embedding since `0007`), `audit_log` (append-only breadcrumb — `actorKind` + `actorId` + `action` + `details_json`, never PII), `agents` (one row per agent type known to a workspace).

**Metering.** `meter_events` (per-output counter for USP 10 transparency — every paid asset call lands a row that the `/api/companies/:cid/meter-events` route surfaces).

`pgvector` is required at deploy time — `company_lessons.embedding` and `content_embeddings.embedding` are `vector(384)` with `ivfflat` cosine indexes (`lists=100`). The dimensionality is locked by the `voice-embed` LiteLLM profile; swapping the underlying model means a backfill, not a config flip.

## 4. Message bus

Redpanda `:9092` carries the 9 named topics from `services/shared/events/topics.py`. Partition counts are tuned to expected fan-out — `content.metric_update` runs at 16 partitions because every workspace × platform × metric collides on `company_id` keying, while `platform.algorithm_shift` is single-partition because it carries platform-level events that all consumers replay in order. Every envelope conforms to `services/shared/events/envelope.py`'s `EventEnvelopeBase`; partition key is `company_id` so a workspace's events stay strictly ordered across the publish → metric update → reward sequence.

| Topic | Producer | Consumer | Partitions | Carries |
|---|---|---|---|---|
| `content.published` | `agent-langgraph` `publish_to_channel` node (`services/agent-langgraph/producer.py`) | (none consumed today — campaign rollup is the gated follow-up) | 4 | One row per channel publish, with `bandit_variant_id` set when the draft was variant-gated. |
| `content.metric_update` | `performance-ingest` `/ingest` (`services/performance-ingest/producer.py`) | `bandit-orchestrator` reward listener (`services/bandit-orchestrator/consumer.py`) | 16 | One row per metric snapshot with derived `percentile` + `velocity`; reward signal for the closed-loop bandit. |
| `content.anomaly` | `performance-ingest` `/ingest` (z-score gate ≥ 2.5σ) | (none consumed today — Mission Control alert tile is gated UI work) | 4 | One row when an absolute z-score exceeds the gate and the histogram has ≥ `ANOMALY_MIN_SAMPLES` samples. |
| `trend.detected` | `agent-crewai` `trend_detector` crew | (gated — Strategist crew will subscribe in A.3+) | 2 | One row per detected trend candidate per platform per workspace. |
| `competitor.signal` | `agent-crewai` `competitor_intel` crew (planned A.3+) | (gated) | 2 | Competitor-side activity that should bias the next generation cycle. |
| `platform.algorithm_shift` | `agent-crewai` `algorithm_probe` crew | (gated) | 1 | Platform-level signal — single partition because it's not workspace-scoped. |
| `campaign.brief_updated` | `approval-ui` brief-edit route (gated — campaigns table follows) | `agent-crewai` Strategist (gated) | 2 | Campaign-level state diff for in-flight generations. |
| `live_event.detected` | `agent-crewai` `live_event_monitor` crew | `agent-crewai` `engagement` crew (gated) | 2 | Real-time event signal — sport, news, market move — that warrants a reactive draft. |
| `engagement.opportunity` | `agent-crewai` `engagement` crew | (gated) | 8 | Per-mention reply-or-skip decision payload. |

Producers degrade to no-ops when `EVENTBUS_ENABLED=false` or when aiokafka can't reach the broker — the service stays healthy and `producer.is_enabled` reports `False`. Consumers behave the same: the bandit consumer skips startup cleanly if the broker is unreachable, and the manual `/reward` HTTP route on `bandit-orchestrator` stays available as a fallback path.

## 5. Vector store

Qdrant `:6333` holds per-workspace voice corpora — one collection named `voice-{company_id}` per workspace, populated by the `/train` route on `voice-scorer` and queried by `/score`. Embeddings are 384-dimensional (`VOICE_EMBED_DIM=384`, locked) and the collection's distance metric is cosine; `voice-scorer` enforces dimension-equality on every insert so an operator can't silently swap the underlying LiteLLM `voice-embed` profile to a non-384-d model without the service refusing inserts.

Per-client filtering — when a workspace runs nested tenancy, the `client_id` lives on the payload, not in a separate collection — keeps the collection count proportional to workspaces rather than to (workspace × client). The cosine score is the mean similarity to the top-K nearest in-voice exemplars; the SetFit classifier head that blends with cosine is gated behind the `[ml]` extra and lands when a workspace seeds enough labelled samples.

## 6. Tracing

Langfuse `:3030` is the canonical trace store, self-hosted on the same Postgres. Conventions, the per-service coverage matrix, and the PII rules are documented in `core/docs/observability.md` — refer to that doc rather than re-encoding here. The relevant invariant for architectural reasoning: every trace carries `trace.metadata.company_id` (REQUIRED, tenant scope) and the LiteLLM-emitted `generation` spans nest under the active trace via `langfuse_trace_id` propagation, so a single content_factory kickoff produces one parent trace with ~30–40 nested spans across the 8 agent roles.

## 7. Auth

Phase B.6 — WorkOS Authkit signs sessions, iron-session encrypts + signs the cookie, the `SESSION_COOKIE_SECRET` env var keys the cookie. Service-to-service calls use the `SERVICE_TOKEN` shared secret carried in the `X-Service-Token` header; `resolveServiceOrSession()` in `services/approval-ui/lib/api/` accepts either. For local dev without WorkOS provisioned, `AUTH_STUB` env vars short-circuit the cookie path — refused at runtime when `NODE_ENV=production`. Full flow + the dev auto-provision carve-out live in `core/docs/auth.md`.

## 8. External integrations

**Wired.** WorkOS (Authkit + SSO/SAML/MFA shipped B.6); Anthropic + OpenAI via the LiteLLM router with named fallback chains (`WRITER_MODEL` → `CLASSIFIER_MODEL` → `JUDGE_MODEL` → `VOICE_EMBED_MODEL`); Postgres (Neon for production, `postgres:16-alpine` locally); Langfuse (self-hosted on the same Postgres); Redpanda (single-binary broker, topics auto-created on first publish).

**Gated on platform OAuth.** X / LinkedIn / Reddit / TikTok / Instagram + newsletter providers — `performance-ingest`'s `/pollers/*` routes are stubs because the platform-side OAuth flows haven't been built. The `/ingest` wire protocol is identical to what a live poller will produce, so the stubs are a driver-only swap. Choice of which platforms ship first is a product call, not an engineering one.

**Gated on launch.** x402 + the CLIP token — the per-agent metered budget gate is fully designed (see CLAUDE.md "Parked follow-up: per-agent metered budget gate") but trigger-gated on either the first agency complaint about per-image friction or CLIP launching on mainnet. Until then, `asset.generate` for METERED-class providers parks for human approval per call.

## 9. Failure modes and degradation

Every cross-service call has a timeout, a try/catch, and a structured-warn fallback — the principle is one service down doesn't cascade.

- **Postgres down** — `approval-ui` 5xx (no fail-soft; tenancy is load-bearing). The orchestrators degrade to stub responses where the route allows it; reads that need RLS context just return empty.
- **Redpanda down** — `producer.is_enabled` flips to `False`; `emit()` no-ops; the `bandit-orchestrator` reward listener stops attributing until the broker recovers (no double-counting on recovery — at-least-once delivery via manual offset commit). The manual `/reward` HTTP route on `bandit-orchestrator` stays available as a fallback signal path.
- **LiteLLM down** — `recall_lessons` returns `[]`; `voice-scorer` returns `skipped:true`; `agent-crewai` crews fall back to no-context generation. Every LLM-touching tool checks for `skipped` in the response body and adapts.
- **Qdrant down** — `voice-scorer` returns `skipped:true` with a warning log; BrandQA passes the draft (fail-open on the voice gate, since voice is advisory not regulatory).
- **Langfuse down** — tracing SDK no-ops; the agent crews don't notice. Tracing is advisory, not blocking.
- **Ollama down** — `output-moderation` falls back to a conservative-deny verdict; PII-detection is unaffected (Presidio runs in-process).

The cross-service interaction contract: every HTTP fetch carries `AbortSignal.timeout(ms)`, every route returns a `skipped:true` envelope when its real backend isn't reachable, and the audit log captures what was skipped so ops can see the degradation surface in `audit_log` queries.

## 10. Repo layout

```
core/
├── CONTRIBUTING.md          # Sprint rhythm + DoD
├── LICENSE                  # MIT
├── README.md                # Top-level pitch + quick-start
├── UI_QUICKSTART.md         # 5-minute approval-ui local setup
├── docker-compose.yml       # The 8-container stack
├── contracts/               # Event + envelope contracts (zod/pydantic)
├── docs/                    # This tree
│   └── dr/                  # RPO 15min / RTO 1hr DR runbook
├── infra/                   # docker-compose support
│   ├── litellm/             # Named-profile config.yaml + fallbacks
│   ├── n8n-workflows/       # Importable workflow JSONs
│   └── traefik/             # TLS termination + routing rules
├── legal/                   # ToS / Privacy / DPA / AI-Disclosure
├── prompts/                 # System prompts
│   ├── guardrails/
│   ├── tasks/
│   └── voice/
├── scripts/                 # Repo scripts incl. check-core-isolation.sh
├── services/                # First-party services + shared/
│   ├── adapters/            # CRM/CMS/Analytics/Ads/etc. interfaces
│   ├── agent-crewai/        # FastAPI :8001 — content_factory + crews
│   ├── agent-langgraph/     # FastAPI :8002 — publish_pipeline + ckpt
│   ├── approval-ui/         # Next.js 15 :3000 — Mission Control
│   ├── bandit-orchestrator/ # FastAPI :8008 — Thompson + reward listener
│   ├── compliance-pack/     # Slot for proprietary regulatory packs
│   ├── crisis-monitor/      # Slot for USP 6 crisis playbooks
│   ├── crypto/              # x402 / settlement / wallets / identity
│   ├── journalist-crm/      # No viable open-source alternative
│   ├── metering/            # Per-output counter (USP 10)
│   ├── output-moderation/   # FastAPI :8004 — Llama Guard 3 via Ollama
│   ├── percentile-predictor/# FastAPI :8007 — LightGBM /predict /train
│   ├── performance-ingest/  # FastAPI :8006 — histograms + velocity + z
│   ├── pii-detection/       # FastAPI :8003 — Presidio + recognizers
│   ├── provenance/          # USP 8 content-claim provenance helpers
│   ├── shared/              # Cross-service — events/, db/migrations/
│   ├── signal-fetcher/      # Slot for signals/ adapter interfaces
│   └── voice-scorer/        # FastAPI :8005 — Qdrant cosine + embed
└── tests/                   # Cross-service tests
    ├── eval/
    ├── integration/
    └── smoke/
```

The slots inside `services/` (`compliance-pack`, `crisis-monitor`, `journalist-crm`, `metering`, `provenance`, `signal-fetcher`) are scaffold-only today — they hold the interface contracts that `signals/` and `hosted/` are expected to bind against. The eight FastAPI / Next.js services above with named ports are the live surface of `core/`.
