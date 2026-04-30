"""Audit schema — Python mirror of audit.ts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

AuditActorKind = Literal["user", "agent", "system"]

AuditEventKind = Literal[
    "company.created",
    "company.updated",
    "agent.spawned",
    "agent.fired",
    "approval.created",
    "approval.approved",
    "approval.denied",
    "lesson.recorded",
    "draft.published",
    "draft.scheduled",
    "metered.debited",
    "compliance.blocked",
    "voice.scored",
    "trend.dismissed",
    "skill.installed",
    "x402.outbound_paid",
    "x402.inbound_charged",
]


class AuditLogRow(BaseModel):
    id: str
    company_id: str
    client_id: str | None = None
    kind: AuditEventKind
    actor_kind: AuditActorKind
    actor_id: str | None = None
    details_json: dict[str, object] = Field(default_factory=dict)
    commitment_hash: str | None = None
    trace_id: str | None = None
    occurred_at: datetime
