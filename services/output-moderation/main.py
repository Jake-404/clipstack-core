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

Backend (Phase A.2): Llama Guard 3 (8B) served by the Ollama container in
docker-compose.yml. Ollama is already up; this service routes the prompt,
parses the structured Llama Guard output, and returns a workspace-friendly
verdict shape.

Phase A.1 ships the FastAPI shell with stub responses — every request
returns verdict='pass' so the call sites can wire without breaking.

Mounted at port 8004. Health check is consumed by docker-compose.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal
from uuid import uuid4

import structlog
from fastapi import FastAPI
from pydantic import BaseModel, Field

log = structlog.get_logger()

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434")
GUARD_MODEL = os.getenv("LLAMA_GUARD_MODEL", "llama-guard3:8b")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info("startup", service="output-moderation", guard_model=GUARD_MODEL)
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


# ─── Endpoints ─────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "output-moderation", "version": "0.1.0"}


@app.post("/moderate", response_model=ModerateResponse)
async def moderate(req: ModerateRequest) -> ModerateResponse:
    """Run a baseline-safety classifier over the text.

    Phase A.1 stub: returns verdict='pass' for every request. A.2 swaps in
    the Llama Guard 3 backend hosted by Ollama.
    """
    request_id = str(uuid4())
    log.info(
        "moderation.scan",
        request_id=request_id,
        text_len=len(req.text),
        kind=req.kind,
    )

    if os.getenv("MODERATION_STUB_MODE", "1") == "1":
        return ModerateResponse(
            request_id=request_id,
            verdict="pass",
            findings=[],
            classifier="stub-0.1.0",
            skipped=True,
        )

    # A.2: call Ollama at OLLAMA_BASE_URL with GUARD_MODEL, parse the
    # "safe / unsafe + S<n>" structured response, apply workspace policy
    # overrides to compute the verdict.
    raise NotImplementedError("Llama Guard backend wired in A.2")
