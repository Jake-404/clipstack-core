# percentile-predictor

Pre-publish predicted-percentile gate. **Doc 4 §2.4 — Phase A.3 stub; LightGBM backend lands in a follow-up slice.**

## What this surface buys

The approver sees a number before deciding: "Predicted to land in the 73rd percentile (±15)." Workspaces can configure a hard gate — predicted percentile below threshold auto-denies before a human ever sees the draft. The publish_pipeline node `percentile_gate` calls this service.

## How the model works (when wired)

LightGBM gradient-boosted regressor trained per-workspace on `(features, achieved_percentile)` pairs from this workspace's history. Features:

- Draft embedding (via LiteLLM `VOICE_EMBED_MODEL` profile, ~384d)
- Time-of-day + day-of-week (cyclical encoding)
- Hashtag set (one-hot of top-50 platform-relevant)
- Word count
- Has media (boolean)
- Voice score (from voice-scorer service)
- Claim count (from `drafts.claims` JSON)
- Sentiment (cached from inbound LLM judge)

Quantile regression heads (5%, 50%, 95%) produce the confidence band. Calibration tracker stores actual-vs-predicted residuals; when `mean_absolute_error` exceeds workspace threshold, retraining triggers.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness probe |
| `POST` | `/predict` | Predict percentile for a draft |
| `POST` | `/train` | Train (or retrain) with labelled samples |
| `GET`  | `/calibration/:company_id` | Calibration stats for the workspace's current model |

### Predict

```
POST /predict
{
  "company_id": "<uuid>",
  "client_id": null,
  "kpi": "engagement_rate",
  "features": {
    "text": "<draft body>",
    "channel": "linkedin",
    "scheduled_for": "2026-04-30T15:00:00Z",
    "hashtags": ["AI", "Marketing"],
    "has_media": true,
    "voice_score": 0.82,
    "claim_count": 3,
    "word_count": 240
  }
}

→ {
  "request_id": "<uuid>",
  "predicted_percentile": 73.4,
  "confidence_low": 58.0,
  "confidence_high": 88.0,
  "confidence_interval": 30.0,
  "top_features": [
    { "feature": "voice_score", "contribution": 12.4 },
    { "feature": "scheduled_for_hour", "contribution": 5.1 },
    { "feature": "has_media", "contribution": 3.8 }
  ],
  "model_version": "lgb-2026-04-Q1",
  "skipped": false
}
```

## What ships in A.3 (this slice)

- FastAPI shell on port 8007
- Pydantic schemas for /predict /train /calibration (final shape; bodies fill when LightGBM wires)
- Stub mode (`PREDICTOR_STUB_MODE=1`, default) returns `predicted_percentile=50` with ±15 band and `skipped=true`. Mission Control should surface this honestly as "predictor not ready — workspace needs ~50 historical posts to train" rather than as a confident 50.
- Dockerfile (base deps only — LightGBM gated behind `[ml]` extra)

## What lands in the follow-up slice

| Item | Backend |
|---|---|
| Per-workspace LightGBM model | `lightgbm>=4.5`, persisted under `/data/predictors/{company_id}-{kpi}.lgb` |
| Quantile regression for confidence bands | LightGBM with `objective='quantile'` × 3 (5/50/95) |
| Feature engineering pipeline | Embedding via LiteLLM; cyclical time encoding; hashtag one-hot |
| Calibration tracker | residuals table in Postgres; nightly aggregator updates `mean_absolute_error` + `within_15_pct_rate` |
| Drift trigger | when MAE > workspace threshold, emit `predictor.drift_detected` (dedicated topic, A.3+) → cron retraining |

## Wiring

Consumers (Phase A.3+):
- `agent-langgraph/workflows/publish_pipeline/` — adds `percentile_gate` node before `awaiting_human_approval`. Reads workspace `min_percentile_threshold` config; below → reroute to revise.
- `agent-crewai/crews/content_factory/` — strategist agent's task description includes "your draft will be predicted by the percentile predictor before any human sees it; design for the top quartile."
- `approval-ui` Mission Control draft-detail panel — surfaces predicted percentile + confidence band + top-feature contributions.

## Hard rule

Never log raw draft text at INFO+. Logs carry `request_id`, `company_id`, `kpi`, `word_count` only. The model loads draft text into memory but never writes it to disk outside of training-sample storage (which lives in `clipstack_app`-RLS-protected Postgres, never on the predictor's local filesystem).
