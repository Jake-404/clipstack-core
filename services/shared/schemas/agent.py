"""Agent schema — Python mirror of agent.ts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

AgentRole = Literal[
    "orchestrator",
    "researcher",
    "strategist",
    "long_form_writer",
    "social_adapter",
    "newsletter_adapter",
    "brand_qa",
    "devils_advocate_qa",
    "engagement",
    "lifecycle",
    "trend_detector",
    "algorithm_probe",
    "live_event_monitor",
    "claim_verifier",
    "compliance",
]

AgentStatus = Literal["idle", "working", "blocked", "asleep", "fired"]


class Agent(BaseModel):
    id: str
    company_id: str
    role: AgentRole
    display_name: str = Field(..., min_length=1, max_length=60)
    job_description: str = Field(..., min_length=1, max_length=2000)
    status: AgentStatus = "idle"
    model_profile: str = "WRITER_MODEL"
    tools_allowed: list[str] = Field(default_factory=list)
    spawned_at: datetime
    retired_at: datetime | None = None
