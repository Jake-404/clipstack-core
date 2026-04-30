# voice-scorer

Brand-voice fingerprinting. **USP 3 — Phase A.2 stub; SetFit + Qdrant backend lands in a follow-up slice.**

## Why this exists

A draft can be factually correct, brand-safe, and still sound nothing like the company. The voice-scorer catches that gap. BrandQA's `voice_score` tool calls this service; if the draft scores below the workspace threshold, BrandQA blocks the publish path and surfaces the top-3 most-similar + top-3 least-similar exemplars so the writer can see *why*.

## The two-layer score

| Layer | What it catches | Backend |
|---|---|---|
| Cosine similarity | Word-choice + topic-shape overlap with workspace exemplars | Qdrant collection per workspace, embeddings via LiteLLM VOICE_EMBED_MODEL profile (Ollama nomic-embed-text in the default config) |
| SetFit classifier | Style patterns cosine alone misses — cadence, hedging density, jargon-specific phrasing — trained on labelled in-voice / off-voice samples | sentence-transformers + sklearn head; per-workspace classifier persisted to disk |

Final score = blend (default 0.6 cosine + 0.4 classifier; workspace-tunable).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health`  | Liveness probe |
| `POST` | `/score`   | Score a draft; return passes/fails + exemplars |
| `POST` | `/train`   | Train (or retrain) the workspace's classifier |

### Score

```
POST /score
{
  "company_id": "<uuid>",
  "draft": "<text>",
  "threshold": 0.65,
  "return_exemplars": true,
  "client_id": null
}

→ {
  "request_id": "<uuid>",
  "score": 0.74,
  "passes": true,
  "threshold": 0.65,
  "nearest":  [{ "id": "...", "similarity": 0.92, "text_excerpt": "...", "tone_tags": [...] }, ...],
  "farthest": [{ "id": "...", "similarity": 0.08, "text_excerpt": "...", "tone_tags": [...] }, ...],
  "model_version": "setfit-mini-2025-Q1",
  "skipped": false
}
```

### Train

```
POST /train
{
  "company_id": "<uuid>",
  "in_voice_samples":  ["<text>", ...],
  "off_voice_samples": ["<text>", ...]
}

→ {
  "request_id": "<uuid>",
  "company_id": "<uuid>",
  "in_voice_count": 50,
  "off_voice_count": 20,
  "trained_at": "<iso-8601>",
  "skipped": false
}
```

Training cadence:
- Initial: triggered when a workspace adds its first ~30 in-voice samples
- Periodic: nightly retraining if the corpus grew >10% since last train
- On-demand: when an admin updates the brand-kit voice section

## What ships in A.2 (this slice)

- FastAPI shell on port 8005
- Pydantic schemas for /score + /train (final shape; bodies fill in when backend wires)
- Stub mode (`VOICE_SCORER_STUB_MODE=1`, default) returns score=1.0 / passes=true
- Dockerfile (base deps only — SetFit + sentence-transformers gated behind the `ml` extra so the stub image stays small)

## What lands in the follow-up slice

| Item | Backend |
|---|---|
| Qdrant collection per workspace | `qdrant-client` HTTP API; collections named `voice-{company_id}` |
| Embedding via LiteLLM | `VOICE_EMBED_MODEL` profile → Ollama nomic-embed-text (per `infra/litellm/config.yaml`) |
| SetFit classifier | `setfit>=1.1` + `sentence-transformers>=3.3`; per-workspace head persisted under `/data/voice-classifiers/{company_id}.pkl` |
| Cosine + classifier blend | Workspace-tunable weight (default 0.6 / 0.4) |
| Bootstrapping from approved drafts | One-time training pipeline that pulls top-quartile drafts from the workspace's history when no manual samples exist yet |

## Local dev

```bash
cd services/voice-scorer
uv sync
uv run uvicorn main:app --reload --port 8005
# → http://localhost:8005/health
```

## Wiring into agent-crewai

The agent-crewai `voice_score` tool calls this service when `VOICE_SCORER_BASE_URL` is set in the agent service's environment. Without it, the tool falls back to its own stub (returns score=1.0). This keeps the crew constructable in dev and lights up automatically when the service is provisioned.

## Hard rule

Never log raw draft text at INFO+. Logs carry `request_id`, `company_id`, `draft_len`, `threshold` only. A debug-mode flag (`VOICE_LOG_FULL_TEXT=1`) exists for local development; CI rejects PRs that toggle it on.
