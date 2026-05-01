"""engagement — per-platform single-agent toolbelt crew.

One instance per platform per workspace (per Doc 4 §2.9). Same brand-voice
+ brand-safety gates as outbound: every reply passes voice_score +
brand_safety_check before reaching the approval queue.

Hard rule: engagement-driven follow-ups DO NOT auto-publish. Per Doc 4
acceptance criterion + plan §"Open Q #2": reply SLA is "<5 min surfaced
for human approval" with auto-publish only on whitelisted reply templates
per workspace.
"""

from __future__ import annotations

from crewai import LLM, Agent, Crew, Process, Task

from models import CLASSIFIER_MODEL, WRITER_MODEL, llm_kwargs
from tools.brand_safety_check import brand_safety_check_tool
from tools.recall_lessons import recall_lessons_tool
from tools.voice_score import voice_score_tool


def _classifier() -> LLM:
    return LLM(**llm_kwargs(CLASSIFIER_MODEL))


def _writer() -> LLM:
    return LLM(**llm_kwargs(WRITER_MODEL))


def make_engagement_agent(platform: str) -> Agent:
    return Agent(
        role=f"EngagementAgent_{platform}",
        goal=(
            f"For each inbound reaction on {platform} (reply, quote-tweet, "
            "thread-continuation candidate, community-moderation flag): "
            "triage into respond | ignore | escalate | moderate. For 'respond' "
            "items, draft a reply using the workspace's brand voice. Run "
            "voice_score + brand_safety_check before pushing to the approval "
            "queue. Surface high-value quote-tweets to humans for direct "
            "engagement."
        ),
        backstory=(
            f"You watch the {platform} reaction surface for active campaigns. "
            "Most replies are noise; a handful are signal — high-value "
            "quote-tweets, thread-continuation moments where a published post "
            "is going viral, community questions worth a thoughtful response. "
            "You triage fast, draft in voice, and never publish without a "
            "human approver. Speed and care, not just speed."
        ),
        tools=[
            voice_score_tool,
            brand_safety_check_tool,
            recall_lessons_tool,
        ],
        llm=_classifier(),  # triage is classification-heavy; promote to writer for drafting
        allow_delegation=False,
        verbose=False,
    )


def task_triage_and_draft(agent: Agent, *, platform: str) -> Task:
    return Task(
        description=(
            f"Process the latest reaction batch for {platform}.\n\n"
            "1. Classify each reaction into respond | ignore | escalate | "
            "   moderate based on:\n"
            "   - is it a question / objection / endorsement / spam / abuse?\n"
            "   - is the author worth engaging (verified, large following, "
            "     known customer, journalist)?\n"
            "   - does the parent post's velocity warrant thread-continuation?\n"
            "2. For 'respond' items, draft a brand-voice-consistent reply.\n"
            "3. Score the draft via `voice_score` (workspace threshold).\n"
            "4. Run `brand_safety_check` for active regulatory regimes.\n"
            "5. Drafts that PASS both gates feed into the approval queue.\n"
            "6. Drafts that BLOCK on brand-safety log + skip the approval row.\n"
            "7. 'escalate' items surface to a human directly without a draft."
        ),
        agent=agent,
        expected_output=(
            "Per-reaction record: triage_decision, draft_text (if respond), "
            "voice_score, brand_safety_verdict, parent_post_id, author_handle, "
            "next_action."
        ),
    )


def build_engagement_crew(*, company_id: str, platform: str) -> Crew:
    agent = make_engagement_agent(platform)
    t_triage = task_triage_and_draft(agent, platform=platform)
    crew = Crew(
        agents=[agent],
        tasks=[t_triage],
        process=Process.sequential,
        verbose=False,
        memory=False,
    )
    crew.metadata = {  # type: ignore[attr-defined]
        "crew_id": "engagement",
        "company_id": company_id,
        "platform": platform,
    }
    _ = _writer  # imported for the draft-promotion path that lands when
    # auto-publish-on-whitelisted-reply-templates ships (post-A.3)
    return crew
