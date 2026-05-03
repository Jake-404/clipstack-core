"""trend_detector — single-agent toolbelt crew.

Pattern follows Doc 1 §7.2 (social_listener): one capable agent with a
strong toolbelt rather than a multi-role pipeline. The agent reasons about
relevance + velocity + whitespace in one pass, then drafts a contextual
response if the trend clears the workspace's threshold.

Hard rule: every reactive draft must pass `brand_safety_check` BEFORE an
approval row is created — covers the "agent picks up a tragedy / off-brand
moment" failure mode. Trend dismissal writes the keywords into the
workspace's `dismissedTrendKeywords` so the next scan pre-filters.
"""

from __future__ import annotations

from crewai import LLM, Agent, Crew, Process, Task

from models import CLASSIFIER_MODEL, JUDGE_MODEL, llm_kwargs
from tools.brand_safety_check import brand_safety_check_tool
from tools.hashtag_intel import hashtag_intel_tool
from tools.pay_and_fetch import pay_and_fetch_tool
from tools.recall_lessons import recall_lessons_tool


def _classifier() -> LLM:
    return LLM(**llm_kwargs(CLASSIFIER_MODEL))


def _judge() -> LLM:
    return LLM(**llm_kwargs(JUDGE_MODEL))


def make_trend_scanner() -> Agent:
    return Agent(
        role="TrendScanner",
        goal=(
            "Scan platform trend streams for signals that match active "
            "campaign keywords. Score each candidate trend on relevance × "
            "velocity × competitive whitespace. Apply the workspace's "
            "dismissedTrendKeywords pre-filter before scoring. For trends "
            "above threshold, draft a contextual response and run it through "
            "`brand_safety_check` BEFORE creating an approval row. Hard rule: "
            "reactive content never auto-publishes."
        ),
        backstory=(
            "You watch the live edge of platform conversation. Most trends "
            "aren't worth the team's attention — they're either too far from "
            "the workspace's brand or too saturated to add value. The few that "
            "matter need fast turnaround: time from emergence to drafted "
            "response is the load-bearing metric. You're paid to be picky and "
            "fast at the same time."
        ),
        tools=[
            pay_and_fetch_tool,        # premium feeds (Google Trends, news APIs)
            hashtag_intel_tool,        # workspace-historical hashtag mapping
            recall_lessons_tool,       # past dismissed trends + lessons
            brand_safety_check_tool,   # mandatory pre-publish gate
        ],
        llm=_classifier(),
        allow_delegation=False,
        verbose=False,
    )


def task_scan_and_draft(scanner: Agent, *, topic_keywords: list[str]) -> Task:
    return Task(
        description=(
            f"Scan trend streams filtered by these workspace keywords: "
            f"{topic_keywords}.\n\n"
            "1. Pull current candidates via `pay_and_fetch` against configured "
            "   feeds (X trending, Reddit hot, Google Trends rising).\n"
            "2. For each candidate: score relevance to active campaigns × "
            "   velocity (mention rate / sec at observation) × competitive "
            "   whitespace (presence of established angle from incumbents).\n"
            "3. Recall lessons via `recall_lessons` with scope='this_topic' "
            "   to surface any dismissed-trend keywords. Pre-filter matches.\n"
            "4. For trends above threshold, draft a contextual response.\n"
            "5. Run `brand_safety_check` on each draft. Only PASS drafts feed "
            "   into the approval queue. BLOCK drafts log + dismiss the trend."
        ),
        agent=scanner,
        expected_output=(
            "Per-trend record: trend_topic, relevance_score, velocity, "
            "competitive_whitespace, draft_text (if generated), "
            "brand_safety_verdict, suggested action."
        ),
    )


def build_trend_detector_crew(
    *,
    company_id: str,
    topic_keywords: list[str] | None = None,
) -> Crew:
    """Assemble the trend-detector crew. Phase A.3 stub: builds without
    kicking off. Real cadence (continuous polling) wires when the
    EVENTBUS_ENABLED + Redpanda producer ship in a follow-up slice.
    """
    scanner = make_trend_scanner()
    t_scan = task_scan_and_draft(scanner, topic_keywords=topic_keywords or [])

    crew = Crew(
        agents=[scanner],
        tasks=[t_scan],
        process=Process.sequential,
        verbose=False,
        memory=False,
    )    # NOTE: Langfuse tag wiring removed — see content_factory/crew.py.
    _ = _judge  # imported for future devil's-advocate-pair extension
    return crew
