"""pay_and_fetch — USP-C1 per-call x402 procurement.

Wraps a single outbound HTTP call that may be paywalled by an x402-compatible
endpoint. The agent buys access per request rather than via subscription —
50-source competitor scans become economical at fractions of a cent.

Behind the feature flag `CRYPTO_ENABLED` (Phase 5.1). Disabled today: the
tool returns a notice that the workspace doesn't have crypto-mode enabled.
"""

from __future__ import annotations

import os

from crewai.tools import BaseTool
from pydantic import BaseModel, Field


class PayAndFetchInput(BaseModel):
    url: str = Field(..., description="The URL to fetch.")
    method: str = Field("GET", pattern="^(GET|POST)$")
    max_cost_usd: float = Field(0.10, ge=0.0, le=10.0)
    body: dict | None = None


class _PayAndFetchTool(BaseTool):
    name: str = "pay_and_fetch"
    description: str = (
        "Fetch a URL that may require x402 micropayment. Use for premium "
        "data sources (news APIs, analytics endpoints, journalist databases) "
        "that charge per request. Bound to the workspace's max_cost_usd cap."
    )
    args_schema: type[BaseModel] = PayAndFetchInput

    def _run(  # type: ignore[override]
        self,
        url: str,
        method: str = "GET",
        max_cost_usd: float = 0.10,
        body: dict | None = None,
    ) -> dict:
        if os.getenv("CRYPTO_ENABLED", "false").lower() != "true":
            return {
                "ok": False,
                "reason": "CRYPTO_ENABLED=false on this workspace; x402 outbound disabled.",
                "url": url,
            }
        # Phase 5.1: wire to services/crypto/x402 outbound facilitator.
        return {"ok": False, "reason": "x402 client not implemented yet (Phase 5.1).", "url": url}


pay_and_fetch_tool = _PayAndFetchTool()
