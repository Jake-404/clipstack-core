"""CMSAdapter — abstract contract every headless-CMS concrete implements.

Per Doc 6 §14. Mirror of services/adapters/cms/base.ts.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Literal, TypedDict

ResourceKind = Literal["post", "page", "asset", "snippet", "redirect"]
Status = Literal["draft", "scheduled", "published", "archived"]


class CmsResource(TypedDict, total=False):
    id: str
    kind: ResourceKind
    slug: str
    title: str
    body: str
    status: Status
    published_at: str
    scheduled_at: str
    author_id: str
    tags: list[str]
    metadata: dict[str, object]


class CmsListQuery(TypedDict, total=False):
    kind: ResourceKind
    status: Status
    tag: str
    search: str
    cursor: str
    limit: int


class CmsListResult(TypedDict, total=False):
    items: list[CmsResource]
    next_cursor: str


class AssetUpload(TypedDict):
    filename: str
    bytes: bytes
    content_type: str


class CMSAdapter(ABC):
    vendor: str
    workspace_id: str

    @abstractmethod
    async def list(self, query: CmsListQuery | None = None) -> CmsListResult: ...

    @abstractmethod
    async def get(self, resource_id: str) -> CmsResource | None: ...

    @abstractmethod
    async def create(self, resource: CmsResource) -> str: ...

    @abstractmethod
    async def update(self, resource_id: str, patch: CmsResource) -> None: ...

    @abstractmethod
    async def publish(self, resource_id: str, publish_at: str | None = None) -> None: ...

    @abstractmethod
    async def unpublish(self, resource_id: str) -> None: ...

    @abstractmethod
    async def upload_asset(self, file: AssetUpload) -> dict[str, str]:
        """Returns {'id': ..., 'url': ...}."""

    @abstractmethod
    async def health_check(self) -> dict[str, object]: ...
