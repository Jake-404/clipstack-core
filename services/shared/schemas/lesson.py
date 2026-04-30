"""Lesson schema — Python mirror of lesson.ts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

LessonScope = Literal["forever", "this_topic", "this_client"]
LessonKind = Literal["human_denied", "critic_blocked", "policy_rule"]


class Lesson(BaseModel):
    id: str
    company_id: str
    client_id: str | None = None
    kind: LessonKind
    scope: LessonScope
    rationale: str = Field(..., min_length=20, max_length=2000)
    topic_tags: list[str] = Field(default_factory=list)
    embedding: list[float] | None = None
    captured_by_user_id: str | None = None
    captured_by_agent_id: str | None = None
    captured_at: datetime


class LessonCreate(BaseModel):
    company_id: str
    client_id: str | None = None
    kind: LessonKind
    scope: LessonScope
    rationale: str = Field(..., min_length=20, max_length=2000)
    topic_tags: list[str] = Field(default_factory=list)
    captured_by_user_id: str | None = None
    captured_by_agent_id: str | None = None
