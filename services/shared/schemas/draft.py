"""Draft schema — Python mirror of draft.ts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

DraftStatus = Literal[
    "drafting",
    "in_review",
    "awaiting_approval",
    "approved",
    "scheduled",
    "published",
    "denied",
    "archived",
]

Channel = Literal["x", "linkedin", "reddit", "tiktok", "instagram", "newsletter", "blog"]


class Claim(BaseModel):
    statement: str = Field(..., min_length=1)
    supporting_url: str | None = None
    snippet: str | None = None
    retrieved_at: datetime | None = None


class Draft(BaseModel):
    id: str
    company_id: str
    client_id: str | None = None
    parent_draft_id: str | None = None
    channel: Channel
    status: DraftStatus = "drafting"
    title: str | None = Field(default=None, max_length=300)
    body: str
    hashtags: list[str] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)
    voice_score: float | None = Field(default=None, ge=0.0, le=1.0)
    predicted_percentile: float | None = Field(default=None, ge=0.0, le=100.0)
    authored_by_agent_id: str | None = None
    approval_id: str | None = None
    scheduled_at: datetime | None = None
    published_at: datetime | None = None
    published_url: str | None = None
    created_at: datetime
    updated_at: datetime
