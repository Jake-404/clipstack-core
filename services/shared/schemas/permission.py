"""Permission schema — Python mirror of permission.ts."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

PermissionAction = Literal[
    "read",
    "create",
    "update",
    "delete",
    "approve",
    "deny",
    "publish",
    "invite",
    "revoke",
    "export",
    "admin",
]

STANDARD_RESOURCES: tuple[str, ...] = (
    "company",
    "user",
    "membership",
    "role",
    "permission",
    "agent",
    "lesson",
    "draft",
    "approval",
    "audit_log",
    "meter_event",
    "billing",
    "integration",
    "brand_kit",
    "campaign",
    "channel",
)

_RESOURCE_RE = re.compile(r"^[a-z0-9_]+$")


class Permission(BaseModel):
    id: str
    company_id: str
    role_id: str
    resource: str = Field(..., min_length=1, max_length=60)
    action: PermissionAction
    allow: bool = True
    client_id: str | None = None
    created_at: datetime

    @field_validator("resource")
    @classmethod
    def _resource_format(cls, v: str) -> str:
        if not _RESOURCE_RE.match(v):
            raise ValueError("resource must match ^[a-z0-9_]+$")
        return v


class PermissionCheckRequest(BaseModel):
    user_id: str
    company_id: str
    client_id: str | None = None
    resource: str = Field(..., min_length=1, max_length=60)
    action: PermissionAction

    @field_validator("resource")
    @classmethod
    def _resource_format(cls, v: str) -> str:
        if not _RESOURCE_RE.match(v):
            raise ValueError("resource must match ^[a-z0-9_]+$")
        return v


CheckReason = Literal[
    "matched_allow",
    "matched_deny",
    "no_matching_rule",
    "no_membership",
    "membership_revoked",
]


class PermissionCheckResponse(BaseModel):
    allowed: bool
    reason: CheckReason
    matched_permission_id: str | None = None
