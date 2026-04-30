# agent-crewai

CrewAI role-based pipelines for Clipstack core. **Phase A.0 skeleton — all tools are stubs.**

## What ships in A.0

- `main.py` — FastAPI on `:8001` with `/health`, `/crews`, `/crews/content_factory/kickoff`
- `models.py` — LiteLLM named-profile loader (`WRITER_MODEL` / `CLASSIFIER_MODEL` / `JUDGE_MODEL` / `VOICE_EMBED_MODEL`)
- `crews/content_factory/` — Doc 1 §7.1 sequential pipeline: `Researcher → Strategist → LongFormWriter → SocialAdapter(per-platform) → NewsletterAdapter → BrandQA`
- `tools/` — seven tools: `recall_lessons` / `retrieve_high_performers` / `voice_score` / `asset_search` / `pay_and_fetch` / `claim_verifier` / `hashtag_intel` (all stubs)

The crew constructs cleanly in `CREWAI_DRY_RUN=1` (default) without external LLM calls — it validates wiring, returns a `trace_id`, and parks. Live execution lands in A.2.

## What lands later

| Phase | Work |
|---|---|
| **A.2** | `voice_score` (SetFit + corpus), `retrieve_high_performers` (post_metrics + content_embeddings), USP 5 enforcement on rationale |
| **A.3** | 9 more crews: `social_listener`, `weekly_report`, `brand_qa`, `devils_advocate_qa`, `engagement`, `lifecycle`, `trend_detector`, `algorithm_probe`, `live_event_monitor` |
| **B**  | `claim_verifier` (USP 8 provenance) |
| **5.1**| `pay_and_fetch` (USP-C1 x402 outbound) |

## Local dev

```bash
uv sync
uv run uvicorn main:app --reload --port 8001
# → http://localhost:8001/health → {"status":"ok"}
# → http://localhost:8001/crews  → {"available":["content_factory"], ...}
```

## In docker-compose

This service is not yet wired into `core/docker-compose.yml` — it's a Python build context that takes ~2 minutes to provision. A.0 ships the Dockerfile so it can be enabled in A.2 with one block:

```yaml
agent-crewai:
  build: ./services/agent-crewai
  environment:
    LITELLM_BASE_URL: http://litellm:4000
    LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY:-sk-clipstack-dev}
    QDRANT_URL: http://qdrant:6333
    POSTGRES_URL: postgresql://...
  depends_on:
    litellm: { condition: service_healthy }
    qdrant:  { condition: service_healthy }
  ports: ['8001:8001']
```
