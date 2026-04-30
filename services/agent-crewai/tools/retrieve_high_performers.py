"""retrieve_high_performers — USP 1 closed-loop performance learning.

Returns past content from this workspace that scored in the top quartile by
the configured engagement KPI (CTR / engagement-rate / conversion). Cosine-
ranked against the topic embedding so the strategist + long-form writer can
ground in *what worked*, not generic best-practices.

Phase A.0 stub: empty list. Real impl = `post_metrics` join `content_embeddings`
with percentile filter, in Postgres.
"""

from __future__ import annotations

from typing import Literal

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

Kpi = Literal["ctr", "engagement_rate", "conversion", "reach"]


class RetrieveHighPerformersInput(BaseModel):
    company_id: str
    topic: str
    platform: str | None = Field(None, description="Filter to one platform.")
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
        platform: str | None = None,
        client_id: str | None = None,
        kpi: Kpi = "engagement_rate",
        percentile: int = 75,
        k: int = 3,
    ) -> list[dict]:
        # Phase A.0 stub. Wired in A.2 (USP 1 closed-loop).
        return []


retrieve_high_performers_tool = _RetrieveHighPerformersTool()
