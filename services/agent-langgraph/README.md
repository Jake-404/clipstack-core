# agent-langgraph

LangGraph stateful workflows for Clipstack core. **Phase A.0 skeleton — in-memory checkpointer, stub nodes.**

## What ships in A.0

- `main.py` — FastAPI on `:8002` with `/health`, `/workflows`, `/workflows/publish_pipeline/start`
- `workflows/publish_pipeline/` — full state graph compiled and validated:
  - `state.py` — `PublishState` TypedDict (draft + review + approval + publish + metering fields)
  - `nodes.py` — six node functions (`review_cycle`, `awaiting_human_approval`, `publish_to_channel`, `record_metering`, `record_block_lesson`, `record_deny_lesson`)
  - `graph.py` — compiled `StateGraph` with conditional routing on review verdict and approval decision
- `checkpoints/` — placeholder for the Postgres checkpointer wiring (A.2)

The graph compiles in dry-run (`LANGGRAPH_DRY_RUN=1`). Live execution requires LiteLLM, the approval-ui webhook, and a real channel adapter — all land in A.2.

## What lands later

| Phase | Work |
|---|---|
| **A.2** | Swap `MemorySaver` → `PostgresSaver`. Wire `record_deny_lesson` to USP 5 enforcement. Wire `publish_to_channel` to live adapters. |
| **A.3** | `bandit_orchestrator` workflow (Doc 4 §2.3 — mabwiser variant allocation across published posts) |
| **B**   | `paid_campaign_review` workflow (ad-budget gate before paid spend) |
| **D**   | `crisis_response` workflow (USP 6 — playbook lookup → draft → escalate) |

## Local dev

```bash
uv sync
uv run uvicorn main:app --reload --port 8002
# → http://localhost:8002/health
# → http://localhost:8002/workflows
```

## State machine (A.0)

```
START
  │
  ▼
review_cycle ──revise──▶ review_cycle (max 3)
  │            │
  │            block──▶ record_block_lesson ──▶ END
  │
  pass
  │
  ▼
awaiting_human_approval ──deny──▶ record_deny_lesson ──▶ END
  │
  approve
  │
  ▼
publish_to_channel
  │
  ▼
record_metering ──▶ END
```
