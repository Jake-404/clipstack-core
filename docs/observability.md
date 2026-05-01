# Observability

Langfuse self-host is the canonical trace store. Phase B.5 wires the orchestration services (agent-crewai + agent-langgraph) and the LiteLLM router to push traces; Phase B.5+ extends to the leaf services (pii-detection, voice-scorer, etc.) once their real backends ship.

## Why Langfuse

- **Self-hosted** — Doc 1 §4 lock; tenant data never leaves the deployment
- **Already in `docker-compose.yml`** since A.0 (port 3030)
- **Native LiteLLM support** — every model call lands as a `generation` span automatically
- **CrewAI + LangGraph adapters** — task-level + node-level spans
- **Cheap to query** at the volume Phase B/C reaches

## Trace conventions (locked B.5)

Every trace carries enough metadata that Mission Control's run-detail panel can render the full breadcrumb without re-querying the originating service.

```
trace.name      = "<service>.<endpoint>"
                  e.g. "agent-crewai.crews.content_factory.kickoff"
                       "agent-langgraph.workflows.publish_pipeline.start"
trace.metadata  = {
  company_id:   "<uuid>",        # tenant scope — REQUIRED
  client_id:    "<uuid> | null", # nested-tenancy when applicable
  request_id:   "<uuid>",        # idempotency key from the caller
  crew_id:      "content_factory",  # for crew kickoffs
  workflow_id:  "publish_pipeline", # for langgraph runs
}
trace.tags      = [
  environment,        # development | test | production
  service,            # agent-crewai | agent-langgraph | ...
  crew_id,            # only for crew kickoffs
  release,            # CLIPSTACK_RELEASE — dev | git-sha | semver
]
```

Sub-spans (per agent task / per LangGraph node / per tool call) inherit the parent's metadata and add a `step` field naming the boundary they span.

LiteLLM-emitted `generation` spans nest under the active trace via `langfuse_trace_id` metadata propagated by the SDK — so a single content_factory kickoff produces one trace with ~30-40 nested spans (research → strategise → long-form → 2-5 socials → newsletter → DevilsAdvocateQA → ClaimVerifier → BrandQA, each containing tool calls + LLM calls).

## Service coverage matrix

| Service | Phase | Trace surface |
|---|---|---|
| `agent-crewai` | ✅ B.5 | One trace per crew kickoff. Each agent task = a span. Each tool call = a sub-span. LiteLLM generations nest under the active trace. |
| `agent-langgraph` | ✅ B.5 | One trace per workflow start. Each node = a span. State diff persisted as span metadata. LiteLLM generations nest. |
| `litellm` | ✅ B.5 | success_callback + failure_callback both emit. Every model call lands as a `generation` span. Fallback chain visible as ordered child spans. |
| `pii-detection` | ⏳ post-Presidio | Each /scan + /redact = one span. Detection counts in metadata. PII text never logged in span — only counts. |
| `voice-scorer` | ⏳ post-SetFit | Each /score = one span with score + nearest/farthest exemplar IDs (not text). Each /train = one trace. |
| `percentile-predictor` | ⏳ post-LightGBM | Each /predict = one span. SHAP top-features in metadata. Calibration sweeps = one trace per run. |
| `bandit-orchestrator` | ⏳ post-mabwiser | Each /allocate + /reward = one span. Posterior diffs in metadata. |
| `performance-ingest` | ⏳ post-pollers | Each /ingest = one trace. Anomaly scan = one trace per workspace. |
| `approval-ui` (Next.js API) | ⏳ later | Each route = one trace. Service-token vs session vs admin in metadata. Currently `audit_log` carries the equivalent breadcrumb. |

## Local setup (5 minutes)

```bash
# 1. Spin up Langfuse + dependencies
docker compose up -d postgres langfuse

# 2. Open http://localhost:3030
#    Log in with LANGFUSE_INIT_USER_EMAIL + LANGFUSE_INIT_USER_PASSWORD
#    (defaults: dev@clipstack.local + ${LANGFUSE_INIT_USER_PASSWORD})

# 3. Project → Settings → API Keys → Create new pair
#    Copy the Public Key + Secret Key

# 4. Paste into .env
echo "LANGFUSE_ENABLED=true"           >> .env
echo "LANGFUSE_PUBLIC_KEY=pk-lf-..."   >> .env
echo "LANGFUSE_SECRET_KEY=sk-lf-..."   >> .env

# 5. Restart the services that emit traces
docker compose restart agent-crewai agent-langgraph litellm
```

Traces appear in real-time at http://localhost:3030 → your project → Traces.

## Dev / staging / production behaviour

| Environment | LANGFUSE_ENABLED default | Behaviour |
|---|---|---|
| dev (no `.env` setup) | `false` | SDK no-ops. No network calls. Service runs with zero observability cost. |
| dev (with keys configured) | operator sets `true` | Full traces. Useful for "why did this draft block?" debugging. |
| test / CI | `false` | SDK no-ops. Test fixtures don't pollute the dev workspace's trace log. |
| production | operator sets `true` (recommended) | Full traces. PII redaction policy enforced via the per-service rules in observability.py. |

In all environments: missing `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` while `LANGFUSE_ENABLED=true` logs a warning at startup, then disables. Tracing is advisory — a Langfuse outage shouldn't block agent runs.

## PII rules (hard)

- **Voice-scorer + percentile-predictor**: never log raw draft text in span metadata — only score + length + workspace_id. The span's *output* may contain text only when the operator explicitly enables `LANGFUSE_LOG_FULL_TEXT=1`. CI rejects PRs that toggle it on.
- **PII-detection service**: never logs detected text in any field. Only `(entity_type, count, score)` tuples land in spans.
- **Approval-ui session cookies / service tokens**: never appear in any span. Auth context is summarised as `actorKind + actorId` only (matching the audit_log convention).

## Trace retention

Per Privacy.md §4: aggregated telemetry rolls 13 months. Langfuse traces fall under telemetry — auto-purged after 90 days unless retained explicitly for an open incident. Retention extension is per-project in Langfuse settings.

## Cost shape

Local self-hosted Langfuse + Postgres = ~zero marginal cost. Cloud Langfuse pricing applies only if a deployment opts to use their managed service. Self-host is the default in `docker-compose.yml`.
