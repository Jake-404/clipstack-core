"""EmailAdapter — newsletter sends + transactional email.

Per Doc 6 §14.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Literal, TypedDict

CampaignStatus = Literal["draft", "scheduled", "sending", "sent", "paused", "failed"]


class EmailList(TypedDict, total=False):
    id: str
    name: str
    subscriber_count: int
    tags: list[str]


class EmailCampaign(TypedDict, total=False):
    id: str
    name: str
    status: CampaignStatus
    subject_line: str
    from_name: str
    from_email: str
    body_html: str
    body_text: str
    scheduled_at: str
    sent_at: str
    list_id: str


class EmailMetric(TypedDict, total=False):
    campaign_id: str
    sent: int
    opens: int
    clicks: int
    bounces: int
    unsubscribes: int
    spam_complaints: int


class TransactionalSend(TypedDict, total=False):
    to: str | list[str]
    subject: str
    body_html: str
    body_text: str
    from_name: str
    from_email: str
    metadata: dict[str, str]


class EmailAdapter(ABC):
    vendor: str
    workspace_id: str

    @abstractmethod
    async def list_lists(self) -> list[EmailList]: ...

    @abstractmethod
    async def list_campaigns(
        self,
        *,
        status: CampaignStatus | None = None,
        limit: int | None = None,
    ) -> list[EmailCampaign]: ...

    @abstractmethod
    async def get_campaign(self, campaign_id: str) -> EmailCampaign | None: ...

    @abstractmethod
    async def create_campaign(self, c: EmailCampaign) -> str: ...

    @abstractmethod
    async def schedule(self, campaign_id: str, send_at: str) -> None: ...

    @abstractmethod
    async def send_now(self, campaign_id: str) -> None: ...

    @abstractmethod
    async def pause(self, campaign_id: str) -> None: ...

    @abstractmethod
    async def metrics(self, campaign_id: str) -> EmailMetric: ...

    @abstractmethod
    async def send_transactional(self, opts: TransactionalSend) -> dict[str, str]:
        """Returns {'message_id': ...}."""

    @abstractmethod
    async def health_check(self) -> dict[str, object]: ...
