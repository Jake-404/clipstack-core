"""recall_lessons — USP 5 editorial memory recall.

Cosine-ranked semantic search over `company_lessons.embedding` (pgvector or
Qdrant). Filters by `scope` (forever | this_topic | this_client) and ranks
by recency × similarity. Top-K injected into agent system prompts under
the "What this team has learned" block (`buildSystemPrompt()`).

Phase A.0 stub: returns an empty list. Real implementation is a thin client
over services/shared schemas + a pgvector / Qdrant query.
"""

from __future__ import annotations

from typing import Literal

from crewai.tools import BaseTool
from pydantic import BaseModel, Field


Scope = Literal["forever", "this_topic", "this_client"]


class RecallLessonsInput(BaseModel):
    company_id: str
    topic: str = Field(..., description="Free-text topic for the embedding query.")
    client_id: str | None = None
    k: int = Field(5, ge=1, le=20)
    scope: Scope | None = None


class Lesson(BaseModel):
    id: str
    rationale: str
    scope: Scope
    captured_at: str  # ISO-8601


class _RecallLessonsTool(BaseTool):
    name: str = "recall_lessons"
    description: str = (
        "Recall the top-K editorial lessons captured by this team that touch "
        "the given topic. Use before drafting to anchor in the company's "
        "history of corrections."
    )
    args_schema: type[BaseModel] = RecallLessonsInput

    def _run(  # type: ignore[override]
        self,
        company_id: str,
        topic: str,
        client_id: str | None = None,
        k: int = 5,
        scope: Scope | None = None,
    ) -> list[dict]:
        # Phase A.0 stub.
        # TODO(A.0): wire to services/shared lessons.recall via HTTP or direct DB.
        return []


recall_lessons_tool = _RecallLessonsTool()
