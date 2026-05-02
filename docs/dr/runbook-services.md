# Full mesh recovery

Worst-case Tier-1 procedure. RTO 1 hr is aspirational here — total deployment loss usually slips past the single-tier target because every dependency must come back in order before service is restored. The aim of this runbook is to make the recovery deterministic, not fast.

## Failure modes

Total deployment loss. Three flavours:

- **Account compromise.** Cloud account credentials leaked; a bad actor deleted infrastructure. Recovery starts with a fresh account or restored access; assume nothing in the existing account is trustworthy until investigated.
- **Region outage exceeding RTO.** The provider's region is offline beyond the wait threshold and the cross-region replica is either parked (current state per `clipstack/CLAUDE.md`) or unhealthy.
- **Accidental delete.** An operator ran `terraform destroy` against the wrong workspace; a `kubectl delete namespace` cleaned out the live mesh; a `docker compose down -v` removed the volumes on a single-node deploy.

The recovery procedure is the same in all three cases. The only difference is the credentials posture: F1 starts the recovery from a clean account; F2 and F3 reuse the existing account.

## Bootstrap order

**Do not reorder these steps.** Every later step depends on resources from an earlier step being live. Skipping ahead and back-filling is faster only if you've memorised the dependency graph; in practice the deterministic order is faster than the optimised one.

### 1. Provision a fresh Postgres

Bring up a new Postgres instance — Neon project (preferred) or self-hosted on the platform's choice (managed RDS, Fly Postgres, Supabase). Restore from backup or PITR per [runbook-postgres.md](./runbook-postgres.md).

After restore, verify:

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM companies;"
psql "$DATABASE_URL" -c "SELECT extname FROM pg_extension WHERE extname IN ('vector');"
psql "$DATABASE_URL" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
```

The `companies` count should match the pre-incident expectation. The `vector` extension must be present (required by `0007_alter_embedding_to_vector.sql`). The table count should match the migration set — currently 15 tables across 7 SQL migrations.

Run the cross-tenant integration test against the restored database to confirm RLS state:

```bash
DATABASE_URL="$DATABASE_URL" bash tests/integration/run-rls-test.sh
```

All 6 assertions must pass before proceeding.

### 2. Provision Qdrant

Bring up a Qdrant instance. Voice scorer fails-soft to "untrained" until restored — this is the Tier-3 RPO at work. Point `QDRANT_URL` at the new instance.

If Qdrant snapshots survived the outage, restore the most recent. If they didn't, accept the Tier-3 24-hr RPO: workspaces re-train when noticed, and the voice-scorer's regex-based off-voice fallback (per `runbook.md` § Qdrant outage) keeps drafts flowing.

### 3. Provision Redpanda

Bring up a Redpanda broker (or any Kafka-compatible alternative). Producers in the platform fail-soft per the closed-loop's documented semantics — a service that can't reach the broker logs and continues. Consumers re-subscribe at `latest` offset on first start, missing messages from before the outage. Acceptable per the Tier-4 RPO (24-hr / best-effort).

If you need to recover the message lineage that landed during the outage window, re-ingest from `post_metrics` (Postgres) into the `content.metric_update` topic — every metric snapshot the platform persisted to Postgres is also the source-of-truth for what should have flowed through Redpanda. The fan-out logic in `services/performance-ingest/main.py::ingest` is idempotent at the row level, so re-ingestion is safe.

### 4. Provision LiteLLM

Stand up a LiteLLM instance from `infra/litellm/config.yaml`. There is nothing to restore — LiteLLM is a stateless router. The model credentials (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`) pass through from the deployment's secret store; nothing is held inside LiteLLM itself.

Verify:

```bash
curl http://litellm:4000/health
```

### 5. Deploy approval-ui

Single deploy via Vercel (hosted SaaS) or Docker (self-host). Set every env var the application requires — at minimum:

- `DATABASE_URL` (from Step 1)
- `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI` (auth)
- `SESSION_COOKIE_SECRET` (32+ random chars)
- `SERVICE_TOKEN` (32+ random chars; shared with Python services)
- `LITELLM_BASE_URL` (from Step 4)
- `QDRANT_URL` (from Step 2)
- `REDPANDA_BROKERS` (from Step 3)

Confirm liveness:

```bash
curl https://<approval-ui-host>/api/health
```

### 6. Deploy each Python service

The Python services (`agent-crewai`, `agent-langgraph`, `pii-detection`, `output-moderation`, `voice-scorer`, `performance-ingest`, `percentile-predictor`, `bandit-orchestrator`) are independent — no inter-service start ordering is required, every service degrades gracefully when its peers are still coming up. Deploy in parallel.

Each service needs the shared env block: `DATABASE_URL`, `SERVICE_TOKEN`, `REDPANDA_BROKERS`, `LITELLM_HOST`, plus its own per-service variables. See `core/.env.example` for the complete list.

### 7. Restore bandit state

Run the restore procedure in [runbook-bandit-state.md](./runbook-bandit-state.md). Without this step, the bandit-orchestrator boots with seeded priors and every workspace's experimentation memory is lost.

### 8. Smoke the service mesh

```bash
curl https://<approval-ui-host>/api/health/services
```

Confirm `overall: "healthy"` and every service's individual status `healthy`. Any service still reporting `unhealthy` blocks declaring the recovery complete — investigate that service before moving on.

Finally, run an end-to-end probe: log in via WorkOS, land on Mission Control, confirm the workspace's tiles populate without console errors. This is the same closed-loop validation documented in `core/docs/closed-loop.md`.

## Reconcilers

The bootstrap order brings the mesh back, but it does not address state that was in flight at the moment of failure. The reconciler list below is the catalogue of "what to do about state that was lost."

| State class | What was lost | Reconciliation |
|---|---|---|
| Drafts in `awaiting_approval` at the time of outage | The user's pending review queue is still in `drafts`, but any approval action that didn't commit before the outage is gone. | Human re-approves on first sight. The Mission Control approval queue surfaces the draft normally; no operator action required. |
| Bandits with reset posteriors | If `runbook-bandit-state.md` was skipped or unreachable, posteriors are seeded priors. | Strategist re-registers on the next campaign cycle; the experiment restarts from cold. Acceptable per Tier-2 RPO. |
| In-flight LangGraph checkpoints | Pipeline runs that were mid-flight at the outage. | The PostgresSaver checkpointer (per sprint-close S.2) persists checkpoints to Postgres. They survive the outage and resume from the last checkpoint when the agent-langgraph service comes back up. No action required. |
| Redpanda offsets for the bandit consumer | If the broker is fresh, the consumer subscribes at `latest`. Any unconsumed pre-outage events are gone. | Any drafts that needed `bandit_variant_id` attribution from those events stay un-attributed. The campaign self-corrects on the next round of metric updates; no manual repair. |
| Object-storage assets uploaded mid-outage | Assets that were generated but not flushed to durable storage. | Re-generate via the agent-crewai's `asset.generate` tool — the agent re-runs the creative step against the same brief and a new asset lands in `artifacts`. |
| Audit-log entries for the outage window | Application writes that were attempted but not committed. | The audit gap is documented in the postmortem; affected workspaces are notified per the customer-comms threshold in [runbook-data-corruption.md](./runbook-data-corruption.md) § Notification. |

The reconciler set is intentionally short. The platform's design (per `core/docs/closed-loop.md` § Fail-soft semantics) is to degrade gracefully — most state classes self-correct on the next cycle without a manual repair step.
