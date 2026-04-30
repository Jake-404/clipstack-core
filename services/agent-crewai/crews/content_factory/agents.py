"""The seven roles of the Content Factory crew (Doc 1 §7.1 + Doc 5 §1.6).

Each agent gets a LiteLLM-routed model, a focused tool set, and a
goal/backstory tuned to its function in the pipeline. Brand voice and
editorial-memory tools are wired in A.2 — Phase A.0/A.1 wires the no-op
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
from tools.brand_safety_check import brand_safety_check_tool
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


def make_devils_advocate_qa() -> Agent:
    """Adversarial reader. Doc 5 §1.6.

    Catches the failure mode that claim-verification misses: the draft's
    factual claims are all sourced and verifiable, but the implications drawn
    from them are weak, misleading, or contradict a previously-captured lesson.
    Runs above claim verification — its findings feed into BrandQA's gate.

    LLM is JUDGE_MODEL (separate vendor from the writer) so the same biases
    that produced the draft don't whitewash it on review.
    """
    return Agent(
        role="DevilsAdvocateQA",
        goal=(
            "Read every draft adversarially. For each, surface (a) claims that "
            "are technically true but imply something the source does not "
            "support; (b) framings a hostile reader would call misleading; "
            "(c) any contradiction with `forever`-scoped lessons captured by "
            "this team. Score `harm_risk` 0–1 and emit a structured verdict."
        ),
        backstory=(
            "You're the team's hostile-reviewer-in-residence. You don't write "
            "and you don't strategise. You find the words that boomerang — "
            "the sentence that reads fine and lands wrong, the citation that "
            "implies more than the source proves, the framing the audience "
            "calls slanted. Most production failures are correctly-cited "
            "claims that mean something the writer didn't intend."
        ),
        tools=[recall_lessons_tool],
        llm=_judge(),
        allow_delegation=False,
        verbose=False,
    )


def make_brand_qa() -> Agent:
    """The voice-fingerprint + brand-safety critic. USP 3 + plan open-Q #3.
    Phase A.0/A.1 ships the role; `voice_score` and `brand_safety_check`
    real backends land in A.2 (SetFit corpus + regex/LLM scanner)."""
    return Agent(
        role="BrandQA",
        goal=(
            "Validate every adapted draft against (a) the brand voice corpus "
            "via `voice_score`, (b) factual claim provenance via `claim_verifier`, "
            "(c) brand-safety + active regulatory regimes via `brand_safety_check`, "
            "and (d) workspace lessons via `recall_lessons`. Block any draft "
            "below the voice threshold OR with an unverified claim OR with a "
            "brand-safety finding of severity='block' OR contradicting a "
            "captured `forever`-scoped lesson."
        ),
        backstory=(
            "You're the last reviewer before a piece goes to a human approver. "
            "You don't write. You don't strategise. You catch what shouldn't ship — "
            "off-voice copy, drifted citations, regulated claims missing their "
            "disclosure block, blocklisted terms, lessons this team has already "
            "learned the hard way."
        ),
        tools=[
            voice_score_tool,
            claim_verifier_tool,
            brand_safety_check_tool,
            recall_lessons_tool,
        ],
        llm=_judge(),
        allow_delegation=False,
        verbose=False,
    )
