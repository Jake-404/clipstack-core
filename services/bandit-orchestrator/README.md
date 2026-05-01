# bandit-orchestrator

Multi-armed-bandit variant allocator. **Doc 4 §2.3 — Phase A.3 stub; mabwiser backend lands in a follow-up slice.**

## Why this exists

Single-variant content generation throws away the cheapest signal in marketing: A/B comparison at scale. Treat each piece in a campaign as an arm in a bandit; let Thompson sampling allocate publish slots; let observed engagement update the posterior; let low-performing arms get pruned before they consume more attention.

Per Doc 4 acceptance: a campaign with bandits enabled shows demonstrable lift over a 30-day window vs single-variant generation, statistically significant.

## State machine per `(campaign, platform, message_pillar)`

```
strategist generates N=3..5 variants
        │
        ▼
register_arms (POST /bandits) → bandit_id
        │
        ▼
publish_pipeline calls /allocate before publish_to_channel
        │
        ▼  variant_id selected via Thompson sample from arm posteriors
publish_to_channel tags content.published event with variant_id
        │
        ▼  observation window: 72h default
content.metric_update events feed /reward — posterior updates
        │
        ▼  end of window
prune low-performers, top arms seed next generation
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness probe |
| `POST` | `/bandits` | Register a new bandit (variants → arms) |
| `POST` | `/bandits/:bandit_id/allocate` | Return next variant to publish |
| `POST` | `/bandits/:bandit_id/reward` | Record observed engagement → update posteriors |
| `GET`  | `/bandits/:bandit_id/state` | Read-only state for Mission Control's experiments tile |

### Register

```
POST /bandits
{
  "company_id": "<uuid>",
  "campaign_id": "<uuid>",
  "platform": "linkedin",
  "message_pillar": "founder-thesis",
  "variants": [
    { "variant_id": "v1", "draft_id": "<uuid>", "body_excerpt": "...", "predicted_percentile": 73 },
    { "variant_id": "v2", "draft_id": "<uuid>", "body_excerpt": "...", "predicted_percentile": 68 },
    { "variant_id": "v3", "draft_id": "<uuid>", "body_excerpt": "...", "predicted_percentile": 81 }
  ],
  "algorithm": "thompson",
  "exploration_budget": 0.10,
  "observation_window_hours": 72
}

→ { "bandit_id": "bandit_a3f2c1...", "arm_count": 3 }
```

### Allocate

```
POST /bandits/bandit_a3f2c1.../allocate
{ "company_id": "<uuid>" }

→ {
  "bandit_id": "bandit_a3f2c1...",
  "variant_id": "v3",
  "arm_score": 0.87,
  "rationale": "Thompson sample favoured v3 — posterior mean 0.74, 95% CI [0.68, 0.79]"
}
```

### Reward

```
POST /bandits/bandit_a3f2c1.../reward
{
  "bandit_id": "bandit_a3f2c1...",
  "variant_id": "v3",
  "reward": 78.4,                    // workspace-relative percentile, 0..100
  "snapshot_at": "2026-04-30T15:00:00Z"
}

→ { "posterior_mean": 0.74 }
```

## What ships in A.3 (this slice)

- FastAPI shell on port 8008
- Pydantic schemas for all four endpoints (final shape; bodies fill when mabwiser wires)
- Stub mode (`BANDIT_STUB_MODE=1`, default) — `/bandits` returns a fresh id, `/allocate` returns a placeholder variant, `/reward` no-ops, `/state` returns empty arms
- Dockerfile (base deps only — `[ml]` extra adds mabwiser + numpy when sampling wires)

## What lands in the follow-up slice

| Item | Backend |
|---|---|
| Thompson sampling per arm | `mabwiser.MAB(arms, learning_policy=LearningPolicy.ThompsonSampling())` |
| Beta-distribution posteriors | per-arm (alpha, beta) state persisted to Postgres |
| Bandit state tables | new migration: `bandits` + `bandit_arms` + `bandit_observations` |
| Event-bus consumer | `aiokafka` consumer on `content.metric_update`, filters to bandit-tagged drafts, calls `/reward` |
| Pruning at observation window end | nightly job that closes underperforming arms, emits `bandit.arm_pruned` (new topic if added later) |
| Predicted-percentile prior | when arm registers, Thompson prior seeded from USP 1's predicted_percentile rather than uninformed |

## Wiring (planned)

- `agent-langgraph/workflows/publish_pipeline/` — adds `bandit_allocate` node before `publish_to_channel` when `EVENTBUS_ENABLED=true` and the draft's campaign has bandits enabled
- `approval-ui` Mission Control — bandit-experiments tile reads from `/state` for live arm performance
- `agent-crewai/crews/content_factory/` — strategist task description includes "your variants will compete in a bandit; rank them by hypothesis differentiation, not similarity"

## Hard rule

Per Doc 4 §2.3: **never reduce the exploration budget below 5%.** Without floor exploration, posteriors drift on stale wins and the bandit collapses to repeated allocations of a once-good variant whose context has changed. The orchestrator enforces a floor of 0.05 even if a workspace requests less.
