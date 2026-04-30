"""asset_search — search the workspace's brand-kit asset library.

Used by the Researcher to surface logos, hero images, screenshots already
in the brand kit so we don't regenerate art that already exists. Cosine
similarity over asset captions + metadata in Qdrant.

Phase A.0 stub: empty list.
"""

from __future__ import annotations

from crewai.tools import BaseTool
from pydantic import BaseModel, Field


class AssetSearchInput(BaseModel):
    company_id: str
    query: str = Field(..., description="Free-text description of the asset wanted.")
    asset_kind: str | None = Field(None, description="image | video | logo | screenshot")
    client_id: str | None = None
    k: int = Field(5, ge=1, le=20)


class _AssetSearchTool(BaseTool):
    name: str = "asset_search"
    description: str = (
        "Search this workspace's existing brand-kit asset library before "
        "generating new art. Returns matched assets with URLs and metadata."
    )
    args_schema: type[BaseModel] = AssetSearchInput

    def _run(  # type: ignore[override]
        self,
        company_id: str,
        query: str,
        asset_kind: str | None = None,
        client_id: str | None = None,
        k: int = 5,
    ) -> list[dict]:
        return []


asset_search_tool = _AssetSearchTool()
