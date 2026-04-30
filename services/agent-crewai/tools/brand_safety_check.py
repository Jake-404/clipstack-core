"""brand_safety_check — pre-publish brand-safety + regulatory critic.

Two-layer scanner:
  1. Deterministic regex pass — catches profanity, workspace-configured
     prohibited terms, competitor disparagement patterns, client blocklists.
     Cheap, fast, runs first.
  2. LLM-judged pass — catches what regex can't: regulated-claim shapes
     (financial / health / legal) where the *implication* is the violation,
     not the literal phrase. Uses CLASSIFIER_MODEL (cheap-tier) for cost.

Per plan §"Open questions" #3: build in-house regex+LLM rather than vendor.
Plan §"Comprehensive upgrade" locks this as the prerequisite for the
trend-watcher in A.3 — every reactive draft passes through here before
the approval row is created.

Findings are structured so callers (BrandQA, future trend-watcher, future
publish_pipeline gate) can route on `severity` + `category` without re-parsing.

Phase A.1 stub: returns empty findings list. Real scanner lands in A.2:
  - regex layer: services/brand-safety/regex.py loading patterns from
    signals/regulatory/<active_regime>/patterns.yaml
  - LLM layer: services/brand-safety/llm.py using CLASSIFIER_MODEL with a
    prompt that emits structured per-category verdicts
"""

from __future__ import annotations

from typing import Literal

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

Category = Literal[
    "profanity",
    "competitor_disparagement",
    "prohibited_term",          # per-workspace blocklist
    "regulated_claim_health",   # FDA / EMA / TGA shape
    "regulated_claim_financial",  # FCA / MiCA / SEC shape
    "regulated_claim_legal",    # unauthorised legal advice
    "pii_present",              # crosswalk to Presidio when wired
]

Severity = Literal["block", "warn", "disclosure_required"]


class BrandSafetyCheckInput(BaseModel):
    company_id: str
    draft: str = Field(..., min_length=1)
    client_id: str | None = None
    # Active regulatory regimes for this workspace — comes from
    # `companies.activeRegimes` (per Phase C compliance-pack architecture).
    # Empty array = no regulated-claim shapes are checked.
    active_regimes: list[str] = Field(
        default_factory=list,
        description="e.g. ['mica', 'fca'] — only these regimes' rules apply.",
    )
    # When true, also runs the LLM layer. Disabled in stub mode (A.1).
    use_llm_layer: bool = True


class Finding(BaseModel):
    category: Category
    severity: Severity
    matched_text: str
    rationale: str
    # Where in the draft (character offsets) — null when LLM-layer-detected
    # without span attribution.
    start: int | None = None
    end: int | None = None
    # The rule id from signals/regulatory/<regime>/patterns.yaml when the
    # finding originated there; null for workspace blocklist hits.
    rule_id: str | None = None


class BrandSafetyResult(BaseModel):
    passes: bool                  # false if any finding has severity='block'
    findings: list[Finding]
    requires_disclosure: list[str]  # disclosure-block IDs to inject
    # When the LLM layer was skipped (use_llm_layer=False or stub mode).
    llm_layer_skipped: bool


class _BrandSafetyCheckTool(BaseTool):
    name: str = "brand_safety_check"
    description: str = (
        "Run a brand-safety + regulatory pass over a draft. Catches profanity, "
        "competitor disparagement, prohibited terms (per workspace blocklist), "
        "and regulated-claim shapes for any active regimes (MiCA / FCA / FDA). "
        "Returns structured findings; severity='block' means do not ship."
    )
    args_schema: type[BaseModel] = BrandSafetyCheckInput

    def _run(  # type: ignore[override]
        self,
        company_id: str,
        draft: str,
        client_id: str | None = None,
        active_regimes: list[str] | None = None,
        use_llm_layer: bool = True,
    ) -> dict:
        # Phase A.1 stub. Implementation lands A.2 with the regex layer
        # (services/brand-safety/regex.py) + LLM layer (CLASSIFIER_MODEL).
        # Real signal-pack rules load from signals/regulatory/<regime>/patterns.yaml
        # via the loader in services/compliance-pack/.
        return BrandSafetyResult(
            passes=True,
            findings=[],
            requires_disclosure=[],
            llm_layer_skipped=True,
        ).model_dump()


brand_safety_check_tool = _BrandSafetyCheckTool()
