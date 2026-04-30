# shared/events

The 9-topic event bus contract. Per Doc 4 §2.1.

## Why this exists

Real-time agents need to react to platform signals on a timescale of seconds, not nightly. The event bus is the spine: pollers and detectors publish events, agents subscribe to relevant topics, no agent polls the database for state changes that already exist as events.

This directory holds **only the contract** — topic names, payload shapes, version field, idempotency rules. The producer/consumer wiring lives in `services/performance-ingest/`, `services/bandit-orchestrator/`, the CrewAI crews, and the LangGraph workflows. The contract is shared so a producer in Python and a consumer in TypeScript see the same shape.

## The 9 topics

Per Doc 4 §2.1:

| Topic | Producers | Consumers |
|---|---|---|
| `content.published` | LangGraph publish_pipeline | EngagementAgent, performance-ingest, AlgorithmProbe |
| `content.metric_update` | performance-ingest pollers | bandit-orchestrator, percentile-predictor (retrain), Mission Control |
| `content.anomaly` | performance-ingest anomaly detector | LiveEventMonitor, Mission Control crisis tile |
| `trend.detected` | TrendDetector crew | content_factory orchestrator (reactive content), Mission Control |
| `competitor.signal` | competitive-intelligence crew (A.3+) | Strategist (in content_factory) |
| `platform.algorithm_shift` | AlgorithmProbe crew | platform shapers, signals/algorithms loader |
| `campaign.brief_updated` | strategist (living-brief feature) | all agents working on the campaign |
| `live_event.detected` | LiveEventMonitor crew | crisis-monitor, publish_pipeline (pause-on-event guard) |
| `engagement.opportunity` | EngagementAgent | EngagementAgent reply pipeline, approval queue |

## Contract files

```
events/
├── topics.ts          # Topic name constants — sole source of truth
├── topics.py          # Python mirror
├── schemas.ts         # zod schemas for each topic's payload
├── schemas.py         # pydantic mirrors
├── envelope.ts        # the wrapper every event carries (id, occurred_at, version, etc)
├── envelope.py        # Python mirror
└── README.md
```

## The envelope

Every event published to the bus carries this wrapper:

```ts
{
  // Stable id for idempotency. Consumers should be safe against duplicates.
  id: "evt_<ulid>",
  // Topic name — duplicated here so the consumer doesn't need to read the
  // Kafka header to dispatch.
  topic: "content.published",
  // Schema version. Bumping this triggers a fan-out compatibility migration.
  version: 1,
  // ISO-8601. Set by the producer; consumers should NOT trust it for ordering
  // (use Kafka offsets) but DO use it for stale-event detection.
  occurredAt: "2026-04-30T14:23:00Z",
  // Tenant scope. Required on every event. Cross-tenant fanout is forbidden.
  companyId: "<uuid>",
  clientId: "<uuid> | null",
  // Distributed tracing — Langfuse trace ID round-trip.
  traceId: "<string> | null",
  // The actual payload, shape determined by topic.
  payload: { ... }
}
```

## Idempotency

Producers MUST set `id` deterministically when re-emitting the same logical event (e.g., a metric snapshot at the same `snapshot_at` for the same draft should always have the same id). Consumers MUST handle duplicates idempotently. The bus is at-least-once, not exactly-once.

## Tenant isolation

Every event has a `companyId`. Consumers filter on it. The bus does NOT enforce tenant isolation — that's the consumer's job. Cross-tenant subscription is a privilege gated by service-token role; the application services never subscribe across tenants.

## Versioning

When a payload shape needs to change:
1. Bump `version` in the producer.
2. Add a new schema variant in `schemas.ts` for the new version.
3. Consumers branch on `event.version` until all consumers have updated.
4. After a deprecation window (default 30 days), remove the old variant from the schema file.

This is dual-write friendly: a producer can emit both v1 and v2 during transition.

## Status

Phase A.3 (this slice) ships the contract. Phase A.3 (later slices) wire the producers + consumers. The Redpanda broker is already in `docker-compose.yml` from A.0; A.3 just puts traffic on it.

When `EVENTBUS_ENABLED=false` (default), services run in a synchronous mode where producers no-op and consumers don't subscribe. The platform stays functional — just without the real-time tier (Doc 4 §2.4 percentile gate falls back to last-known-percentile, bandits pause at last assignment, EngagementAgent doesn't wake on replies).
