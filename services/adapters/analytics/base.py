"""AnalyticsAdapter — read-only access to per-workspace analytics events.

Per Doc 6 §14 + Doc 4 §2.2 (post_metrics ingestion).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Literal, TypedDict

GroupBy = Literal["day", "hour", "week", "url", "referrer", "campaign"]


class AnalyticsEvent(TypedDict, total=False):
    event_name: str
    url: str
    occurred_at: str
    visitor_id: str
    session_id: str
    properties: dict[str, str | int | float | bool | None]


class MetricPoint(TypedDict):
    at: str
    value: float


class MetricSeries(TypedDict, total=False):
    metric: str
    unit: str
    points: list[MetricPoint]


class AnalyticsQuery(TypedDict, total=False):
    metric: str
    start_at: str
    end_at: str
    group_by: GroupBy
    filters: dict[str, str | list[str]]
    limit: int


class EventListResult(TypedDict, total=False):
    events: list[AnalyticsEvent]
    next_cursor: str


class AnalyticsAdapter(ABC):
    vendor: str
    workspace_id: str

    @abstractmethod
    async def get_metric(self, query: AnalyticsQuery) -> MetricSeries: ...

    @abstractmethod
    async def list_events(
        self,
        *,
        since: str,
        until: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> EventListResult: ...

    @abstractmethod
    async def health_check(self) -> dict[str, object]: ...
