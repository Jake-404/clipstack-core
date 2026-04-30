"""hashtag_intel — per-platform tag/keyword recommendations.

Reads from services/performance-ingest's per-platform hashtag table (Doc 4
§2.6 AlgorithmProbe). Returns trending tags + workspace-historical-best tags
for the given topic and platform.

Phase A.0 stub: returns empty list.
"""

from __future__ import annotations

from crewai.tools import BaseTool
from pydantic import BaseModel, Field


class HashtagIntelInput(BaseModel):
    platform: str = Field(..., pattern="^(x|linkedin|reddit|tiktok|instagram)$")
    topic: str
    company_id: str
    k: int = Field(5, ge=1, le=15)


class _HashtagIntelTool(BaseTool):
    name: str = "hashtag_intel"
    description: str = (
        "Recommend hashtags for a topic on a specific platform, blending "
        "current-trending data with this workspace's historical-best tags."
    )
    args_schema: type[BaseModel] = HashtagIntelInput

    def _run(  # type: ignore[override]
        self,
        platform: str,
        topic: str,
        company_id: str,
        k: int = 5,
    ) -> list[str]:
        return []


hashtag_intel_tool = _HashtagIntelTool()
