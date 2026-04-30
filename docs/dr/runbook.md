# DR Runbook

Operational procedure for surviving regional failures, model-provider outages, and the long tail of "the system stopped working." Read this before going on call.

## Targets

| Metric | Hosted SaaS | Self-host default | Notes |
|---|---|---|---|
| RPO (data loss) | 15 minutes | 1 hour | Hosted is replicated continuously; self-host depends on your snapshot cadence |
| RTO (time to restore) | 1 hour | 4 hours | Hosted restores via standby promotion; self-host via snapshot restore |
| Uptime | 99.5%/mo | best-effort | Excluding scheduled maintenance announced 48h ahead |
| Sev-1 first response | 15 min | n/a | Hosted on-call rotation |

## Failure modes covered

1. **Postgres primary failure** — corruption, disk failure, instance crash
2. **Region failure** — entire cloud region unavailable
3. **LLM provider outage** — Anthropic / OpenAI / Ollama unreachable
4. **Object storage outage** — uploaded assets unreadable
5. **Vector store (Qdrant) outage** — recall_lessons + voice_score affected
6. **Workflow orchestrator (n8n) outage** — scheduled tasks paused
7. **Event bus (Redpanda) outage** — A.3+ real-time layer paused, platform falls back to synchronous mode
8. **Total cloud-provider outage** — all of the above, simultaneously

## Replication topology (hosted SaaS)

```
                     ┌─────── primary region (e.g. eu-west-2) ──────────┐
                     │                                                  │
   user → traefik → langfuse + n8n + agent services                     │
                     │      │                                           │
                     │      ▼                                           │
                     │   postgres ─── streaming replication ──┬─────────┤
                     │      │                                 │         │
                     │      ▼                                 │         │
                     │   qdrant      object-store              │        │
                     │      │             │                    │        │
                     │      │  (cross-region snapshots, 15m)   │        │
                     └──────┼─────────────┼────────────────────┘        │
                            │             │                              │
                     ┌──────┴─── failover region (e.g. eu-west-3) ──┐    │
                     │                                              │    │
                     │   postgres standby ◀── replication ──────────┘    │
                     │   qdrant snapshots                                 │
                     │   object-store snapshots                           │
                     └────────────────────────────────────────────────────┘
```

Self-host: deploy on whatever cloud + redundancy fits your risk profile. The runbook here describes the hosted shape; self-hosters use the same procedure with their own primary/standby names.

## Restore procedures

### 1. Postgres primary failure (corruption, disk, crash)

**Detection.** Health check on `/health` returns 503. Application errors spike. Replica reports primary unreachable.

**Action.**

1. **Don't panic-promote.** First check if the primary is recoverable. Often a restart does it.
2. If unrecoverable: promote the standby. Update `DATABASE_URL` in the application config. Restart application services.
3. The just-promoted standby has zero replicas; reprovision a new standby from the new primary.
4. Investigate the failed primary. If it's recoverable, optionally fail back during a maintenance window. If not, decommission.

**Expected RTO:** 15-30 minutes. Beats the 1h target by a wide margin in the common case.

### 2. Region failure

**Detection.** Multiple service health checks fail across services in one region. Status page provider's check confirms.

**Action.**

1. Promote the cross-region replica (different region).
2. Update DNS (Route 53 / Cloudflare) to direct traffic to the failover region.
3. Bring up qdrant + object-store from the most recent snapshot in the failover region.
4. Reprovision a primary in the original region once it recovers.
5. Schedule a fail-back during a low-traffic window (or stay in the failover region if traffic patterns allow).

**Expected RTO:** 45-60 minutes (DNS propagation is the long pole).

**RPO trade-off.** The cross-region replica lags the primary by up to 15 minutes. Workspaces lose at most that window of writes. Per the SLA, this is acknowledged in advance.

### 3. LLM provider outage

**Detection.** LiteLLM (the unified router) reports 5xx from a profile target. agent-crewai / agent-langgraph fail to draft.

**Action.** Configured in `infra/litellm/config.yaml` — the router supports per-profile fallback chains. Recommended config:

```yaml
# Each frontier profile has a fallback to a secondary provider, then to local.
WRITER_MODEL:
  primary: anthropic/claude-sonnet-4-6
  fallbacks: [openai/gpt-4o, ollama/llama3.1:70b]
  retry_on: [429, 500, 502, 503, 504]
  retry_budget_seconds: 30

JUDGE_MODEL:
  primary: openai/gpt-4o
  fallbacks: [anthropic/claude-haiku-4-5, ollama/qwen2.5:14b]
  retry_on: [429, 500, 502, 503, 504]
  retry_budget_seconds: 30
```

When all primary + first-fallback options are unavailable, the platform routes to `ollama/*` (local model). Quality drops but the platform stays functional. Per Doc 5 §1.7: a frontier outage must not stop the platform.

**Workspace-side surfacing.** Mission Control shows a banner: "LLM provider degraded — outputs may be lower quality. [provider] reports recovery [eta]." The banner reads from a public status feed; it doesn't stop user workflow.

### 4. Object storage outage

**Detection.** Uploaded brand-kit assets, generated images, and rendered videos return 5xx on fetch.

**Action.**

1. Check if it's a region-bound failure. If so, the cross-region snapshots may serve reads while writes are paused.
2. Surface a "Image generation paused — provider outage" banner. New asset writes queue in Postgres with a retry-on-recovery flag.
3. The agent services check the asset-write queue every minute and replay when storage recovers.

Drafts that don't depend on a fresh asset proceed. Drafts that need a new image park as approvals with the asset-pending flag.

### 5. Qdrant outage

**Detection.** `recall_lessons`, `voice_score`, `retrieve_high_performers` HTTP calls fail.

**Action.** All three tools fail soft — they return empty results plus a `vector_store_unavailable: true` flag. Agent prompts handle the empty case by saying "no captured lessons surfaced for this topic" and proceeding. Drafts are produced; voice scoring is suspended (BrandQA falls back to a regex-based off-voice check).

**Restore.** Qdrant snapshots happen every 15 minutes. Restore from the most recent into a fresh instance, repoint services. Re-embedding past lessons happens lazily as they're re-recalled.

### 6. n8n outage

**Detection.** Scheduled workflows stop firing. The heartbeat check on `n8n:5678/healthz` fails.

**Action.**

1. Check container logs. Restart the container — recovery usually restores the queue.
2. If the failure is database-side (n8n persists state in Postgres), restart Postgres reconciliation (n8n picks up from the last committed run).
3. Workflows that "missed their slot" replay on startup; n8n's queue mode handles backfill.

### 7. Redpanda outage (A.3+)

**Detection.** Topic publish returns 5xx. Real-time layer (bandits, predicted percentile) stops updating.

**Action.** The platform was designed (Phase A.0 verification A.0.2) to run end-to-end with the event bus disabled. Toggle `EVENTBUS_ENABLED=false` in environment; agent services fall back to synchronous mode (predicted percentile not shown on drafts; bandit allocation paused at last assignment).

Restore Redpanda from snapshot, reflag `EVENTBUS_ENABLED=true`, services pick up.

### 8. Total cloud-provider outage

**Detection.** Status-page provider AND application monitoring agree that the entire region (and probably the cloud) is down.

**Action.**

1. Acknowledge on the status page (which is hosted on a different provider — that's why it's a separate vendor in [§5 Privacy.md sub-processors](../../legal/Privacy.md)).
2. If the failover region is also affected, communicate ETA based on the cloud provider's published recovery estimate.
3. Once the provider recovers, walk through procedures 1 + 2 + 4 + 5 + 6 in parallel.

This is the only failure mode where the 1-hour RTO target may slip. The SLA's "force majeure" clause covers it.

## Backups

| What | Cadence | Retention | Restore tested |
|---|---|---|---|
| Postgres logical | hourly | 30 days | quarterly DR drill |
| Postgres PITR (WAL) | continuous | 7 days | continuously (replica is reading WAL) |
| Qdrant snapshot | every 15 min | 7 days | quarterly |
| Object storage | versioned + replicated | 90 days | quarterly |
| n8n workflow defs | every 15 min | 7 days | included in Postgres backup |

## On-call

Hosted SaaS runs a 24/7 on-call rotation once paid customers exist. Pre-revenue: best-effort response from Jake during business hours, async issue tracking otherwise. Documented in [incident-response.md](./incident-response.md).

## Drills

Quarterly: pick one failure mode from the list above, simulate it in staging (or against the failover region), measure detection-to-restore time, write a one-page report. The report goes to `core/docs/dr/drills/<date>-<failure-mode>.md`.

The first drill is "promote standby in failover region" — required before the first paying-customer contract that includes an SLA.
