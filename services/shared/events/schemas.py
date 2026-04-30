"""Per-topic payload schemas — Python mirrors of schemas.ts. Doc 4 §2.1.

Versioning rule: when a payload shape needs to change, add v2 alongside v1
and bump producer's `version` field. Consumers branch on `event.version`.
After 30-day deprecation, remove v1.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

# ─── content.published ─────────────────────────────────────────────────────

ChannelLiteral = Literal[
    "x", "linkedin", "reddit", "tiktok", "instagram", "newsletter", "blog"
]


class ContentPublishedPayload(BaseModel):
    draft_id: str
    channel: ChannelLiteral
    published_url: HttpUrl | None = None
    published_at: datetime
    campaign_id: str | None = None
    bandit_variant_id: str | None = None


# ─── content.metric_update ─────────────────────────────────────────────────


class ContentMetricUpdatePayload(BaseModel):
    draft_id: str
    platform: str
    metric: str = Field(..., min_length=1)
    value: float
    percentile: float | None = Field(default=None, ge=0.0, le=100.0)
    velocity: float | None = None
    snapshot_at: datetime


# ─── content.anomaly ───────────────────────────────────────────────────────


class ContentAnomalyPayload(BaseModel):
    draft_id: str
    platform: str
    anomaly_kind: str = Field(..., min_length=1)
    severity: float = Field(..., ge=0.0, le=1.0)
    metric: str | None = None
    detail: dict[str, object] = Field(default_factory=dict)
    detected_at: datetime


# ─── trend.detected ────────────────────────────────────────────────────────


class TrendDetectedPayload(BaseModel):
    topic: str = Field(..., min_length=1)
    summary: str = Field(..., min_length=1, max_length=500)
    velocity: float = Field(..., ge=0.0)
    platforms: list[str] = Field(..., min_length=1)
    confidence: float = Field(..., ge=0.0, le=1.0)
    relevance_score: float | None = Field(default=None, ge=0.0, le=1.0)
    ttl_seconds: int = Field(43_200, gt=0)


# ─── competitor.signal ─────────────────────────────────────────────────────


class CompetitorSignalPayload(BaseModel):
    entity: str = Field(..., min_length=1)
    action_kind: str = Field(..., min_length=1)
    content_hash: str | None = None
    content_url: HttpUrl | None = None
    estimated_percentile: float | None = Field(default=None, ge=0.0, le=100.0)
    observed_at: datetime


# ─── platform.algorithm_shift ──────────────────────────────────────────────

PlatformLiteral = Literal["x", "linkedin", "reddit", "tiktok", "instagram"]


class PlatformAlgorithmShiftPayload(BaseModel):
    platform: PlatformLiteral
    signal_kind: str = Field(..., min_length=1)
    confidence: float = Field(..., ge=0.0, le=1.0)
    magnitude: float
    observed_at: datetime
    new_algorithm_version: str | None = None


# ─── campaign.brief_updated ────────────────────────────────────────────────


class CampaignBriefUpdatedPayload(BaseModel):
    campaign_id: str
    brief_version: str
    diff_summary: str = Field(..., min_length=1, max_length=2000)
    triggered_by: str = Field(..., min_length=1)
    changed_fields: list[str] = Field(default_factory=list)
    updated_at: datetime


# ─── live_event.detected ───────────────────────────────────────────────────


class LiveEventDetectedPayload(BaseModel):
    event_kind: str = Field(..., min_length=1)
    headline: str = Field(..., min_length=1, max_length=500)
    source_url: HttpUrl | None = None
    severity: int = Field(..., ge=0, le=10)
    relevance_score: float = Field(..., ge=0.0, le=1.0)
    suggested_action: str | None = None
    detected_at: datetime


# ─── engagement.opportunity ────────────────────────────────────────────────


class EngagementOpportunityPayload(BaseModel):
    source_draft_id: str
    platform: str
    opportunity_kind: str = Field(..., min_length=1)
    external_interaction_id: str = Field(..., min_length=1)
    suggested_action: str | None = Field(default=None, max_length=2000)
    priority_score: float = Field(..., ge=0.0, le=1.0)
    sla_seconds: int = Field(300, gt=0)
    detected_at: datetime


# ─── Topic → schema lookup ────────────────────────────────────────────────

PAYLOAD_SCHEMAS: dict[str, type[BaseModel]] = {
    "content.published": ContentPublishedPayload,
    "content.metric_update": ContentMetricUpdatePayload,
    "content.anomaly": ContentAnomalyPayload,
    "trend.detected": TrendDetectedPayload,
    "competitor.signal": CompetitorSignalPayload,
    "platform.algorithm_shift": PlatformAlgorithmShiftPayload,
    "campaign.brief_updated": CampaignBriefUpdatedPayload,
    "live_event.detected": LiveEventDetectedPayload,
    "engagement.opportunity": EngagementOpportunityPayload,
}
