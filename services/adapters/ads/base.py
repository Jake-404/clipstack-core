"""AdsAdapter — paid-channel campaign management.

Per Doc 6 §14. Wraps Meta / Google / TikTok / Pipeboard managed.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Literal, TypedDict

AdPlatform = Literal["google", "meta", "tiktok", "linkedin", "x"]
CampaignStatus = Literal["draft", "scheduled", "live", "paused", "archived"]
Objective = Literal["awareness", "traffic", "engagement", "conversion", "lead"]
Format = Literal["image", "video", "carousel", "text"]


class Campaign(TypedDict, total=False):
    id: str
    platform: AdPlatform
    name: str
    status: CampaignStatus
    budget_usd_daily: float
    budget_usd_lifetime: float
    start_at: str
    end_at: str
    objective: Objective
    targeting: dict[str, object]


class AdCreative(TypedDict, total=False):
    id: str
    campaign_id: str
    format: Format
    headline: str
    body: str
    cta: str
    destination_url: str
    asset_urls: list[str]


class AdMetric(TypedDict, total=False):
    campaign_id: str
    date: str
    impressions: int
    clicks: int
    spend_usd: float
    conversions: int
    cpc: float
    cpm: float


class AdsAdapter(ABC):
    vendor: str
    workspace_id: str

    @abstractmethod
    async def list_campaigns(
        self,
        *,
        platform: AdPlatform | None = None,
        status: CampaignStatus | None = None,
    ) -> list[Campaign]: ...

    @abstractmethod
    async def get_campaign(self, campaign_id: str) -> Campaign | None: ...

    @abstractmethod
    async def create_campaign(self, c: Campaign) -> str: ...

    @abstractmethod
    async def pause_campaign(self, campaign_id: str) -> None: ...

    @abstractmethod
    async def resume_campaign(self, campaign_id: str) -> None: ...

    @abstractmethod
    async def update_budget(self, campaign_id: str, daily_usd: float) -> None: ...

    @abstractmethod
    async def list_creatives(self, campaign_id: str) -> list[AdCreative]: ...

    @abstractmethod
    async def add_creative(self, creative: AdCreative) -> str: ...

    @abstractmethod
    async def metrics(
        self,
        *,
        campaign_ids: list[str],
        start_at: str,
        end_at: str,
    ) -> list[AdMetric]: ...

    @abstractmethod
    async def health_check(self) -> dict[str, object]: ...
