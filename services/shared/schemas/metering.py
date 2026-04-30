"""Metering schema — Python mirror of metering.ts. USP 10."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

MeterEventKind = Literal[
    "publish",
    "metered_asset_generation",
    "x402_outbound_call",
    "x402_inbound_call",
    "voice_score_query",
    "compliance_check",
]


class MeterEvent(BaseModel):
    id: str
    company_id: str
    client_id: str | None = None
    kind: MeterEventKind
    quantity: float = Field(..., ge=0.0)
    unit_cost_usd: float | None = Field(default=None, ge=0.0)
    total_cost_usd: float | None = Field(default=None, ge=0.0)
    ref_kind: str | None = None
    ref_id: str | None = None
    occurred_at: datetime
