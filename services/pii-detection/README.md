# pii-detection

PII detection + redaction service. **Phase A.1 stub — Presidio backend lands A.2.**

Per Doc 5 §1 P0: every workspace artifact that lands in Postgres / Qdrant must pass through PII scan first. Detection-and-redact is centralised here so that:

- Agent services (agent-crewai, agent-langgraph) call one HTTP endpoint, not a library.
- The detector implementation can swap from Presidio to anything else without touching callers.
- Custom recognizers (crypto-wallet addresses, API keys, regime-specific identifiers) live in one place.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness probe — used by docker-compose |
| `POST` | `/scan`   | Detect PII; return structured detections without modifying input |
| `POST` | `/redact` | Detect AND redact in one call; return redacted text + detections |

### Scan

```
POST /scan
{
  "text": "<your text>",
  "language": "en",                  // optional, default en
  "entities": ["EMAIL_ADDRESS","PHONE_NUMBER"],  // optional, null = all configured
  "score_threshold": 0.4             // optional, default 0.4
}

→ {
  "request_id": "<uuid>",
  "detections": [
    {
      "entity_type": "EMAIL_ADDRESS",
      "start": 42,
      "end": 60,
      "score": 0.99,
      "text": "jane@example.com"
    }
  ],
  "detector_version": "presidio-2.2.x",
  "skipped": false
}
```

### Redact

```
POST /redact
{
  "text": "<your text>",
  "mode": "replace",                 // mask | replace | remove | hash
  "entities": null,                  // optional
  "score_threshold": 0.4
}

→ {
  "request_id": "<uuid>",
  "redacted_text": "Email Jane at <EMAIL_ADDRESS> for details.",
  "detections": [...],
  "skipped": false
}
```

## What ships in A.1

- FastAPI shell on port 8003
- Pydantic schemas (request + response)
- Stub mode (`PII_STUB_MODE=1` default) returns no detections; the input is returned unmodified
- Dockerfile

## What lands in A.2

| Item | Backend |
|---|---|
| Presidio Analyzer integration | `presidio-analyzer` with `en_core_web_lg` |
| Presidio Anonymizer integration | `presidio-anonymizer` with mode → operator mapping |
| Custom recognizers | `CRYPTO_WALLET` (Bitcoin / Ethereum / VeChain), `API_KEY` (common provider patterns) |
| Workspace-configured entity allowlists | Read per-workspace config from Postgres |
| Multi-language support | spaCy multilingual model |
| Span-aware redaction in long texts | Maintain offset map across replacement ops |

## Local dev

```bash
cd services/pii-detection
uv sync
uv run uvicorn main:app --reload --port 8003
# → http://localhost:8003/health    → {"status":"ok"}
# → POST http://localhost:8003/scan with a text body
```

## Wiring into agent services (planned, A.2)

Agent-crewai's tool layer will gain a `pii_scan` tool that wraps this service. The Researcher agent runs `pii_scan` on inbound source material before any extraction; the BrandQA agent runs it on every adapted draft as a final-pass guardrail.

Agent-langgraph's `publish_pipeline` adds a node `pii_gate` between `awaiting_human_approval` and `publish_to_channel` — any draft with detections of `severity='block'` (workspace-configured per-entity-type policy) routes back to the human approver with the spans flagged.

## Hard rule

Never log redacted text content at INFO or above. The service logs only request_id, text length, language, and detection count — never the input or output. A debug-mode flag (`PII_LOG_FULL_TEXT=1`) exists for local development; CI rejects PRs that toggle it on.
