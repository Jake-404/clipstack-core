"""Generic LLM-output safety classifier.

Per Doc 5 §1 P0 — every artifact that flows into a workspace surface
(approval queue, channel publish path, agent reply) passes through this
gate first. Catches the *baseline* safety categories independent of
workspace config:

  - violent crimes, weapons, indiscriminate harm
  - sex-related crimes, child sexual exploitation
  - hate, discrimination
  - suicide & self-harm
  - illegal activity, dangerous instructions
  - sexual content (R-18)
  - election manipulation
  - defamation, IP infringement, privacy violation

Distinguished from `brand_safety_check` (workspace-configured policy):
this service is a fixed-policy safety FLOOR; brand-safety is workspace-
specific policy on top. Both run; they answer different questions.

Real backend (sprint-close+): Llama Guard 3 (8B) served by the Ollama
container in docker-compose.yml. Ollama applies the model's chat
template, so we just send `messages=[{user, assistant}]` and parse the
"safe / unsafe + S<n>,S<n>,..." structured response into category
findings + a workspace-policy-aware verdict (block / flag / pass).

Stub mode (env-aware default):
  dev/test: MODERATION_STUB_MODE=1 → returns verdict='pass' without
            calling Ollama.
  prod:     MODERATION_STUB_MODE=0 by default → calls Ollama. A forgot-
            to-wire deploy fails loudly with a clear "Ollama unreachable"
            error rather than silently returning verdict='pass' on every
            prompt+response (the worst possible failure mode for a
            safety classifier).

Mounted at port 8004. Health check is consumed by docker-compose.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal
from uuid import uuid4

import httpx
import structlog
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

log = structlog.get_logger()

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434")
GUARD_MODEL = os.getenv("LLAMA_GUARD_MODEL", "llama-guard3:8b")
GUARD_TIMEOUT_S = float(os.getenv("LLAMA_GUARD_TIMEOUT_S", "20.0"))


def _is_production() -> bool:
    return (
        os.getenv("ENVIRONMENT", "").lower() == "production"
        or os.getenv("NODE_ENV", "").lower() == "production"
    )


def _stub_mode_default() -> str:
    """Dev/test: '1' (stub on — service runs without Llama Guard 3 pulled).
    Production: '0' (stub off — a forgotten-to-wire deployment fails loudly
    rather than silently returning verdict='pass' on every prompt+response,
    which is the worst possible failure mode for a safety classifier)."""
    return "0" if _is_production() else "1"


STUB_MODE: bool = os.getenv("MODERATION_STUB_MODE", _stub_mode_default()) == "1"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info(
        "startup",
        service="output-moderation",
        stub_mode=STUB_MODE,
        guard_model=GUARD_MODEL,
        ollama_base_url=OLLAMA_BASE_URL,
        environment=os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "development",
    )
    if STUB_MODE and _is_production():
        log.warning(
            "stub_mode_active_in_production",
            service="output-moderation",
            message=(
                "MODERATION_STUB_MODE=1 in production. /moderate returns "
                "verdict='pass' for every prompt+response. Real safety "
                "classification is OFF. Wire Llama Guard 3 via Ollama or "
                "unset MODERATION_STUB_MODE."
            ),
        )
    yield
    log.info("shutdown", service="output-moderation")


app = FastAPI(
    title="clipstack/output-moderation",
    version="0.1.0",
    description="Llama Guard 3 baseline safety classifier. Doc 5 §1 P0.",
    lifespan=lifespan,
)


# ─── Schemas ───────────────────────────────────────────────────────────────

# Llama Guard 3 standard category list (model card 2024).
# Workspace can re-policy any category from block → flag → pass via config.
SafetyCategory = Literal[
    "S1_violent_crimes",
    "S2_non_violent_crimes",
    "S3_sex_related_crimes",
    "S4_child_sexual_exploitation",
    "S5_defamation",
    "S6_specialized_advice",            # legal / medical / financial without disclaimer
    "S7_privacy",                       # PII or sensitive personal info
    "S8_intellectual_property",
    "S9_indiscriminate_weapons",        # CBRN
    "S10_hate",
    "S11_suicide_self_harm",
    "S12_sexual_content",
    "S13_elections",                    # voting misinformation
    "S14_code_interpreter_abuse",
]

# What context is the text being moderated in?
# Llama Guard's prompt template differs slightly between user input and
# assistant output; we expose the distinction so callers don't reverse-engineer.
ModerationKind = Literal["user_input", "assistant_output"]

Verdict = Literal["pass", "flag", "block"]


class ModerateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=200_000)
    kind: ModerationKind = "assistant_output"
    # Optional preceding turn — Llama Guard rates the *current* turn given
    # the context of what came before.
    prior_user_turn: str | None = Field(
        None,
        description="Required for kind='assistant_output' to give the classifier context.",
    )
    # Workspace-level policy override: list of categories to demote from
    # block to flag, OR specific categories to escalate to block.
    # Empty = use defaults (S1–S4, S9, S10, S11 = block; rest = flag).
    block_categories: list[SafetyCategory] | None = None
    flag_categories: list[SafetyCategory] | None = None


class CategoryFinding(BaseModel):
    category: SafetyCategory
    rationale: str = ""           # populated when the underlying model emits one


class ModerateResponse(BaseModel):
    request_id: str
    verdict: Verdict
    findings: list[CategoryFinding]
    classifier: str               # e.g. "llama-guard3:8b" or "stub-0.1.0"
    skipped: bool = True


# ─── Policy + parsing ──────────────────────────────────────────────────────

# Default policy: which Llama Guard categories block by default.
# Per Doc 5 §1 P0 the unconditional floor is violent crime + sex crimes +
# CSAM + CBRN + hate + self-harm. Everything else flags for human review.
_DEFAULT_BLOCK: frozenset[SafetyCategory] = frozenset({
    "S1_violent_crimes",
    "S2_non_violent_crimes",
    "S3_sex_related_crimes",
    "S4_child_sexual_exploitation",
    "S9_indiscriminate_weapons",
    "S10_hate",
    "S11_suicide_self_harm",
})

# Llama Guard emits e.g. "S1,S5,S10". Map the bare codes to our enum.
_CODE_TO_CATEGORY: dict[str, SafetyCategory] = {
    "S1": "S1_violent_crimes",
    "S2": "S2_non_violent_crimes",
    "S3": "S3_sex_related_crimes",
    "S4": "S4_child_sexual_exploitation",
    "S5": "S5_defamation",
    "S6": "S6_specialized_advice",
    "S7": "S7_privacy",
    "S8": "S8_intellectual_property",
    "S9": "S9_indiscriminate_weapons",
    "S10": "S10_hate",
    "S11": "S11_suicide_self_harm",
    "S12": "S12_sexual_content",
    "S13": "S13_elections",
    "S14": "S14_code_interpreter_abuse",
}


def _parse_guard_output(raw: str) -> list[SafetyCategory]:
    """Parse Llama Guard 3's structured output.

    The model card prescribes:
      Line 1: `safe` or `unsafe`
      Line 2 (only if unsafe): comma-separated category codes, e.g. `S1,S10`

    We're permissive about whitespace + casing because Ollama occasionally
    appends a trailing newline and some Llama Guard variants emit lowercase.
    Unknown codes are silently dropped — better to under-classify than to
    surface a phantom category to callers.
    """
    lines = [ln.strip() for ln in raw.strip().splitlines() if ln.strip()]
    if not lines:
        return []
    if lines[0].lower() != "unsafe":
        return []
    if len(lines) < 2:
        # Model said unsafe but didn't emit categories — treat as a single
        # generic violent-crime hit. Conservative default; very rare.
        return ["S1_violent_crimes"]
    codes = [c.strip().upper() for c in lines[1].split(",") if c.strip()]
    return [_CODE_TO_CATEGORY[c] for c in codes if c in _CODE_TO_CATEGORY]


def _verdict_for(
    findings: list[SafetyCategory],
    block_override: list[SafetyCategory] | None,
    flag_override: list[SafetyCategory] | None,
) -> Verdict:
    """Apply workspace policy on top of Llama Guard's category list.

    Precedence:
      1. workspace block_override — these escalate to block
      2. workspace flag_override  — these demote to flag (overrides default block)
      3. _DEFAULT_BLOCK           — categories that block unless demoted
      4. otherwise                — flag

    Worst-case wins: if any finding triggers block, the verdict is block.
    """
    if not findings:
        return "pass"

    block_set = set(block_override or [])
    flag_set = set(flag_override or [])
    worst: Verdict = "pass"
    for cat in findings:
        if cat in block_set:
            return "block"  # explicit workspace block — short-circuit
        if cat in flag_set:
            verdict_for_cat: Verdict = "flag"
        elif cat in _DEFAULT_BLOCK:
            verdict_for_cat = "block"
        else:
            verdict_for_cat = "flag"

        if verdict_for_cat == "block":
            return "block"
        if verdict_for_cat == "flag" and worst == "pass":
            worst = "flag"
    return worst


# ─── Ollama call ───────────────────────────────────────────────────────────


async def _call_llama_guard(
    text: str,
    kind: ModerationKind,
    prior_user_turn: str | None,
) -> str:
    """POST to Ollama's /api/chat with Llama Guard 3.

    We don't hand-format Llama Guard's prompt template — Ollama applies it
    automatically when we use the /api/chat endpoint with a model that has
    a registered template (llama-guard3:8b does). All we do is set up the
    conversation so the *last* turn is the one being rated.

    For kind='user_input', the conversation is just [{user: text}].
    For kind='assistant_output', it's [{user: prior_user_turn or ''},
    {assistant: text}] — Llama Guard rates the assistant's turn given the
    user context.

    Returns the raw model output (e.g. "safe" or "unsafe\\nS1,S10").
    """
    if kind == "user_input":
        messages = [{"role": "user", "content": text}]
    else:
        messages = [
            {"role": "user", "content": prior_user_turn or ""},
            {"role": "assistant", "content": text},
        ]

    body = {
        "model": GUARD_MODEL,
        "messages": messages,
        "stream": False,
        # Deterministic — we want the same input to produce the same verdict
        # for caching + audit + reproducibility of moderation decisions.
        "options": {"temperature": 0.0, "num_predict": 32},
    }

    url = f"{OLLAMA_BASE_URL.rstrip('/')}/api/chat"

    try:
        async with httpx.AsyncClient(timeout=GUARD_TIMEOUT_S) as client:
            resp = await client.post(url, json=body)
    except httpx.HTTPError as e:
        # Don't fail-closed-as-pass on classifier outage. Per Doc 5 §1 P0
        # an outage on the safety floor is a system error, not a free pass.
        log.error("ollama.unreachable", url=url, error=str(e))
        raise HTTPException(
            status_code=503,
            detail=(
                f"Llama Guard 3 unreachable at {url}. Is the Ollama container "
                f"up and has `{GUARD_MODEL}` been pulled? "
                "(`docker compose exec ollama ollama pull llama-guard3:8b`)"
            ),
        ) from e

    if resp.status_code == 404:
        # Ollama returns 404 when the model isn't pulled. Distinguish that
        # from "Ollama is down" so the operator knows what to fix.
        raise HTTPException(
            status_code=503,
            detail=(
                f"Llama Guard 3 model `{GUARD_MODEL}` not found on Ollama. "
                f"Run: `docker compose exec ollama ollama pull {GUARD_MODEL}`"
            ),
        )
    if resp.status_code != 200:
        log.error(
            "ollama.bad_status",
            status=resp.status_code,
            body=resp.text[:500],
        )
        raise HTTPException(
            status_code=502,
            detail=f"Ollama returned status {resp.status_code} from /api/chat",
        )

    payload = resp.json()
    msg = payload.get("message") or {}
    content = msg.get("content") or ""
    if not isinstance(content, str):
        log.error("ollama.unexpected_shape", payload=payload)
        raise HTTPException(status_code=502, detail="Ollama response missing message.content")
    return content


# ─── Endpoints ─────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "output-moderation", "version": "0.1.0"}


@app.post("/moderate", response_model=ModerateResponse)
async def moderate(req: ModerateRequest) -> ModerateResponse:
    """Run a baseline-safety classifier over the text."""
    request_id = str(uuid4())
    log.info(
        "moderation.scan",
        request_id=request_id,
        text_len=len(req.text),
        kind=req.kind,
    )

    if STUB_MODE:
        return ModerateResponse(
            request_id=request_id,
            verdict="pass",
            findings=[],
            classifier="stub-0.1.0",
            skipped=True,
        )

    raw = await _call_llama_guard(req.text, req.kind, req.prior_user_turn)
    categories = _parse_guard_output(raw)
    verdict = _verdict_for(categories, req.block_categories, req.flag_categories)

    log.info(
        "moderation.scanned",
        request_id=request_id,
        verdict=verdict,
        category_count=len(categories),
        guard_model=GUARD_MODEL,
    )

    return ModerateResponse(
        request_id=request_id,
        verdict=verdict,
        findings=[CategoryFinding(category=c) for c in categories],
        classifier=GUARD_MODEL,
        skipped=False,
    )
