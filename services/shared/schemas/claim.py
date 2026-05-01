"""Claim schema — Python mirror of claim.ts. USP 8 provenance."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

ClaimVerifierStatus = Literal[
    "pending",
    "verified",
    "drift",
    "dead_link",
    "unsupported",
    "paywalled",
    "rate_limited",
]


class ContentClaim(BaseModel):
    id: str
    company_id: str
    client_id: str | None = None
    draft_id: str
    statement: str = Field(..., min_length=1, max_length=4000)
    supporting_url: HttpUrl | None = None
    snippet: str | None = None
    snippet_hash: str | None = None
    verifier_status: ClaimVerifierStatus = "pending"
    verifier_score: float | None = Field(default=None, ge=0.0, le=1.0)
    verifier_last_run_at: datetime | None = None
    verifier_details_json: dict[str, object] = Field(default_factory=dict)
    retrieved_at: datetime | None = None
    authored_by_agent_id: str | None = None
    created_at: datetime
    updated_at: datetime


class ContentClaimCreate(BaseModel):
    company_id: str
    client_id: str | None = None
    draft_id: str
    statement: str = Field(..., min_length=1, max_length=4000)
    supporting_url: HttpUrl | None = None
    snippet: str | None = None
    retrieved_at: datetime | None = None
    authored_by_agent_id: str | None = None


class VerifierRunResult(BaseModel):
    claim_id: str
    status: ClaimVerifierStatus
    score: float | None = Field(default=None, ge=0.0, le=1.0)
    rationale: str = Field(..., min_length=1, max_length=2000)
    details: dict[str, object] = Field(default_factory=dict)
    ran_at: datetime


class VerifyClaimsRequest(BaseModel):
    claim_ids: list[str] | None = Field(default=None, max_length=200)
    force: bool = False


class VerifyClaimsResponse(BaseModel):
    draft_id: str
    claim_count: int = Field(..., ge=0)
    by_status: dict[str, int]
    results: list[VerifierRunResult]
