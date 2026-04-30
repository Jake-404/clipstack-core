"""SEOAdapter — keyword research + site / page audits.

Per Doc 6 §14.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Literal, TypedDict

Intent = Literal["informational", "navigational", "commercial", "transactional"]
Severity = Literal["critical", "warning", "notice"]
IssueCategory = Literal["performance", "indexability", "content", "schema", "links"]


class KeywordMetrics(TypedDict, total=False):
    keyword: str
    search_volume: int
    difficulty: float  # 0..100
    cpc_usd: float
    intent: Intent
    trend: list[float]


class BacklinkRow(TypedDict, total=False):
    source_url: str
    target_url: str
    anchor_text: str
    domain_rating: float
    first_seen_at: str


class SiteAuditIssue(TypedDict, total=False):
    url: str
    severity: Severity
    category: IssueCategory
    title: str
    description: str


class SEOAdapter(ABC):
    vendor: str
    workspace_id: str

    @abstractmethod
    async def keyword_metrics(
        self,
        keywords: list[str],
        *,
        country: str | None = None,
    ) -> list[KeywordMetrics]: ...

    @abstractmethod
    async def related_keywords(
        self,
        seed: str,
        *,
        limit: int | None = None,
        country: str | None = None,
    ) -> list[KeywordMetrics]: ...

    @abstractmethod
    async def backlinks(
        self,
        domain: str,
        *,
        limit: int | None = None,
    ) -> list[BacklinkRow]: ...

    @abstractmethod
    async def audit_site(
        self,
        domain: str,
        *,
        max_urls: int | None = None,
    ) -> dict[str, str]:
        """Returns {'job_id': ...}."""

    @abstractmethod
    async def get_audit_issues(self, job_id: str) -> list[SiteAuditIssue] | None: ...

    @abstractmethod
    async def health_check(self) -> dict[str, object]: ...
