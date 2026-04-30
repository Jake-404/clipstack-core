"""Approval schema — Python mirror of approval.ts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ApprovalKind = Literal[
    "draft_publish",
    "engagement_reply",
    "campaign_launch",
    "agent_replacement",
    "reactive_trend",
    "skill_install",
    "voice_corpus_add",
    "metered_spend_unlock",
]

ApprovalStatus = Literal["pending", "approved", "denied", "expired", "revoked"]
DenyScope = Literal["forever", "this_topic", "this_client"]


class Approval(BaseModel):
    id: str
    company_id: str
    client_id: str | None = None
    kind: ApprovalKind
    status: ApprovalStatus = "pending"
    payload: dict[str, object]
    created_by_agent_id: str | None = None
    created_at: datetime
    decided_by_user_id: str | None = None
    decided_at: datetime | None = None
    deny_rationale: str | None = Field(default=None, min_length=20, max_length=2000)
    deny_scope: DenyScope | None = None
    expires_at: datetime | None = None


class DenyRequest(BaseModel):
    rationale: str = Field(..., min_length=20, max_length=2000)
    scope: DenyScope
