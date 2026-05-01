# performance-ingest

Per-platform pollers + anomaly detector + campaign rollup. **Doc 4 §2.2 — Phase A.3 stub; live pollers + Redpanda producer + rolling z-score detector land in a follow-up slice.**

## Why this exists

The streaming spine of the real-time tier. Replaces the nightly performance refresh with a continuous pipeline so engagement metrics flow into agent context within 5 minutes of platform availability (Doc 4 acceptance criterion).

## Pipeline

```
            ┌─────────────────────────────────────────────────────────┐
            │  per-platform pollers (X / LinkedIn / Reddit / TikTok / │
            │  Instagram), tiered cadence per artefact age            │
            └────────────────────────┬────────────────────────────────┘
                                     ▼
                         ┌──────────────────────┐
                         │  /ingest endpoint    │  ← also accepts manual upload
                         └──────────┬───────────┘
                                    ▼
        ┌──────────────────────────────────────────────────────────┐
        │  diff detector — computes metric_velocity vs prev snap    │
        └────────────────────────┬─────────────────────────────────┘
                                 ▼
        ┌──────────────────────────────────────────────────────────┐
        │  rolling z-score anomaly detector                         │
        └────────┬──────────────────────────┬──────────────────────┘
                 │                          │
                 ▼                          ▼
       content.metric_update        content.anomaly  ← Redpanda topics
                 │                          │
                 ▼                          ▼
        bandit-orchestrator         crisis-monitor / Mission Control
        percentile-predictor (retrain signal)
        approval-ui (Mission Control + post_metrics writes)
```

## Polling cadence (Doc 4 §2.2)

Per-artefact age tiers — rate-limit aware:

| Age | Cadence | Why |
|---|---|---|
| 0–24h | 60–300s (varies by platform rate limits) | First 24h is the engagement window where signal-to-noise is highest; bandits need data fast |
| 24h–7d | 30 minutes | Performance has stabilised; cheaper polling preserves rate-limit budget |
| 7d+ | daily | Long-tail signal only; lifecycle-agent reads the daily snapshot |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness probe |
| `POST` | `/ingest` | Accept a batch of metric snapshots (manual upload or poller-internal) |
| `GET`  | `/pollers/status` | Read-only view of every platform poller's state |
| `POST` | `/pollers/:platform/start` | Start the poller for a platform (idempotent) |
| `POST` | `/pollers/:platform/stop` | Stop the poller — drafts in flight finish their poll window |
| `POST` | `/anomaly/scan` | Run rolling z-score over recent snapshots |
| `GET`  | `/campaigns/:campaign_id/rollup` | Materialised per-campaign aggregation |

### Ingest

```
POST /ingest
{
  "company_id": "<uuid>",
  "client_id": null,
  "snapshots": [
    {
      "draft_id": "<uuid>",
      "platform": "linkedin",
      "snapshot_at": "2026-05-01T15:00:00Z",
      "impressions": 4287,
      "reach": 3104,
      "clicks": 142,
      "reactions": 87,
      "comments": 12,
      "shares": 4,
      "saves": 9,
      "raw": { "linkedin_specific_field": "..." }
    }
  ],
  "request_id": "<optional ulid for idempotency>"
}

→ {
  "request_id": "<uuid>",
  "accepted_count": 1,
  "duplicate_count": 0,
  "events_emitted": 1,
  "skipped": false
}
```

### Anomaly scan

```
POST /anomaly/scan
{
  "company_id": "<uuid>",
  "lookback_hours": 24,
  "z_threshold": 2.5
}

→ {
  "detections": [
    {
      "draft_id": "<uuid>",
      "platform": "x",
      "metric": "engagement_rate",
      "z_score": 3.4,
      "value": 0.12,
      "rolling_mean": 0.04,
      "rolling_std": 0.024,
      "detected_at": "2026-05-01T15:30:00Z"
    }
  ],
  "events_emitted": 1
}
```

## What ships in A.3 (this slice)

- FastAPI shell on port 8006
- Pydantic schemas for /ingest /pollers /anomaly /campaigns (final shape; bodies fill when pollers wire)
- Stub mode (env-aware default per the morning triage):
  - dev/test: `INGEST_STUB_MODE=1` → /ingest accepts but emits nothing; pollers report inactive
  - prod: `INGEST_STUB_MODE=0` by default → falls through to NotImplementedError so a forgotten-to-wire deployment fails loudly. Lifespan logs structured warning when operator opts into stub mode in prod.
- Dockerfile (base deps only — `[runtime]` extra adds aiokafka + tweepy + praw + numpy + asyncpg when live wiring lands)

## What lands in the follow-up slice

| Item | Backend |
|---|---|
| Live pollers | `tweepy` (X), `praw` (Reddit), platform SDKs for LinkedIn / TikTok / Instagram. Tiered cadence enforced by an in-process scheduler keyed off `drafts.published_at` |
| Redpanda producer | `aiokafka.AIOKafkaProducer` to `content.metric_update` and `content.anomaly` topics |
| Rolling z-score detector | `numpy` rolling stats per (workspace, draft, platform, metric); window default 14 days |
| Campaign rollup | direct Postgres read via `asyncpg` against `post_metrics_latest` view, materialised every minute when the campaign has active drafts |
| Rate-limit awareness | per-platform credit tracker; pollers back off when remaining < 10% of window |
| Idempotency | `(draft_id, platform, snapshot_at)` unique index already on `post_metrics`; service deduplicates before write |

## Wiring (planned)

- Subscribers of `content.metric_update`:
  - bandit-orchestrator (reward updates)
  - percentile-predictor (retrain trigger when sample count grows by N)
  - approval-ui (post_metrics writes via /api consumer)
- Subscribers of `content.anomaly`:
  - crisis-monitor (severity threshold check)
  - approval-ui Mission Control crisis tile
  - LiveEventMonitor (correlation with detected events)

## Hard rules

- Never log raw platform API responses at INFO+ — they often carry account identifiers / DM previews / private fields the pollers don't strip until parsing. Logs carry `(workspace, platform, snapshot_count)` only.
- Idempotency keyed on `(draft_id, platform, snapshot_at)`. A second snapshot at the same timestamp is a no-op, never a duplicate row.
- Rate-limit floor: pollers MUST back off below 10% of remaining quota even when the Doc 4 cadence calls for a sooner poll. A starved API key blocks every workspace on shared infra.
