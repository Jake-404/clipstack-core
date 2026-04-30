"""Company schema — Python mirror of company.ts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

CompanyType = Literal["agency", "client", "in_house", "solo"]
UiMode = Literal["web2", "web3"]


class Company(BaseModel):
    id: str
    name: str = Field(..., min_length=1, max_length=120)
    type: CompanyType
    parent_company_id: str | None = None
    ui_mode: UiMode = "web2"
    brand_kit_id: str | None = None
    active_regimes: list[str] = Field(default_factory=list)
    context_json: dict[str, object] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class CompanyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    type: CompanyType
    parent_company_id: str | None = None
    ui_mode: UiMode = "web2"
