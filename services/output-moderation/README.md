# output-moderation

Generic LLM-output safety classifier. **Phase A.1 stub — Llama Guard 3 backend lands A.2.**

Per Doc 5 §1 P0: every artifact that surfaces in a workspace (approval queue, channel publish path, agent reply) passes through this gate first. It's the **safety floor** — fixed policy independent of workspace configuration.

## The two-tier safety model

| Layer | Service | Purpose | Configurable per workspace? |
|---|---|---|---|
| Floor | `output-moderation` (this) | Baseline harms — violence, CSAM, hate, self-harm, etc. | Verdict thresholds only; categories are fixed |
| Policy | `brand_safety_check` (in `agent-crewai/tools/`) | Profanity, prohibited terms, competitor disparagement, regulated-claim shapes | Fully workspace-configured |

Both run on every output. They answer different questions. A draft can pass workspace policy and still fail the safety floor (extremely off-thesis content); a draft can pass the safety floor and still fail workspace policy (workspace bans certain competitor names that the floor doesn't care about).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness probe |
| `POST` | `/moderate` | Classify text against Llama Guard 3 categories |

### Moderate

```
POST /moderate
{
  "text": "<text to classify>",
  "kind": "assistant_output",         // user_input | assistant_output
  "prior_user_turn": "<context>",     // required if kind=assistant_output
  "block_categories": ["S10_hate"],   // workspace overrides (optional)
  "flag_categories": ["S5_defamation"]
}

→ {
  "request_id": "<uuid>",
  "verdict": "pass" | "flag" | "block",
  "findings": [
    { "category": "S1_violent_crimes", "rationale": "..." }
  ],
  "classifier": "llama-guard3:8b",
  "skipped": false
}
```

## Llama Guard 3 categories

The model card (Meta, 2024) defines 14 standard categories:

| ID | Name | Default verdict |
|---|---|---|
| S1 | Violent Crimes | block |
| S2 | Non-Violent Crimes | flag |
| S3 | Sex-Related Crimes | block |
| S4 | Child Sexual Exploitation | block |
| S5 | Defamation | flag |
| S6 | Specialized Advice (legal/medical/financial) | flag (escalate to block when no disclosure required) |
| S7 | Privacy | flag |
| S8 | Intellectual Property | flag |
| S9 | Indiscriminate Weapons (CBRN) | block |
| S10 | Hate | block |
| S11 | Suicide & Self-Harm | block |
| S12 | Sexual Content | flag |
| S13 | Elections | flag |
| S14 | Code Interpreter Abuse | block |

Workspaces can demote any category from block → flag (e.g., adult-content workspace permits S12) or escalate flag → block (e.g., regulated-finance workspace blocks S6 entirely).

## What ships in A.1

- FastAPI shell on port 8004
- Pydantic schemas including all 14 Llama Guard categories
- Stub mode (`MODERATION_STUB_MODE=1` default) returns `verdict='pass'` for every request
- Dockerfile

## What lands in A.2

- Llama Guard 3 (8B) hosted by the existing Ollama container — pull happens at first invocation, cached locally
- Prompt template per Llama Guard model card (different shape for `user_input` vs. `assistant_output`)
- Structured-output parser handling the `safe` / `unsafe\nS<n>` response format
- Workspace policy resolver (block/flag override application)
- Per-workspace category enable/disable

## Local dev

```bash
cd services/output-moderation
uv sync
uv run uvicorn main:app --reload --port 8004
# → http://localhost:8004/health
# → POST http://localhost:8004/moderate
```

## Wiring into agent + publish services (planned, A.2)

Agent-crewai's `BrandQA` task gains a moderation hook before its tool pass; if `verdict='block'` the draft fails immediately without consuming the rest of the budget on voice scoring.

Agent-langgraph's `publish_pipeline` adds a `moderation_gate` node between `review_cycle` and `awaiting_human_approval`. Block verdicts route to `record_block_lesson`; flag verdicts surface to the human approver as a content advisory.

## Hard rule

The classifier is *advisory* for `flag` verdicts and *enforcing* for `block` verdicts. A workspace cannot disable the safety floor entirely — only re-policy individual categories. Disabling a category that the platform owner has marked as locked (default: S4 child sexual exploitation) requires platform-admin approval, not workspace-admin.
