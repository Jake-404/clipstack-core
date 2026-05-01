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


def task_devils_advocate(qa: Agent, context: list[Task]) -> Task:
    """Adversarial review pass. Runs above BrandQA — its verdict feeds in.

    Output is structured so BrandQA can ingest it without re-reading every
    draft. Per-draft fields:
      - harm_risk          : float 0..1
      - weak_implications  : [{sentence, why_weak}]
      - framing_issues     : [{sentence, why_misleading}]
      - lessons_contradicted: [{lesson_id, how_contradicted}]
      - verdict            : 'pass' | 'revise' | 'block'
    """
    return Task(
        description=(
            "For each adapted draft (long-form, every per-platform reshape, "
            "and the newsletter), do an adversarial read.\n\n"
            "Use `recall_lessons` with `scope='forever'` for the company to "
            "surface guardrails this team has captured. Then for each draft, "
            "identify:\n"
            "  - claims that are technically true but imply something the "
            "    source does not support\n"
            "  - framings a hostile reader would call misleading or slanted\n"
            "  - sentences that contradict any recalled `forever` lesson\n\n"
            "Score the draft's `harm_risk` from 0 (no concerns) to 1 (do not "
            "ship). Emit verdict: 'pass' (harm_risk < 0.3 and no contradictions), "
            "'revise' (issues fixable inline), or 'block' (structural problem)."
        ),
        agent=qa,
        context=context,
        expected_output=(
            "Per-draft adversarial review (JSON) with harm_risk, "
            "weak_implications, framing_issues, lessons_contradicted, verdict."
        ),
    )


def task_claim_verifier(verifier: Agent, context: list[Task]) -> Task:
    """USP 8 — citation re-fetch + snippet match. Runs after the adapters
    so it sees the final shape of every claim that would ship; runs before
    BrandQA so the voice-and-safety gate sees per-claim verdicts in context.
    """
    return Task(
        description=(
            "For every cited claim across the long-form draft + all per-"
            "platform reshapes + the newsletter:\n\n"
            "1. Run `claim_verifier` on the (statement, supporting_url, "
            "   snippet) tuple. The tool re-fetches the URL, snippet-matches "
            "   against current page text, and returns one of: verified | "
            "   drift | dead_link | unsupported | paywalled | rate_limited.\n"
            "2. For ambiguous results (drift score 0.4–0.7), use your own "
            "   judgment: is the source still supporting the literal sense "
            "   of the claim, or has the page edit changed what the source "
            "   says? Mark accordingly.\n"
            "3. Recall workspace lessons via `recall_lessons` for previously "
            "   captured drift patterns on these sources.\n"
            "4. Emit one structured per-claim verdict. Any non-verified claim "
            "   is a hard block downstream — surface revision instructions "
            "   (replace source / rephrase to match snippet / drop claim)."
        ),
        agent=verifier,
        context=context,
        expected_output=(
            "Per-claim verdict (JSON): claim_id, statement, supporting_url, "
            "verifier_status, verifier_score, rationale, revision_action."
        ),
    )


def task_brand_qa(qa: Agent, context: list[Task]) -> Task:
    return Task(
        description=(
            "Read the DevilsAdvocateQA verdict + ClaimVerifier verdicts from "
            "the prior tasks FIRST. Any draft DevilsAdvocate marked 'block' "
            "fails immediately. Any non-verified claim from ClaimVerifier "
            "is a hard block on the draft that contains it.\n\n"
            "Then run the three-tool pass on every adapted draft:\n"
            "  1. `voice_score`         — vs. workspace brand corpus\n"
            "  2. `brand_safety_check`  — profanity / blocklist / competitor / "
            "     regulated-claim shapes for active regimes; `severity='block'` "
            "     fails the draft, `disclosure_required` adds a disclosure block\n"
            "  3. `recall_lessons`      — workspace history of corrections\n\n"
            "Final verdict per draft: PASS (DevilsAdvocate cleared, all "
            "ClaimVerifier verdicts = verified, voice above threshold, no "
            "brand-safety blocks, no lesson contradictions), REVISE (fixable "
            "with concrete instructions including any required disclosure "
            "blocks), or BLOCK."
        ),
        agent=qa,
        context=context,
        expected_output=(
            "Verdict (PASS|REVISE|BLOCK) per draft + voice_score + "
            "brand_safety findings + required disclosures + ClaimVerifier "
            "passthrough + DevilsAdvocate harm_risk passthrough + revision notes."
        ),
    )
