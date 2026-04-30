"""The six roles of the Content Factory crew (Doc 1 §7.1).

Each agent gets a LiteLLM-routed model, a focused tool set, and a
goal/backstory tuned to its function in the pipeline. Brand voice and
editorial-memory tools are wired in A.2 — Phase A.0 wires the no-op
tool stubs from `tools/` so the crew constructs cleanly.
"""

from __future__ import annotations

from crewai import LLM, Agent

from models import (
    CLASSIFIER_MODEL,
    JUDGE_MODEL,
    WRITER_MODEL,
    llm_kwargs,
)
from tools.asset_search import asset_search_tool
from tools.claim_verifier import claim_verifier_tool
from tools.hashtag_intel import hashtag_intel_tool
from tools.pay_and_fetch import pay_and_fetch_tool
from tools.recall_lessons import recall_lessons_tool
from tools.retrieve_high_performers import retrieve_high_performers_tool
from tools.voice_score import voice_score_tool


def _writer() -> LLM:
    return LLM(**llm_kwargs(WRITER_MODEL))


def _classifier() -> LLM:
    return LLM(**llm_kwargs(CLASSIFIER_MODEL))


def _judge() -> LLM:
    return LLM(**llm_kwargs(JUDGE_MODEL))


def make_researcher() -> Agent:
    return Agent(
        role="Researcher",
        goal=(
            "Extract every load-bearing claim, statistic, quote, and supporting "
            "URL from the source. Hand a clean fact-sheet to the strategist; "
            "never invent."
        ),
        backstory=(
            "You're the team's evidence-gatherer. Marketing copy that ships with "
            "an unverified statistic is a brand-safety incident. Your job is to "
            "make sure every later draft can cite its sources."
        ),
        tools=[pay_and_fetch_tool, asset_search_tool],
        llm=_classifier(),
        allow_delegation=False,
        verbose=False,
    )


def make_strategist() -> Agent:
    return Agent(
        role="Strategist",
        goal=(
            "Choose the angle, the audience, and the primary CTA. Anchor the "
            "decision in past high-performers via `retrieve_high_performers` "
            "and recall any company lessons that touch this topic."
        ),
        backstory=(
            "You're the team's editor-in-chief. You don't write — you decide "
            "what gets written and why. Your decisions are auditable: every "
            "angle traces back to a piece of evidence or a captured lesson."
        ),
        tools=[retrieve_high_performers_tool, recall_lessons_tool, hashtag_intel_tool],
        llm=_writer(),
        allow_delegation=False,
        verbose=False,
    )


def make_long_form_writer() -> Agent:
    return Agent(
        role="LongFormWriter",
        goal=(
            "Draft a structured long-form piece that answers the strategist's "
            "brief. Hit voice. Cite claims inline. Keep brand-safety hard rules "
            "in mind from the start."
        ),
        backstory=(
            "You write the canonical version of the piece. Social and "
            "newsletter adapters reshape your output for their channels."
        ),
        tools=[recall_lessons_tool, retrieve_high_performers_tool],
        llm=_writer(),
        allow_delegation=False,
        verbose=False,
    )


def make_social_adapter(platform: str) -> Agent:
    return Agent(
        role=f"SocialAdapter_{platform}",
        goal=(
            f"Reshape the long-form draft for {platform}. Match the platform's "
            "native cadence, length, and hashtag conventions. Don't lose the "
            "claim citations — pull through the strongest 1–2."
        ),
        backstory=(
            f"You ship to {platform} every day. You know what the algorithm "
            "rewards, what readers skim past, and where citations earn trust "
            "vs where they read as friction."
        ),
        tools=[hashtag_intel_tool, recall_lessons_tool],
        llm=_writer(),
        allow_delegation=False,
        verbose=False,
    )


def make_newsletter_adapter() -> Agent:
    return Agent(
        role="NewsletterAdapter",
        goal=(
            "Write the newsletter blurb: 2–3 short paragraphs, one CTA, and a "
            "subject line that earns the open. No fluff."
        ),
        backstory=(
            "You write for inboxes. The reader has 4 seconds to decide whether "
            "to keep reading. You make those seconds count."
        ),
        tools=[recall_lessons_tool],
        llm=_writer(),
        allow_delegation=False,
        verbose=False,
    )


def make_brand_qa() -> Agent:
    """The voice-fingerprint critic (USP 3). Phase A.0 ships the role; the
    SetFit-backed `voice_score` becomes a real call in A.2."""
    return Agent(
        role="BrandQA",
        goal=(
            "Validate every adapted draft against the brand voice corpus, the "
            "company's claim list, and the prohibited-terms list. Score with "
            "`voice_score`; verify factual claims with `claim_verifier`. Block "
            "any draft below the workspace voice-score threshold."
        ),
        backstory=(
            "You're the last reviewer before a piece goes to a human approver. "
            "You don't write. You don't strategise. You catch what shouldn't ship."
        ),
        tools=[voice_score_tool, claim_verifier_tool, recall_lessons_tool],
        llm=_judge(),
        allow_delegation=False,
        verbose=False,
    )
