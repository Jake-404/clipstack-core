"""retrieve_high_performers — USP 1 closed-loop performance learning.

Returns past content from this workspace that scored in the top quartile by
the configured engagement KPI (CTR / engagement-rate / conversion-rate). The
agent uses these to anchor strategy + voice in what's actually worked here,
not generic best-practices.

A.2 wiring: when APPROVAL_UI_BASE_URL + SERVICE_TOKEN are set, the tool calls
GET /api/companies/{cid}/drafts/high-performers. Without those, the tool
falls back to an empty list (the stub behavior from A.0). This means the
crew constructs cleanly in environments without the API live, and lights up
automatically when the service token is provisioned.

Topic-vector ranking is reserved for a later slice once the embedding
service ships; A.2 ranks by absolute KPI value within the percentile filter.
"""

from __future__ import annotations

import os
from typing import Literal

import httpx
import structlog
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

log = structlog.get_logger()

Kpi = Literal["ctr", "engagement_rate", "conversion_rate"]
Platform = Literal["x", "linkedin", "reddit", "tiktok", "instagram", "newsletter", "blog"]

API_BASE_URL = os.getenv("APPROVAL_UI_BASE_URL")
SERVICE_TOKEN = os.getenv("SERVICE_TOKEN")
SERVICE_NAME = "agent-crewai"


class RetrieveHighPerformersInput(BaseModel):
    company_id: str
    topic: str
    platform: Platform | None = Field(None, description="Filter to one platform.")
    client_id: str | None = None
    kpi: Kpi = "engagement_rate"
    percentile: int = Field(75, ge=50, le=99)
    k: int = Field(3, ge=1, le=10)


class _RetrieveHighPerformersTool(BaseTool):
    name: str = "retrieve_high_performers"
    description: str = (
        "Surface past pieces from this workspace that scored in the top "
        "percentile on the given KPI for this topic. Use to anchor strategy "
        "and voice in what's worked here before."
    )
    args_schema: type[BaseModel] = RetrieveHighPerformersInput

    def _run(  # type: ignore[override]
        self,
        company_id: str,
        topic: str,
        platform: Platform | None = None,
        client_id: str | None = None,  # noqa: ARG002 — reserved for sub-client filtering A.3
        kpi: Kpi = "engagement_rate",
        percentile: int = 75,
        k: int = 3,
    ) -> list[dict]:
        if not (API_BASE_URL and SERVICE_TOKEN):
            log.debug(
                "retrieve_high_performers.fallback_stub",
                reason="APPROVAL_UI_BASE_URL or SERVICE_TOKEN not set",
            )
            return []

        url = f"{API_BASE_URL.rstrip('/')}/api/companies/{company_id}/drafts/high-performers"
        params: dict[str, str | int] = {"kpi": kpi, "percentile": percentile, "k": k}
        if platform:
            params["platform"] = platform
        if topic:
            params["topic"] = topic

        try:
            with httpx.Client(timeout=5.0) as client:
                resp = client.get(
                    url,
                    params=params,
                    headers={
                        "X-Clipstack-Service-Token": SERVICE_TOKEN,
                        "X-Clipstack-Active-Company": company_id,
                        "X-Clipstack-Service-Name": SERVICE_NAME,
                    },
                )
        except (httpx.HTTPError, OSError) as e:
            log.warning("retrieve_high_performers.http_error", error=str(e), url=url)
            return []

        if resp.status_code != 200:
            log.warning(
                "retrieve_high_performers.bad_status",
                status=resp.status_code,
                body=resp.text[:200],
            )
            return []

        data = resp.json()
        if not isinstance(data, dict) or not data.get("ok"):
            return []
        results = data.get("data", {}).get("results", [])
        return list(results) if isinstance(results, list) else []


retrieve_high_performers_tool = _RetrieveHighPerformersTool()
