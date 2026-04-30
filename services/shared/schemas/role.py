"""Role schema — Python mirror of role.ts."""

from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

DEFAULT_ROLE_SLUGS: tuple[str, ...] = ("owner", "admin", "member", "client_guest")
_SLUG_RE = re.compile(r"^[a-z0-9_]+$")


class Role(BaseModel):
    id: str
    company_id: str
    slug: str = Field(..., min_length=1, max_length=60)
    display_name: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    is_default: bool = False
    created_at: datetime

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not _SLUG_RE.match(v):
            raise ValueError("slug must match ^[a-z0-9_]+$")
        return v


class RoleCreate(BaseModel):
    company_id: str
    slug: str = Field(..., min_length=1, max_length=60)
    display_name: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        if not _SLUG_RE.match(v):
            raise ValueError("slug must match ^[a-z0-9_]+$")
        return v
