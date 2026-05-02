# Closed-loop bandit pipeline

Doc 4 §2.3 + §2.4 wired end-to-end. The generate→publish→measure→learn
loop is the load-bearing differentiator: every workspace's bandit
posteriors update from observed performance with no manual tooling.

This doc traces a single piece of content through every service in the
loop, names the events + endpoints, and is honest about what's stub
vs. real.

## The loop

```
   ┌──────────────────────────┐
   │   agent-crewai           │   ① Strategist generates N=2..5
   │   content_factory crew   │      hook variants per platform
   │   ─ Strategist ──────────┼──▶  ② Calls register_bandit tool
   │   ─ LongFormWriter       │     POST {bandit-orch}/bandits
   │   ─ SocialAdapters …     │     → bandit_id
   │   ─ DevilsAdvocate …     │
   │   ─ ClaimVerifier        │
   │   ─ BrandQA              │
   └──────────────────────────┘
                 │
                 │ approved draft + bandit_id
                 ▼
   ┌──────────────────────────┐
   │   agent-langgraph        │   ③ percentile_gate → human approval
   │   publish_pipeline       │      → bandit_allocate
   │                          │     ④ POST {bandit-orch}/bandits/:id/allocate
   │                          │        → variant_id, arm_score
   │                          │     ⑤ publish_to_channel
   │                          │        → emits content.published
   │                          │           with bandit_variant_id
   └──────────────────────────┘
                 │
                 │ Redpanda content.published topic
                 ▼
            (audience interaction — manual or via pollers)
                 │
                 ▼
   ┌──────────────────────────┐
   │   performance-ingest     │   ⑥ POST /ingest with snapshot rows
   │                          │     ⑦ Per metric column:
   │                          │        - update workspace histogram
   │                          │        - compute percentile (vs prior dist)
   │                          │        - compute z-score → anomaly?
   │                          │        - compute velocity (vs prior snapshot)
   │                          │     ⑧ Fan-out:
   │                          │        - emit content.metric_update events
   │                          │        - emit content.anomaly events
   │                          │        - POST {approval-ui}/post-metrics
   └──────────────────────────┘
                 │
                 │ Redpanda content.metric_update topic
                 ▼
   ┌──────────────────────────┐
   │   bandit-orchestrator    │   ⑨ Consumer subscribed to topic
   │   ─ Thompson sampling    │     ⑩ Reverse-index lookup:
   │   ─ Beta(α, β) priors    │        draft_id → (bandit_id, variant_id)
   │   ─ Reward listener      │     ⑪ Filter to events with percentile set
   │                          │     ⑫ _update_posterior(arm, reward=percentile)
   │                          │     ⑬ Persist state file atomically
   │                          │     ⑭ Next /allocate prefers winning variant
   └──────────────────────────┘
```

## Per-step references

| # | Step | Service | File | Commit |
|---|---|---|---|---|
| ① | Generate variants | agent-crewai | crews/content_factory/{tasks,agents}.py | 26f4f6b |
| ② | register_bandit | agent-crewai | tools/register_bandit.py | 26f4f6b |
| ③ | bandit_allocate node | agent-langgraph | workflows/publish_pipeline/nodes.py | 33acc73 |
| ④ | POST /bandits/:id/allocate | bandit-orchestrator | main.py::allocate | eb2ff3b |
| ⑤ | publish_to_channel emit | agent-langgraph | workflows/publish_pipeline/nodes.py | 33acc73 |
| ⑥ | POST /ingest | performance-ingest | main.py::ingest | 4ee4f4a |
| ⑦ | percentile + z + velocity | performance-ingest | histograms.py + velocity.py | 2735c53, 4eae544, bcb8a90 |
| ⑧ | Fan-out (events + persist) | performance-ingest | producer.py + persist.py | 4ee4f4a, 03b4326 |
| ⑨ | Reward consumer | bandit-orchestrator | consumer.py | b68a200 |
| ⑩ | Reverse-index lookup | bandit-orchestrator | main.py::_on_metric_update | b68a200 |
| ⑫ | Posterior update | bandit-orchestrator | main.py::_update_posterior | eb2ff3b |
| ⑭ | Thompson re-sample | bandit-orchestrator | main.py::_thompson_pick | eb2ff3b |

## Topics + envelopes

All envelopes use the EventEnvelopeBase shape from
`services/shared/events/envelope.py`. Per-topic payloads are mirrored
4-way (SQL ↔ zod ↔ pydantic ↔ Drizzle) per the schema contract.

| Topic | Producer | Consumers (today) | Payload |
|---|---|---|---|
| `content.published` | agent-langgraph publish_to_channel | (none yet — bandit consumer doesn't need it; future: campaign rollup) | ContentPublishedPayload |
| `content.metric_update` | performance-ingest `/ingest` | bandit-orchestrator reward listener | ContentMetricUpdatePayload |
| `content.anomaly` | performance-ingest `/ingest` (z-score gate) | (none yet — future: Mission Control alert tile) | ContentAnomalyPayload |

Partition key is `company_id` on every topic so a workspace's events
land on the same partition (per-draft ordering preserved across the
publish→metric update sequence).

## Critical env vars

The closed loop is gated on a small set of env vars. With them unset,
every stage degrades gracefully (events don't flow but services keep
running) so Phase A development isn't blocked.

```bash
# Bus enable + broker config (gates producer.start() in 3 services)
EVENTBUS_ENABLED=true
REDPANDA_BROKERS=redpanda:9092

# Service-to-service auth (gates the HTTP handoffs between Strategist,
# bandit-orchestrator, performance-ingest, approval-ui)
SERVICE_TOKEN=<32-char-secret>

# Per-service base URLs — tools resolve these at call time. Falling
# back to local stubs when unset is intentional (offline-dev contract).
APPROVAL_UI_BASE_URL=http://approval-ui:3000
BANDIT_ORCH_BASE_URL=http://bandit-orchestrator:8008
PERFORMANCE_INGEST_BASE_URL=http://performance-ingest:8006

# Anomaly thresholds (workspace-tunable; defaults match between the
# /ingest per-snapshot detector and the /anomaly/scan bulk surface)
INGEST_Z_THRESHOLD=2.5
INGEST_ANOMALY_MIN_SAMPLES=30
```

## Fail-soft semantics

The loop is designed to degrade in pieces rather than break as a unit.
Every external call has a graceful fallback that surfaces in
structured logs (so ops can see what's down) without blocking the
inbound request.

| Failure | Behaviour |
|---|---|
| Redpanda broker unreachable | producer.emit() returns False; service runs degraded; reward listener stops attributing until broker recovers (no double-counting on recovery — at-least-once delivery via manual offset commit). |
| Bandit-orch unreachable from publish_pipeline | bandit_allocate node returns `{}` partial state; publish proceeds without `bandit_variant_id`; the variant just goes un-attributed (publish itself is unaffected). |
| Approval-ui unreachable from /ingest | persist_batch returns (False, 0); events still emit on the bus; durability is lost for that batch but the bandit signal still flows. |
| Histogram cold start (N < 30) | percentile + anomaly detection both no-op; the bandit consumer correctly skips events with `percentile=null`. |
| Service-token missing | All HTTP-client tools fall back to stub responses with `skipped=true` in the response body. |

## What's still stub

Honest list of what the loop expects from outside but doesn't yet
provide. Each is gated on a separate slice that doesn't block the
core wiring.

- **Live platform pollers** (tweepy/praw/linkedin sdk/etc.) —
  performance-ingest's `/pollers/*` routes are stubs. Without these,
  step ⑥ requires manual snapshot uploads via `/ingest`. The wire
  protocol is identical; only the ingestion driver is missing.
  Gated on per-platform OAuth flows + product calls on which
  platforms to support first.

- **Real channel adapters** (services/adapters/{x,linkedin,...}/
  publish methods). publish_to_channel returns a stub URL. The bus
  emission is real; the actual API call to the platform is not.

- **Mission Control surfaces for the loop**:
  - Bandit experiments tile (read /bandits/:id/state)
  - Anomaly alerts tile (consume content.anomaly events)
  - Per-draft variant performance breakdown
  These are UI work; the data is there.

- **Campaign rollup endpoint** (`performance-ingest/campaigns/:id/rollup`).
  Stub — needs a campaigns table or campaign_id column on drafts. Not
  in scope until campaigns become first-class.

## Verification

61 local logic + contract assertions across the loop's 5 service-side
slices, all CI-green:

- 14 reverse-index + reward attribution
- 10 histogram percentile math + edge cases
- 12 z-score anomaly detection (unit + e2e)
- 14 velocity edge cases (math, time deltas, malformed input, isolation)
- 11 register_bandit contract mirror
- 9 publish_to_channel envelope mirror
- 9 post_metrics persistence contract mirror
- 7 anomaly-scan e2e (spike, drop, in-distribution, lookback, cold-start)
- 8 recent_anomalies contract mirror

Run `git log --grep="Co-Authored-By: Claude" --oneline` to walk the
slices in commit order.
