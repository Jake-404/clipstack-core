# API reference

Catalogue of every HTTP surface exposed by `core/`. Two cohorts:

1. **Approval-UI routes** — 16 Next.js App Router handlers under `services/approval-ui/app/api/**`. These are the workspace-facing surfaces: human approvals, lessons recall, post-metrics persistence, the auth flow, and read-through proxies onto the backend services. Session-cookie auth is the default; service-token auth is honoured on the routes the agent containers call.
2. **Backend service routes** — FastAPI handlers in the eight Python services under `services/{agent-crewai,agent-langgraph,bandit-orchestrator,performance-ingest,percentile-predictor,output-moderation,pii-detection,voice-scorer}/main.py`. These are the engines — agent kickoffs, bandit allocation, anomaly scans, percentile prediction, the safety + voice + PII gates. Service-token auth is the production path; an internal request from the agent containers always carries the token.

The catalogue is exhaustive against the codebase as of 2026-05-02. Routes reach this doc only after the corresponding handler has shipped.

## Auth model

Two paths, both documented in `core/docs/auth.md`.

**Session cookie.** WorkOS Authkit issues the user; `/api/auth/callback` writes an iron-session-encrypted cookie carrying `{ workosUserId, userId, activeCompanyId, authenticatedAt }`. Every approval-UI route resolves the cookie via `resolveSession()` in `services/approval-ui/lib/api/auth.ts`. Cookie attributes — `httpOnly`, `secure` in production, `sameSite=lax`, 30-day rolling expiry. Generate `SESSION_COOKIE_SECRET` with `openssl rand -base64 48`.

**Service token.** A shared secret in `SERVICE_TOKEN`, presented via the headers below. Resolves through `resolveServiceContext()` in the same auth module — constant-time comparison, fail-closed when the env var is unset, never silently downgrades on partial headers. Used by `agent-crewai`, `agent-langgraph`, and `performance-ingest` to talk to approval-UI on a specific workspace's behalf.

| Header | Required | Meaning |
|---|---|---|
| `X-Clipstack-Service-Token` | yes | Must match `SERVICE_TOKEN` byte-for-byte |
| `X-Clipstack-Active-Company` | yes | UUID of the workspace this call serves |
| `X-Clipstack-Service-Name` | recommended | Caller identifier; lands in audit-log details |

Routes annotated **session-only** explicitly do not honour service tokens — typically because the action is a human gate (e.g. approve/deny). Routes annotated **service-or-session** call `resolveServiceOrSession()` and accept either path.

The Python services accept the same three headers when called from `agent-langgraph` or `agent-crewai`. Their workspace check (`req.company_id == state.company_id`) is a defensive boundary on top of the token verification.

## Response envelope

All approval-UI routes return one of two JSON shapes, defined in `services/approval-ui/lib/api/respond.ts`:

```ts
// success
{ "ok": true, "data": <T> }

// failure
{ "ok": false, "error": { "code": <ApiErrorCode>, "message": <string>, "details"?: <unknown> } }
```

`ApiErrorCode` is the discriminated union from `services/approval-ui/lib/api/errors.ts`: `bad_request` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404), `conflict` (409), `validation_failed` (422), `rate_limited` (429), `internal` (500). `withApi()` wraps every handler so thrown `ApiError`s land as the typed envelope; unhandled errors collapse to a sanitised 500 — internal stack traces are never returned to the client.

Backend FastAPI services return their pydantic response models directly (no `ok`/`data` envelope). Failures land as FastAPI's standard `{ "detail": <string> }`. The orchestrator's `skipped: true` flag indicates a stub-mode response — the wire shape is final, but the underlying engine isn't exercised. Production deployments unset the per-service `*_STUB_MODE` flag; dev defaults to stub-on so the stack runs without keys.

## Idempotency

- `POST /api/approvals/:id/approve` and `/deny` both check `status == 'pending'` before mutating; a re-fire on a decided approval returns `bad_request` with the existing status. Safe to retry on network blip.
- `POST /api/companies/:cid/post-metrics` does not enforce a unique key; deduplication is the caller's responsibility (`performance-ingest`'s histogram path runs append-then-rank against prior state, so its repeat-call shape is well-defined).
- `POST /ingest` (performance-ingest) accepts an optional `request_id` for the same purpose; the service treats repeat IDs within the recent window as duplicates.
- `POST /bandits` (bandit-orchestrator) generates a fresh `bandit_id` per call — register is not idempotent; the caller is expected to register exactly once per (campaign × platform × pillar) and re-use the returned id.
- `POST /verify-claims` honours a `force` flag; without it, claims verified in the last 7 days are skipped.

Mutating routes that touch billing or external spend (`meter-events`, `verify-claims`) carry an `audit_log` row written inside the same transaction as the mutation, so partial-success states cannot leak.

## Rate limits

No rate limiter is currently mounted on either tier. Design partners should self-throttle:

- `/api/companies/:cid/lessons/recall` calls LiteLLM's embed endpoint once per request — keep agent loops bounded (the in-prompt recall block already caps at K=5).
- `/predict` (percentile-predictor) is cheap once a model is loaded but pays a cold-start cost; warm with a single dummy call after process boot.
- `/score` (voice-scorer) issues one LiteLLM embed + two Qdrant searches per call.

The `apps/api/src/app.ts` rate-limit harness from the legacy stack will land in `core/` as a follow-up; until then, treat 50 rps per workspace as a safe ceiling.

---

# Workspace

Routes that read and write workspace-scoped editorial state — drafts, lessons, post-metrics, meter events.

### `POST /api/companies/:companyId/lessons/recall`

`services/approval-ui/app/api/companies/[companyId]/lessons/recall/route.ts`

**Auth:** service-or-session. **Body schema:** `RecallBodySchema` in the same file —
`{ topic: string (1..2000), k: int (1..20, default 5), scope?: 'forever'|'this_topic'|'this_client', clientId?: uuid|null }`.

Cosine-similarity recall against `company_lessons.embedding` (vector(384), ivfflat index from migration `0007_alter_embedding_to_vector`). Embeds the topic via LiteLLM's `voice-embed` profile, runs `ORDER BY embedding <=> $vec ASC`, optionally filters by scope and client. Returns top-K lessons with similarity scores in `[0, 1]`.

**Response:** `{ topic_excerpt, scope, k, resultCount, lessons: [{ id, kind, scope, rationale, topicTags, clientId, capturedByUserId, capturedByAgentId, capturedAt, similarity }] }`.

**Side effects:** one `audit_log` row of kind `lessons.recalled` per call.

**Caller:** `agent-crewai`'s `recall_lessons` tool (Strategist + LongFormWriter + DevilsAdvocateQA + ClaimVerifier + BrandQA). Mission Control's "what your team learned" tile is planned.

### `GET /api/companies/:companyId/drafts/high-performers`

`services/approval-ui/app/api/companies/[companyId]/drafts/high-performers/route.ts`

**Auth:** service-or-session. **Query schema:** `QuerySchema` in the same file —
`{ kpi: 'ctr'|'engagement_rate'|'conversion_rate' (default engagement_rate), percentile: int 50..99 (default 75), k: int 1..20 (default 3), platform?: 'x'|'linkedin'|'reddit'|'tiktok'|'instagram'|'newsletter'|'blog', topic?: string 1..500 }`.

Returns the workspace's published drafts whose KPI lands at or above the requested percentile. With `topic` set, embeds it once via LiteLLM and re-ranks candidates by `0.6 * (kpi_percentile / 100) + 0.4 * (1 - cosine_distance)` against `content_embeddings.embedding`. Without `topic`, ranks by absolute KPI value. LiteLLM-unreachable falls back to KPI-only ranking with `embedFailedFallback: true` in the audit details.

**Response:** `{ kpi, percentile, k, platform, topic, rankingMode: 'topic_blended'|'kpi_only', results: [{ draftId, channel, title, bodyExcerpt, publishedAt, publishedUrl, kpiValue, kpiPercentile, snapshotAt, blendedScore }] }`.

**Side effects:** one `audit_log` row of kind `drafts.read.high_performers` per call.

**Caller:** `agent-crewai`'s `retrieve_high_performers` tool. Planned: a Mission Control "what's worked" tile.

### `GET /api/companies/:companyId/drafts/:draftId/revisions`

`services/approval-ui/app/api/companies/[companyId]/drafts/[draftId]/revisions/route.ts`

**Auth:** service-or-session. No body — path params only. Returns the draft's full revision tree from `draft_revisions`, ordered by `created_at` ascending. Bodies are excerpted to 500 chars; full bodies fetched on-demand via a planned `/revisions/:id` route.

**Response:** `{ draftId, revisionCount, revisions: [{ id, parentRevisionId, revisionNumber, bodyExcerpt, voiceScore, voicePasses, predictedPercentile, predictedPercentileLow, predictedPercentileHigh, criticNotes, reviewVerdict, authoredByAgentId, langgraphRunId, createdAt }] }`.

**Side effects:** one `audit_log` row of kind `drafts.read.revisions` per call.

**Caller:** Mission Control's branch-view component (Phase B.4). The flat list is structured client-side via `parentRevisionId`.

### `POST /api/companies/:companyId/drafts/:draftId/verify-claims`

`services/approval-ui/app/api/companies/[companyId]/drafts/[draftId]/verify-claims/route.ts`

**Auth:** service-or-session. **Body schema:** `VerifyClaimsRequestSchema` in the same file (also mirrored in `services/shared/schemas/claim.ts`) —
`{ claimIds?: uuid[] (max 200), force: boolean (default false) }`.

USP 8 provenance — re-runs the claim verifier across either the supplied claim ids or every claim attached to the draft. Without `force`, claims verified within the last 7 days are skipped. **Stub today**: marks every claim with `supporting_url` as `verified` (score 1.0); claims without a URL stay `pending`. Real fetch + snippet-match lands in a follow-up slice; the route shape is final.

**Response:** `{ draftId, claimCount, byStatus: Record<status, count>, results: [{ claimId, status, score, rationale, details, ranAt }] }`.

**Side effects:** updates `content_claims.verifier_*` columns per claim; one `audit_log` row of kind `claims.verified` per run (not per claim).

**Caller:** `agent-crewai`'s ClaimVerifier role; planned manual-trigger in Mission Control's draft detail.

### `POST /api/companies/:companyId/post-metrics`

`services/approval-ui/app/api/companies/[companyId]/post-metrics/route.ts`

**Auth:** service-or-session. **Body schema:** `BatchSchema` in the same file —
`{ clientId?: uuid|null, snapshots: SnapshotSchema[] (1..1000) }`. Each `SnapshotSchema` mirrors `performance-ingest/main.py::MetricSnapshot` field-for-field: `{ draftId: uuid, platform: string, snapshotAt?: ISO-8601, impressions?, reach?, clicks?, reactions?, comments?, shares?, saves?, conversions?: int>=0, raw?: object }`.

Durable-persistence sibling of `performance-ingest`'s `/ingest`. The Redpanda emission is real-time signal; this route is the historical record. Backdating defence: `snapshotAt` more than 5 minutes in the future is rejected for the entire batch.

**Response:** `{ insertedCount }`.

**Side effects:** N rows into `post_metrics`; one `audit_log` row of kind `post_metrics.written` per batch (not per snapshot).

**Caller:** `performance-ingest`'s `persist_batch` adapter. Manual operator imports + replays land here too.

### `POST /api/companies/:companyId/meter-events`

`services/approval-ui/app/api/companies/[companyId]/meter-events/route.ts`

**Auth:** service-or-session. **Body schema:** `MeterEventBodySchema` in the same file —
`{ kind: 'publish'|'metered_asset_generation'|'x402_outbound_call'|'x402_inbound_call'|'voice_score_query'|'compliance_check', quantity: number>=0, unitCostUsd?, totalCostUsd?: number>=0, refKind?: string 1..40, refId?: string 1..120, occurredAt?: ISO-8601, clientId?: uuid|null }`.

USP 10 metering counter. One row per metered event. Backdating defence applies to `occurredAt` (5-minute future tolerance).

**Response:** `{ eventId }`.

**Side effects:** one row into `meter_events`; one `audit_log` row of kind `metering.written`.

**Caller:** `agent-langgraph`'s `record_metering` node (after `publish_to_channel`). `agent-crewai`'s metered tool calls (asset.generate cost-policy enforcement). Manual workspace-admin entries.

### `GET /api/companies/:companyId/anomalies`

`services/approval-ui/app/api/companies/[companyId]/anomalies/route.ts`

**Auth:** service-or-session. **Query schema:** `QuerySchema` in the same file —
`{ lookbackHours: int 1..168 (default 24), zThreshold: number 0.5..10 (default 2.5), clientId?: uuid }`.

Read-through proxy onto `performance-ingest`'s `POST /anomaly/scan`. GET on the proxy + POST on the underlying service is intentional: HTTP cache rules prefer GET on read paths, and the body→query translation happens at the proxy boundary. Fail-soft: when `PERFORMANCE_INGEST_BASE_URL` or `SERVICE_TOKEN` are unset, returns an empty detection list with `skipped: true`.

**Response:** `{ companyId, lookbackHours, zThreshold, detections: AnomalyDetection[], skipped }`. The `AnomalyDetection` shape mirrors `performance-ingest`'s pydantic model.

**Side effects:** one `audit_log` row of kind `anomalies.listed` per call.

**Caller:** Mission Control's `AnomaliesTile` component.

### `GET /api/companies/:companyId/experiments`

`services/approval-ui/app/api/companies/[companyId]/experiments/route.ts`

**Auth:** service-or-session. **Query schema:** `QuerySchema` in the same file —
`{ campaignId?: uuid, includeArchived: boolean (default false) }`.

Read-through proxy onto `bandit-orchestrator`'s `GET /bandits`. Returns the orchestrator's `BanditSummary[]` shape verbatim (snake_case from FastAPI). Fail-soft: missing service token or unreachable orchestrator returns `{ bandits: [] }` so the tile renders cleanly.

**Response:** `{ companyId, bandits: BanditSummary[] }`. `BanditSummary` documented in the bandit-orchestrator section.

**Side effects:** one `audit_log` row of kind `experiments.listed` per call.

**Caller:** Mission Control's experiments tile + `/experiments` page.

### `POST /api/companies/:companyId/audit-events`

`services/approval-ui/app/api/companies/[companyId]/audit-events/route.ts`

**Auth:** service-or-session. **Body schema:** `AuditEventBodySchema` in the same file —
`{ kind: string 1..120, actorKind: 'user'|'agent'|'system', actorId: string<=64|null, detailsJson?: object, occurredAt?: ISO-8601, clientId?: uuid|null }`.

Generic audit-log ingest path. The `kind` column in `audit_log` is unconstrained text so new producers (e.g. `bandit.arm_pruned` from the orchestrator) ship new kinds without an SQL migration. Backdating defence applies to `occurredAt` (5-minute future tolerance). Deliberately no meta `audit_log` row about the audit-write itself — would recurse into infinite META-of-META rows.

**Response:** `{ id }` — the new audit row's UUID.

**Side effects:** one row into `audit_log`.

**Caller:** `bandit-orchestrator` (and other Python services that don't talk to Postgres directly) for events that bypass the standard `auditAccess()` path. Manual operator entries from a workspace owner.

# Approvals

Two routes, both session-only — agents may not approve their own work.

### `POST /api/approvals/:id/approve`

`services/approval-ui/app/api/approvals/[id]/approve/route.ts`

**Auth:** session-only. No body. Path param: `id` must be a UUID.

Flips an approval row from `status='pending'` to `status='approved'` and stamps `decided_by_user_id` + `decided_at`. RLS hides cross-tenant rows; an attempt to approve someone else's approval returns `not_found` indistinguishably from a missing id. Idempotent: a re-fire on a decided row returns `bad_request` with the existing status.

**Response:** `{ approval: <updated row> }`.

**Side effects:** updates the `approvals` row; one `audit_log` row of kind `approval.approved`. Both inside a single tenant-scoped transaction.

**Caller:** Mission Control's approval queue + `/inbox` page.

### `POST /api/approvals/:id/deny`

`services/approval-ui/app/api/approvals/[id]/deny/route.ts`

**Auth:** session-only. **Body schema:** `DenyBodySchema` in the same file —
`{ rationale: string 20..2000, scope: 'forever'|'this_topic'|'this_client' }`.

USP 5 enforcement — every deny captures a rationale and a scope. The same transaction updates the approval, inserts a `company_lessons` row of kind `human_denied` with the rationale, and writes the `audit_log` row. The next time an agent recalls lessons on a touching topic, this rationale lands in its system prompt.

**Response:** `{ approval: <updated row>, lessonId }`.

**Side effects:** updates the `approvals` row; inserts one `company_lessons` row; one `audit_log` row of kind `approval.denied` carrying the lesson id, scope, and rationale length (never the rationale itself — the lesson row owns the canonical copy).

**Caller:** Mission Control's inline deny form on `/inbox` and `/drafts/[id]`.

# Auth

Three routes covering the WorkOS Authkit flow. All under `services/approval-ui/app/api/auth/`.

### `GET /api/auth/login`

`services/approval-ui/app/api/auth/login/route.ts`

**Auth:** none (initiates the session). **Query:** `next` (optional, must start with `/` — defaults to `/`).

Redirects the browser to the WorkOS-hosted authorize URL with `state` carrying the encoded `next` path. Returns 500 with a structured error when WorkOS isn't configured (`WORKOS_API_KEY` + `WORKOS_CLIENT_ID` unset).

### `GET /api/auth/callback`

`services/approval-ui/app/api/auth/callback/route.ts`

**Auth:** none (completes the session). **Query:** `code` (required), `state` (optional).

Exchanges the WorkOS `code` for a user object. Looks up the local `users` row by `workos_user_id`, falls back to email match, optionally auto-provisions a solo workspace (when `WORKOS_AUTO_PROVISION=1`, the dev default). Picks the newest non-revoked membership as the active company. Writes the iron-session cookie and audit-logs `auth.session.created`. Redirects to the `next` path encoded in `state`.

### `GET /api/auth/logout` and `POST /api/auth/logout`

`services/approval-ui/app/api/auth/logout/route.ts`

**Auth:** session (passes through if absent). No body.

Audit-logs `auth.session.destroyed` (best-effort — failure does not block logout), destroys the session cookie, redirects to `/login`. Both `GET` and `POST` are accepted so a top-bar logout link works without a form.

# Service health

Every Python service mounts `GET /health` and most mount a `/producer/status` or `/consumer/status` companion. All return JSON; none require auth (intentionally — these feed the docker-compose healthcheck and ops dashboards).

| Service | Liveness | Bus visibility |
|---|---|---|
| `agent-crewai` | `GET /health` | `GET /crews` (discovery) |
| `agent-langgraph` | `GET /health` | `GET /producer/status`, `GET /workflows` |
| `bandit-orchestrator` | `GET /health` | `GET /consumer/status` |
| `performance-ingest` | `GET /health` | `GET /producer/status`, `GET /pollers/status` |
| `percentile-predictor` | `GET /health` | — |
| `output-moderation` | `GET /health` | — |
| `pii-detection` | `GET /health` | — |
| `voice-scorer` | `GET /health` | — |
| `approval-ui` | `GET /api/health` | `GET /api/health/services` (fleet aggregator) |

`/health` returns `{ status: 'ok', service, version, time? }`. `/producer/status` and `/consumer/status` surface the Redpanda producer/consumer's stats dict (enabled, connected, events_emitted, draft_index_size, etc.) for Mission Control's bus-health tile to read across services.

### `GET /api/health/services`

`services/approval-ui/app/api/health/services/route.ts`

**Auth:** none — status endpoints need to be reachable for monitoring without a session, and nothing here leaks tenant data. `Cache-Control: no-store` so monitors always see fresh truth.

Fans out parallel `/health` (and where applicable, `/producer/status` or `/consumer/status`) probes against the eight backend services. Each probe is bounded by a 2s timeout, so total latency is bounded by the slowest probe rather than the sum. Services whose `*_BASE_URL` env var is unset are reported as `baseUrlConfigured: false` — distinct from a real outage so dev boxes don't paint half the fleet red. `overall` is `'healthy'` (no backends configured OR all configured backends reachable), `'degraded'` (some up, some down), or `'down'` (all configured backends unreachable).

**Response:** `{ overall, timestamp, services: ServiceHealthEntry[] }`. Each `ServiceHealthEntry` is `{ name, port, baseUrlConfigured, health: { reachable, responseTimeMs, version, error }, producer?: { enabled, emitCount, emitErrors }, consumer?: { enabled, consumedCount, matchedCount, handleErrors } }`.

**Caller:** status pages, external monitors, Mission Control's fleet view.

# Bandits

Five routes on `bandit-orchestrator` (`services/bandit-orchestrator/main.py`, port 8008). Service-token auth in production via the agent containers; the orchestrator additionally re-checks `req.company_id == state.company_id` on every state-bearing call as a defensive cross-tenant boundary.

The orchestrator persists state to `BANDIT_DATA_DIR/{bandit_id}.json` (default `/data/bandits`) — atomic .tmp + replace so concurrent allocate/reward calls never see a half-written file. An in-memory reverse index `draft_id → (bandit_id, variant_id)` is built on startup by scanning that directory; the auto-reward consumer (subscribed to `content.metric_update` on Redpanda) uses it to attribute incoming events without an HTTP roundtrip.

### `POST /bandits`

Register a new bandit. **Body schema:** `RegisterArmsRequest` in `main.py` —
`{ company_id, client_id?, campaign_id, platform: Channel, message_pillar: string 1..120, variants: Variant[] (2..10), algorithm: 'thompson'|'epsilon_greedy'|'ucb1' (default thompson), exploration_budget: float >=0.05 <=0.5 (default 0.10), observation_window_hours: int >0 <=720 (default 72) }`.

Each `Variant` is `{ variant_id: string 1..64, draft_id, body_excerpt: string <=500, predicted_percentile?: 0..100 }`. Beta(α, β) priors are seeded from `predicted_percentile`: `α = max(p/10, 1)`, `β = max((100-p)/10, 1)`. `predicted=None` falls back to uniform Beta(1, 1).

**Response:** `{ request_id, bandit_id, arm_count, skipped }`.

**Side effects:** writes a JSON state file; updates the in-memory reverse index.

**Caller:** `agent-crewai`'s `register_bandit` tool, called by the Strategist after generating variants.

### `POST /bandits/:bandit_id/allocate`

**Body schema:** `AllocateRequest` — `{ company_id, bandit_id }`.

Returns the variant to publish next. Pruning gate fires once `bandit_age_hours >= observation_window_hours`: arms whose posterior mean is `>= BANDIT_PRUNE_THRESHOLD` (default 0.15) below the leader are marked `pruned`, and re-evaluated on every allocate (an arm can un-prune if subsequent rewards recover it). Thompson sampling draws from each active arm's posterior; with probability `exploration_budget` the leader is overridden by a uniformly-chosen non-leader.

**Response:** `{ request_id, bandit_id, variant_id, arm_score, rationale, skipped }`. `rationale` is `'thompson winner'` or `'exploration override'`.

**Side effects:** increments `allocation_count` on the chosen arm and `total_allocations`; persists state.

**Caller:** `agent-langgraph`'s `bandit_allocate` node in the publish pipeline.

### `POST /bandits/:bandit_id/reward`

**Body schema:** `RewardRequest` — `{ company_id, bandit_id, variant_id, reward: float 0..100, snapshot_at: ISO-8601 }`.

Records an observed reward. Fallback path; the production path is the auto-reward consumer that subscribes to `content.metric_update` on Redpanda and applies the same posterior update inside the service. Both call `_update_posterior(arm, reward_pct)`: `α += reward/100`, `β += (1 - reward/100)`.

**Response:** `{ request_id, bandit_id, variant_id, posterior_mean, skipped }`.

**Side effects:** updates the arm's posterior; increments `total_rewards`; persists state.

### `GET /bandits`

**Query:** `company_id` (required), `campaign_id?`, `include_archived?: boolean`.

Lists bandits for a workspace. Defensive cross-tenant: every state file's `company_id` is verified against the request's `company_id` before inclusion. `include_archived` is forward-compat — every bandit is "live" today, so the flag is currently a no-op.

**Response:** `{ company_id, bandits: BanditSummary[] }`. `BanditSummary` is `{ bandit_id, campaign_id, platform, message_pillar, algorithm, arm_count, active_arm_count, total_allocations, total_rewards, leading_arm, leading_posterior_mean, created_at }`.

### `GET /bandits/:bandit_id/state`

Read-only state view. Returns `{ bandit_id, company_id, campaign_id, platform, message_pillar, arms: [...], total_allocations, total_rewards, leading_arm, pruned_arms }`. Used by Mission Control's experiments-detail panel.

# Anomalies + Performance

Routes on `performance-ingest` (`services/performance-ingest/main.py`, port 8006). Service-token auth.

### `POST /ingest`

**Body schema:** `IngestRequest` —
`{ company_id, client_id?, snapshots: MetricSnapshot[] (1..1000), request_id? }`. Each `MetricSnapshot` mirrors the SQL columns from migration `0004_post_metrics.sql`: `{ draft_id, platform: 'x'|'linkedin'|'reddit'|'tiktok'|'instagram', snapshot_at: ISO-8601, impressions?, reach?, clicks?, reactions?, comments?, shares?, saves?, conversions?: int>=0, raw?: object }`.

Per snapshot, per non-null metric: atomically computes percentile + (mean, std) + prior_n against the prior workspace histogram, then appends and persists. Velocity (rate of change vs the prior snapshot for this exact draft × platform × metric) is computed from a per-draft last-values file. The fan-out is two-way:

1. Emits one `content.metric_update` event per metric to Redpanda (partition key = `company_id`).
2. Emits a `content.anomaly` event when `prior_n >= ANOMALY_MIN_SAMPLES` (default 30) and `|z| >= INGEST_Z_THRESHOLD` (default 2.5).
3. Persists the raw row to `post_metrics` via approval-UI's `POST /api/companies/:cid/post-metrics`.

The two paths are independent — bus emission and Postgres persistence each succeed or fail without blocking the inbound request.

**Response:** `{ request_id, accepted_count, duplicate_count, events_emitted, persisted_count, skipped }`.

**Caller:** the (currently-stub) per-platform pollers; manual snapshot uploads from operators.

### `POST /anomaly/scan`

**Body schema:** `AnomalyScanRequest` —
`{ company_id, client_id?, lookback_hours: int 1..168 (default 24), z_threshold: float >0 (default 2.5) }`.

Walks every (draft × platform × metric) last-snapshot for the workspace, z-scores against the workspace's running histogram, returns detections above threshold within the lookback window. Read-only — does not emit anomaly events (the per-snapshot path on `/ingest` is the canonical bus-emission point; a Mission Control refresh must not double-fire alerts).

**Response:** `{ request_id, company_id, lookback_hours, z_threshold, detections: AnomalyDetection[], events_emitted: 0, skipped }`. Each `AnomalyDetection` is `{ draft_id, platform, metric, z_score, value, rolling_mean, rolling_std, detected_at }`.

**Caller:** the approval-UI `/api/companies/:cid/anomalies` proxy; Mission Control's `AnomaliesTile`.

### `POST /pollers/:platform/start`, `POST /pollers/:platform/stop`, `GET /pollers/status`

Per-platform poller controls. Today every poller is a stub — `pollers_status` returns `state: 'inactive'` for x/linkedin/reddit/tiktok/instagram, and start/stop are no-ops. Live pollers (tweepy/praw/linkedin sdk/etc.) ship behind the `[runtime]` extra and gated on per-platform OAuth flows. The wire protocol is final; only the ingestion driver is missing.

### `GET /campaigns/:campaign_id/rollup`

Stub. Returns an empty `CampaignRollup`. Lands when campaigns become first-class — a `campaigns` table or `campaign_id` column on `drafts` gates this.

# Percentile prediction

Routes on `percentile-predictor` (`services/percentile-predictor/main.py`, port 8007). Service-token auth.

LightGBM gradient-boosted regression per workspace × KPI. Model artefacts persist to `PREDICTOR_DATA_DIR/{company_id}-{kpi}.lgb` (default `/data/predictors`); calibration tracking is JSONL-appended to `{company_id}-{kpi}.calibration.jsonl`. Heavy imports (`lightgbm`, `numpy`) are lazy under the optional `[ml]` extra so lint CI runs without them.

### `POST /predict`

**Body schema:** `PredictRequest` —
`{ company_id, client_id?, features: DraftFeatures, kpi: 'ctr'|'engagement_rate'|'conversion_rate' (default engagement_rate) }`. `DraftFeatures` is `{ text: string 1..200000, channel: Channel, scheduled_for?: ISO-8601, hashtags: string[], has_media: bool, voice_score?: 0..1, claim_count: int>=0, word_count?: int>=0 }`.

Untrained workspace: returns `predicted_percentile=50, ±25, skipped=true` so Mission Control can render "predictor not ready" instead of a confident 50. LightGBM not installed: 500 with a clear "rebuild image with `[ml]` extra" error.

**Response:** `{ request_id, predicted_percentile, confidence_low, confidence_high, confidence_interval, top_features: [{ feature, contribution }], model_version, skipped }`.

**Caller:** `agent-langgraph`'s `percentile_gate` node before human approval.

### `POST /train`

**Body schema:** `TrainRequest` —
`{ company_id, client_id?, kpi: same enum, samples: TrainSample[] (>=1) }`. `TrainSample` is `{ features: DraftFeatures, achieved_percentile: 0..100, achieved_at: ISO-8601 }`.

Refuses with 400 when `len(samples) < PREDICTOR_MIN_TRAIN_SAMPLES` (default 30). 80/20 random split, hand-tuned starter params, MAE objective, 200 rounds with early stopping. Acceptance is ±15 percentile points 80% of the time per Doc 4. Atomic write to the model file; meta JSON written alongside.

**Response:** `{ request_id, company_id, sample_count, trained_at, model_version, skipped }`.

### `GET /calibration/:company_id`

Read-only calibration view. Walks the per-(company × kpi) JSONL of `(predicted, actual, ts)` tuples and returns MAE + within-15% rate + last-retrained-at + drift flag.

**Response:** `CalibrationResponse` — `{ company_id, sample_count, mean_absolute_error, within_15_pct_rate, last_retrained_at, drift_detected }`.

# Output moderation

Routes on `output-moderation` (`services/output-moderation/main.py`, port 8004). Service-token auth.

Llama Guard 3 (8B) served by the Ollama sidecar in `docker-compose.yml`. Per Doc 5 §1 P0, every artifact bound for a workspace surface (approval queue, channel publish, agent reply) flows through this gate first. Distinguished from `brand_safety_check` (workspace policy on top); this service is the fixed-policy floor. Production stub-mode is OFF by default — a forgot-to-wire deploy fails loudly with `Ollama unreachable` rather than silently passing every prompt.

### `POST /moderate`

**Body schema:** `ModerateRequest` —
`{ text: string 1..200000, kind: 'user_input'|'assistant_output' (default assistant_output), prior_user_turn?: string, block_categories?: SafetyCategory[], flag_categories?: SafetyCategory[] }`.

`SafetyCategory` is the Llama Guard 3 standard catalogue: `S1_violent_crimes` … `S14_code_interpreter_abuse`. Default block-floor: S1, S2, S3, S4, S9, S10, S11. Workspaces can re-policy any category to `flag` or `pass`.

**Response:** `{ request_id, verdict: 'pass'|'flag'|'block', findings: [{ category, rationale }], classifier, skipped }`.

# PII detection

Routes on `pii-detection` (`services/pii-detection/main.py`, port 8003). Service-token auth.

Presidio Analyzer + Anonymizer with custom recognizers for `CRYPTO_WALLET` (BTC/ETH/Base) and `API_KEY` (sk-/pk_/ghp_/xoxb-/AKIA prefixes). Lazy spaCy load on first request — stub mode starts instantly. Detected text is never logged in spans; only `(entity_type, count, score)` tuples land in observability.

### `POST /scan`

**Body schema:** `ScanRequest` —
`{ text: string 1..200000, language: ISO-639-1 (default 'en'), entities?: EntityType[], score_threshold: 0..1 (default 0.4) }`.

`EntityType` is the Presidio catalogue plus the two Clipstack custom recognizers — `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `CREDIT_CARD`, `IBAN_CODE`, `IP_ADDRESS`, `US_SSN`, `US_BANK_NUMBER`, `US_DRIVER_LICENSE`, `US_PASSPORT`, `UK_NHS`, `LOCATION`, `DATE_TIME`, `URL`, `MEDICAL_LICENSE`, `NRP`, `CRYPTO_WALLET`, `API_KEY`.

**Response:** `{ request_id, detections: [{ entity_type, start, end, score, text }], detector_version, skipped }`. Returns the matched span verbatim — callers handle redaction.

### `POST /redact`

**Body schema:** `RedactRequest` —
`{ text: string 1..200000, language: default 'en', entities?, score_threshold: default 0.4, mode: 'mask'|'replace'|'remove'|'hash' (default replace) }`.

`mask` swaps each char with `*`. `replace` swaps the span with `<ENTITY_TYPE>`. `remove` deletes the span. `hash` swaps with the first 12 hex chars of the SHA-256 — useful for cross-document correlation without recoverability.

**Response:** `{ request_id, redacted_text, detections: Detection[], skipped }`.

# Voice scoring

Routes on `voice-scorer` (`services/voice-scorer/main.py`, port 8005). Service-token auth.

Cosine retrieval against the workspace's voice corpus in Qdrant. One collection per workspace (`voice-{company_id}`); per-client payload filtering lets agencies overlay client-specific voice on top of the agency baseline. SetFit classifier head is gated behind `[ml]` extra and lands once a workspace seeds enough samples.

### `POST /score`

**Body schema:** `ScoreRequest` —
`{ company_id, draft: string 1..200000, client_id?, threshold: 0..1 (default 0.65), return_exemplars: bool (default true) }`.

Embeds the draft via LiteLLM's `voice-embed` profile (384-d). Searches for top-K nearest in-voice and top-K farthest in off-voice exemplars in the workspace's Qdrant collection. Score is the mean cosine similarity to top-K in-voice, clamped to `[0, 1]`. Untrained workspace (no collection) returns `score=1.0, passes=true, skipped=true` so the workspace bootstraps cleanly. LiteLLM or Qdrant unreachable: 503 — never silently passes.

**Response:** `{ request_id, score, passes, threshold, nearest: Exemplar[], farthest: Exemplar[], model_version, skipped }`. `Exemplar` is `{ id, similarity: -1..1, text_excerpt, tone_tags: string[] }`.

### `POST /train`

**Body schema:** `TrainRequest` —
`{ company_id, client_id?, in_voice_samples: (TrainSample|string)[], off_voice_samples: same, replace: bool (default false) }`. `TrainSample` is `{ text: string 1..200000, tone_tags: string[] }`.

Embeds each sample and upserts into the workspace's Qdrant collection with payload `{ label, client_id, text, tone_tags }`. With `replace=true`, the existing collection is dropped and recreated. SetFit classifier training will land in a follow-up.

**Response:** `{ request_id, company_id, in_voice_count, off_voice_count, trained_at, skipped }`.

# Agent orchestration

Two services own the agent runtime: `agent-crewai` (role-based pipelines) and `agent-langgraph` (stateful workflows with durable checkpoints). Both run FastAPI shells whose live execution is gated on `*_DRY_RUN=0` plus populated LiteLLM keys; in dry-run mode (the dev default), kickoffs validate crew/graph wiring and return a queued `trace_id` without firing the underlying calls.

## agent-crewai (port 8001)

Six crews ship live as of A.3. Each kickoff route accepts the crew's request body, validates wiring via `_kickoff()`, and returns a `CrewKickoffResponse` of `{ trace_id, crew, status }`. Service-token auth in production — the routes today take the request shape verbatim and don't enforce token check inside the handler; production deployments rely on the `agent-langgraph → agent-crewai` hop carrying the token via the shared HTTP client.

### `POST /crews/content_factory/kickoff`

**Body:** `ContentFactoryRequest` —
`{ source_type: 'url'|'transcript'|'pdf'|'text', source_value: string 1+, platforms: string[] (default ['x', 'linkedin']), company_id, campaign_id?, tone_override? }`.

Strategist → LongFormWriter → SocialAdapters → NewsletterAdapter → DevilsAdvocateQA → ClaimVerifier → BrandQA. Generates N=2..5 hook variants per platform.

### `POST /crews/trend_detector/kickoff`

**Body:** `TrendDetectorRequest` — `{ company_id, topic_keywords: string[] (max 50) }`. Doc 4 §2.5 — brand-safety pre-gated.

### `POST /crews/algorithm_probe/kickoff`

**Body:** `AlgorithmProbeRequest` — `{ company_id, platform: Platform }`. Doc 4 §2.6 — least-sensitive workspace probe.

### `POST /crews/live_event_monitor/kickoff`

**Body:** `LiveEventMonitorRequest` — `{ company_id }`. Doc 4 §2.8 — severity × relevance scoring.

### `POST /crews/engagement/kickoff`

**Body:** `EngagementRequest` — `{ company_id, platform: Platform }`. Doc 4 §2.9 — per-platform reply triage.

### `POST /crews/lifecycle/kickoff`

**Body:** `LifecycleRequest` — `{ company_id }`. Doc 4 §2.10 — weekly portfolio evaluator.

### `GET /crews`

Discovery — returns the live + planned crew roster with their Doc references.

## agent-langgraph (port 8002)

Stateful workflows with PostgresSaver-backed durable checkpoints (MemorySaver fallback when no Postgres URL is configured).

### `POST /workflows/publish_pipeline/start`

**Body:** `PublishStartRequest` —
`{ company_id, draft_id, channel: 'x'|'linkedin'|'reddit'|'tiktok'|'instagram'|'newsletter', scheduled_at?: ISO-8601 }`.

Kicks off the publish pipeline: research-cycle → critic-review → percentile_gate → human approval → bandit_allocate → publish_to_channel → record_metering. Returns `{ run_id, workflow, status: 'queued'|'running'|'awaiting_approval'|'complete'|'error' }`.

Live execution requires `LANGGRAPH_DRY_RUN=0`; without it, the route validates the graph build and returns `queued`.

### `GET /workflows`

Discovery — returns the live + planned workflow roster.

### `GET /producer/status`

Operator view onto the Redpanda producer's stats. Mission Control's bus-health tile reads this alongside the equivalent endpoints on `performance-ingest` and `bandit-orchestrator`.

---

# Appendix — env vars

The full set of env vars that gate the API surface. Defaults in `core/.env.example`; per-service detail in each service's `README.md`.

| Variable | Service | Purpose |
|---|---|---|
| `SERVICE_TOKEN` | all | Shared secret for X-Clipstack-Service-Token. Generate with `openssl rand -hex 32`. |
| `SESSION_COOKIE_SECRET` | approval-ui | iron-session encryption key. `openssl rand -base64 48`. |
| `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI` | approval-ui | WorkOS Authkit credentials. |
| `WORKOS_AUTO_PROVISION` | approval-ui | `1` = auto-create users + solo workspace on first login (dev default); `0` = require invite (prod default). |
| `AUTH_STUB_USER_ID`, `AUTH_STUB_COMPANY_ID` | approval-ui | Dev/test escape hatch — refused at `NODE_ENV=production`. |
| `EVENTBUS_ENABLED`, `REDPANDA_BROKERS` | producers + consumer | Gates `producer.start()` in agent-langgraph + performance-ingest + bandit-orchestrator. |
| `APPROVAL_UI_BASE_URL` | performance-ingest | Sibling-service URL for post-metrics persistence. |
| `BANDIT_ORCH_BASE_URL` | approval-ui (proxy) | Sibling-service URL for the experiments tile. |
| `PERFORMANCE_INGEST_BASE_URL` | approval-ui (proxy) | Sibling-service URL for anomaly scans. |
| `PII_STUB_MODE`, `MODERATION_STUB_MODE`, `VOICE_SCORER_STUB_MODE`, `PREDICTOR_STUB_MODE`, `BANDIT_STUB_MODE` | per-service | Defaults to `1` in dev, `0` in prod. Stub-on returns canned responses without firing the real backend. |
| `INGEST_Z_THRESHOLD`, `INGEST_ANOMALY_MIN_SAMPLES` | performance-ingest | Anomaly detector thresholds. Defaults 2.5 / 30. |
| `BANDIT_PRUNE_THRESHOLD` | bandit-orchestrator | Posterior-mean gap below leader at which an arm prunes. Default 0.15. |
| `LANGFUSE_ENABLED`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | agent-crewai, agent-langgraph, litellm | Trace destination. See `core/docs/observability.md`. |
| `CREWAI_DRY_RUN`, `LANGGRAPH_DRY_RUN` | agent containers | `1` = validate wiring without calling LiteLLM; `0` = live execution. |

The fail-soft contract is consistent: a missing service-to-service env var degrades the dependent surface to a stub response with `skipped: true`, never a 5xx, so a partial deployment surfaces in the response shape rather than as a downstream outage.
