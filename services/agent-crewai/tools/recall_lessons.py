"""recall_lessons — USP 5 editorial memory recall.

Cosine-ranked semantic search over `company_lessons.embedding` (pgvector
since 0007). Filters by `scope` (forever | this_topic | this_client).
Top-K injected into agent system prompts under the "What this team has
learned" block (`buildSystemPrompt()`).

Sprint-close: stub → real HTTP call. When APPROVAL_UI_BASE_URL +
SERVICE_TOKEN env vars are set, POSTs to the approval-ui's
/api/companies/{cid}/lessons/recall route which:
  1. Embeds the topic via LiteLLM voice-embed (all-minilm, 384-dim)
  2. Cosine-queries company_lessons via pgvector ivfflat
  3. Returns top-K with similarity scores

Without env wiring, falls back to empty list (matches the existing pattern
on retrieve_high_performers + voice_score). Crew constructs cleanly in dev
without the API live.
"""

from __future__ import annotations

import os
from typing import Literal

import httpx
import structlog
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

log = structlog.get_logger()

API_BASE_URL = os.getenv("APPROVAL_UI_BASE_URL")
SERVICE_TOKEN = os.getenv("SERVICE_TOKEN")
SERVICE_NAME = "agent-crewai"

Scope = Literal["forever", "this_topic", "this_client"]


class RecallLessonsInput(BaseModel):
    company_id: str
    topic: str = Field(..., description="Free-text topic for the embedding query.")
    client_id: str | None = None
    k: int = Field(5, ge=1, le=20)
    scope: Scope | None = None


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
        if not (API_BASE_URL and SERVICE_TOKEN):
            log.debug(
                "recall_lessons.fallback_stub",
                reason="APPROVAL_UI_BASE_URL or SERVICE_TOKEN not set",
            )
            return []

        url = f"{API_BASE_URL.rstrip('/')}/api/companies/{company_id}/lessons/recall"
        body: dict[str, object] = {"topic": topic, "k": k}
        if scope:
            body["scope"] = scope
        if client_id:
            body["clientId"] = client_id

        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.post(
                    url,
                    json=body,
                    headers={
                        "X-Clipstack-Service-Token": SERVICE_TOKEN,
                        "X-Clipstack-Active-Company": company_id,
                        "X-Clipstack-Service-Name": SERVICE_NAME,
                    },
                )
        except (httpx.HTTPError, OSError) as e:
            log.warning("recall_lessons.http_error", error=str(e), url=url)
            return []

        if resp.status_code != 200:
            log.warning(
                "recall_lessons.bad_status",
                status=resp.status_code,
                body=resp.text[:200],
            )
            return []

        data = resp.json()
        if not isinstance(data, dict) or not data.get("ok"):
            return []
        lessons = data.get("data", {}).get("lessons", [])
        return list(lessons) if isinstance(lessons, list) else []


recall_lessons_tool = _RecallLessonsTool()
