"""ChatAdapter — conversational support / community channels.

Per Doc 6 §14.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Literal, TypedDict

ThreadStatus = Literal["open", "pending", "resolved", "spam"]
AuthorKind = Literal["customer", "agent", "bot"]


class ChatThread(TypedDict, total=False):
    id: str
    channel: str
    status: ThreadStatus
    customer_id: str
    assignee_id: str
    last_message_at: str
    unread_count: int


class Attachment(TypedDict, total=False):
    url: str
    content_type: str
    filename: str


class ChatMessage(TypedDict, total=False):
    id: str
    thread_id: str
    author_id: str
    author_kind: AuthorKind
    body: str
    attachments: list[Attachment]
    created_at: str


class MessageListResult(TypedDict, total=False):
    messages: list[ChatMessage]
    next_cursor: str


class ChatAdapter(ABC):
    vendor: str
    workspace_id: str

    @abstractmethod
    async def list_threads(
        self,
        *,
        status: ThreadStatus | None = None,
        assignee_id: str | None = None,
        limit: int | None = None,
    ) -> list[ChatThread]: ...

    @abstractmethod
    async def get_thread(self, thread_id: str) -> ChatThread | None: ...

    @abstractmethod
    async def list_messages(
        self,
        thread_id: str,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> MessageListResult: ...

    @abstractmethod
    async def reply(
        self,
        thread_id: str,
        body: str,
        *,
        is_private_note: bool = False,
    ) -> str: ...

    @abstractmethod
    async def set_status(self, thread_id: str, status: ThreadStatus) -> None: ...

    @abstractmethod
    async def assign(self, thread_id: str, assignee_id: str) -> None: ...

    @abstractmethod
    async def health_check(self) -> dict[str, object]: ...
