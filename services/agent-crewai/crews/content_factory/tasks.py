"""Sequential tasks for the Content Factory crew (Doc 1 §7.1).

Pipeline: research → strategy → long-form → per-platform adapt + newsletter
in parallel → brand-QA gate. Output flows into a single approval-queue
record (Doc 1 §7.1 + Doc 7 §2.3 inbox 3-pane).
"""

from __future__ import annotations

from crewai import Agent, Task


def task_research(researcher: Agent, source_type: str, source_value: str) -> Task:
    return Task(
        description=(
            f"Source type: {source_type}\n"
            f"Source value: {source_value}\n\n"
            "Extract every claim, statistic, quote, and supporting URL. Return a "
            "structured fact-sheet:\n"
            "- claims: [{statement, supporting_url, retrieved_at}]\n"
            "- quotes: [{speaker, quote, context}]\n"
            "- statistics: [{metric, value, source_url, methodology}]\n"
            "- key_themes: [string]"
        ),
        agent=researcher,
        expected_output="Structured fact-sheet (JSON) with claims, quotes, statistics, themes.",
    )


def task_strategise(strategist: Agent, platforms: list[str], context: list[Task]) -> Task:
    return Task(
        description=(
            "Read the fact-sheet. Use `retrieve_high_performers` to surface 3 "
            "past pieces in this topic that performed in the top quartile. "
            "Use `recall_lessons` to surface any captured editorial lessons "
            "that apply.\n\n"
            f"Decide: angle, target audience, primary CTA, platforms to ship "
            f"({platforms}), 1-line hook for each platform.\n\n"
            "Output: editorial brief that the LongFormWriter can execute against."
        ),
        agent=strategist,
        context=context,
        expected_output="Editorial brief (markdown) with angle, audience, CTA, per-platform hooks.",
    )


def task_long_form(writer: Agent, context: list[Task]) -> Task:
    return Task(
        description=(
            "Draft the canonical long-form piece against the editorial brief. "
            "Cite every load-bearing claim inline using [n] markers. Keep voice "
            "consistent with the brand corpus (BrandQA will block off-voice "
            "drafts).\n\n"
            "Length: 600–1200 words unless the brief specifies otherwise."
        ),
        agent=writer,
        context=context,
        expected_output=(
            "Long-form draft (markdown) with inline citations [n] and a citations list."
        ),
    )


def task_social_adapt(adapter: Agent, platform: str, context: list[Task]) -> Task:
    return Task(
        description=(
            f"Reshape the long-form draft for {platform}. Native length, native "
            "cadence. Pull through the 1–2 strongest claims with citations. "
            "Use `hashtag_intel` to pick 3–5 hashtags."
        ),
        agent=adapter,
        context=context,
        expected_output=f"{platform} post (string) + suggested hashtags + 1-line preview.",
    )


def task_newsletter_adapt(adapter: Agent, context: list[Task]) -> Task:
    return Task(
        description=(
            "Write the newsletter version: subject line + 2–3 short paragraphs "
            "+ 1 CTA + 1 link to the long-form. Optimised for inbox skim."
        ),
        agent=adapter,
        context=context,
        expected_output="Newsletter (subject_line, body_markdown, cta_text, cta_url).",
    )


def task_brand_qa(qa: Agent, context: list[Task]) -> Task:
    return Task(
        description=(
            "Score every adapted draft against the brand voice corpus via "
            "`voice_score`. Verify every cited claim via `claim_verifier`. "
            "Recall lessons via `recall_lessons` to check the workspace's "
            "history of corrections.\n\n"
            "If any draft scores below threshold OR has an unverified claim "
            "OR violates a captured lesson, return a structured BLOCK verdict "
            "with revision instructions. Otherwise PASS."
        ),
        agent=qa,
        context=context,
        expected_output="Verdict (PASS|BLOCK) + per-draft scores + revision notes.",
    )
