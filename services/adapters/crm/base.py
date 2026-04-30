"""CRMAdapter — abstract contract every CRM concrete implements.

Per Doc 6 §14. Mirror of services/adapters/crm/base.ts.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Literal, TypedDict

ActivityKind = Literal[
    "email_sent",
    "email_opened",
    "email_replied",
    "call_logged",
    "meeting_booked",
    "form_submitted",
    "note_added",
    "tag_added",
    "tag_removed",
    "deal_stage_changed",
]


class Contact(TypedDict, total=False):
    id: str
    email: str
    first_name: str
    last_name: str
    phone: str
    company: str
    title: str
    tags: list[str]
    custom_fields: dict[str, str | int | float | bool | None]
    created_at: str  # ISO-8601
    updated_at: str


class Activity(TypedDict, total=False):
    kind: ActivityKind
    occurred_at: str
    body: str
    metadata: dict[str, object]


class ContactQuery(TypedDict, total=False):
    email: str
    external_id: str
    search: str
    limit: int


ErrorCode = Literal["rate_limited", "auth_failed", "not_found", "invalid", "unavailable"]


class AdapterError(TypedDict, total=False):
    code: ErrorCode
    message: str
    retry_after_seconds: int


class HealthResult(TypedDict, total=False):
    ok: bool
    error: AdapterError


class CRMAdapter(ABC):
    """Every CRM vendor implementation inherits this and implements every method."""

    vendor: str
    workspace_id: str

    @abstractmethod
    async def find_contact(self, query: ContactQuery) -> Contact | None:
        """Find a contact by email / external id / free-text. None if not found."""

    @abstractmethod
    async def upsert_contact(self, contact: Contact) -> str:
        """Create or upsert. Returns vendor-side id."""

    @abstractmethod
    async def log_activity(self, contact_id: str, activity: Activity) -> None:
        """Log an activity against an existing contact."""

    @abstractmethod
    async def add_tags(self, contact_id: str, tags: list[str]) -> None:
        """Add tags. Idempotent."""

    @abstractmethod
    async def remove_tags(self, contact_id: str, tags: list[str]) -> None:
        """Remove tags. Idempotent."""

    @abstractmethod
    async def health_check(self) -> HealthResult:
        """Health probe — used by the workspace settings page."""
