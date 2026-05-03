"""content_factory crew — agents instantiate, tools attach, tasks ordered.

Verifies the assembled crew's structure matches Doc 1 §7.1 + Phase B (USP 8)
without invoking any LiteLLM call. CrewAI's `Agent` constructor builds the
tool registry and validates llm kwargs at instantiation, so a broken
agents.py / tools/* import surface gets caught here before runtime.
"""

from __future__ import annotations

from crews.content_factory.agents import (
    make_brand_qa,
    make_claim_verifier,
    make_devils_advocate_qa,
    make_long_form_writer,
    make_newsletter_adapter,
    make_researcher,
    make_social_adapter,
    make_strategist,
)
from crews.content_factory.crew import build_content_factory_crew


def _has_role_goal_backstory(agent: object) -> None:
    role = getattr(agent, "role", None)
    goal = getattr(agent, "goal", None)
    backstory = getattr(agent, "backstory", None)
    assert isinstance(role, str)
    assert role.strip()
    assert isinstance(goal, str)
    assert goal.strip()
    assert isinstance(backstory, str)
    assert backstory.strip()


def test_all_eight_agents_instantiate_with_role_goal_backstory() -> None:
    """All 8 roles in the Phase B roster construct + carry non-empty fields."""
    factories = [
        make_researcher,
        make_strategist,
        make_long_form_writer,
        make_newsletter_adapter,
        make_devils_advocate_qa,
        make_claim_verifier,
        make_brand_qa,
    ]
    for factory in factories:
        agent = factory()
        _has_role_goal_backstory(agent)

    # SocialAdapter is per-platform. Spot-check one platform.
    social = make_social_adapter("linkedin")
    _has_role_goal_backstory(social)
    assert "linkedin" in social.role.lower()


def test_strategist_has_expected_five_tools() -> None:
    """Strategist must carry the five tools the editorial brief depends on:
    retrieve_high_performers, recall_lessons, recent_anomalies, hashtag_intel,
    register_bandit. recent_anomalies is the most recent (post-A.3) addition."""
    strategist = make_strategist()
    tool_names = {getattr(t, "name", None) for t in strategist.tools}
    expected = {
        "retrieve_high_performers",
        "recall_lessons",
        "recent_anomalies",
        "hashtag_intel",
        "register_bandit",
    }
    assert expected.issubset(tool_names), (
        f"Strategist tools missing: expected {expected}, got {tool_names}"
    )
    # No surprise extras either — keeps the surface tight.
    assert tool_names == expected
    # Explicit assertion for the most recent addition.
    assert "recent_anomalies" in tool_names


def test_researcher_has_research_tools() -> None:
    researcher = make_researcher()
    tool_names = {getattr(t, "name", None) for t in researcher.tools}
    # Researcher uses pay_and_fetch + asset_search per agents.py.
    assert "pay_and_fetch" in tool_names
    assert "asset_search" in tool_names


def test_claim_verifier_has_claim_verifier_tool() -> None:
    cv = make_claim_verifier()
    tool_names = {getattr(t, "name", None) for t in cv.tools}
    assert "claim_verifier" in tool_names
    assert "recall_lessons" in tool_names


def test_brand_qa_has_voice_safety_lessons_tools() -> None:
    qa = make_brand_qa()
    tool_names = {getattr(t, "name", None) for t in qa.tools}
    # Phase B narrowed BrandQA to voice + safety + lessons.
    assert "voice_score" in tool_names
    assert "brand_safety_check" in tool_names
    assert "recall_lessons" in tool_names


def test_devils_advocate_qa_has_recall_lessons() -> None:
    devils = make_devils_advocate_qa()
    tool_names = {getattr(t, "name", None) for t in devils.tools}
    assert "recall_lessons" in tool_names


def test_build_content_factory_crew_constructs() -> None:
    """End-to-end: build_content_factory_crew assembles a Crew object."""
    crew = build_content_factory_crew(
        company_id="c_test", platforms=["x", "linkedin"]
    )
    # Sanity: the crew has agents + tasks attached.
    assert hasattr(crew, "agents")
    assert hasattr(crew, "tasks")
    assert len(crew.agents) >= 8  # 7 fixed + 2 social adapters when 2 platforms


def test_build_content_factory_crew_rejects_unknown_platform() -> None:
    import pytest

    with pytest.raises(ValueError, match="unknown platforms"):
        build_content_factory_crew(company_id="c", platforms=["myspace"])


def test_build_content_factory_crew_rejects_variants_out_of_range() -> None:
    import pytest

    with pytest.raises(ValueError, match="variants_per_platform"):
        build_content_factory_crew(
            company_id="c", platforms=["x"], variants_per_platform=6
        )
    with pytest.raises(ValueError, match="variants_per_platform"):
        build_content_factory_crew(
            company_id="c", platforms=["x"], variants_per_platform=0
        )


def test_task_list_ordered_research_strategy_long_form_socials_newsletter_critics() -> None:
    """Task order anchors the sequential pipeline contract:
    research → strategise → long_form → social_adapt(s) → newsletter
    → devils_advocate → claim_verifier → brand_qa.
    """
    crew = build_content_factory_crew(
        company_id="c_test", platforms=["x", "linkedin"]
    )
    task_descriptions = [t.description for t in crew.tasks]

    # research is first (mentions "Source type:" template)
    assert "Source type:" in task_descriptions[0]

    # strategise is second (mentions retrieve_high_performers)
    assert "retrieve_high_performers" in task_descriptions[1]

    # long-form is third (mentions canonical long-form)
    assert "long-form" in task_descriptions[2].lower()

    # The trailing three critics, in order: devils → claim → brand_qa.
    # Identify by distinctive phrases each task uses.
    last_three = task_descriptions[-3:]
    assert any("adversarial" in d.lower() for d in [last_three[0]])  # devils
    assert any("claim_verifier" in d for d in [last_three[1]])  # claim
    # brand_qa reads BOTH prior verdicts.
    assert "DevilsAdvocateQA" in last_three[2]
    assert "ClaimVerifier" in last_three[2]


# NOTE: removed test_crew_metadata_carries_crew_id_and_company_id —
# the underlying `crew.metadata = {...}` assignment was removed from
# crew.py because recent CrewAI / Pydantic tightening rejects extra
# attrs at runtime. Langfuse tag wiring now flows via crew.kickoff
# inputs at call time. When the new tagging surface lands, add a
# replacement test here.
