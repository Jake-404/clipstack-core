"""claim_verifier — USP 8 content provenance.

Re-fetches every cited URL in a draft, snippet-matches the cited text, and
flags any claim whose source no longer supports it (link rot, edited page,
hallucinated quote). Calls services/provenance.

Phase A.0 stub: returns all-verified.
"""

from __future__ import annotations

from crewai.tools import BaseTool
from pydantic import BaseModel, Field


class Claim(BaseModel):
    statement: str
    supporting_url: str
    snippet: str | None = None


class ClaimVerifierInput(BaseModel):
    claims: list[Claim] = Field(..., min_length=1)


class _ClaimVerifierTool(BaseTool):
    name: str = "claim_verifier"
    description: str = (
        "Re-fetch every cited URL and verify the cited text still appears at "
        "the source. Returns per-claim verdict (verified | drift | dead-link)."
    )
    args_schema: type[BaseModel] = ClaimVerifierInput

    def _run(  # type: ignore[override]
        self,
        claims: list[dict],
    ) -> list[dict]:
        # Phase A.0 stub. Wired in B (USP 8).
        return [{"statement": c["statement"], "verdict": "verified-stub"} for c in claims]


claim_verifier_tool = _ClaimVerifierTool()
