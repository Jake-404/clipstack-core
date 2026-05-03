"""lifecycle — single-agent toolbelt crew.

Runs weekly per workspace. Reads `retrieve_high_performers` to identify
top-quartile pieces by KPI percentile + age cohort. Recommends repost /
repurpose / retire / boost decisions per artefact, each surfaced through
the approval queue (decisions are not auto-applied).
"""

from __future__ import annotations

from crewai import LLM, Agent, Crew, Process, Task

from models import JUDGE_MODEL, llm_kwargs
from tools.recall_lessons import recall_lessons_tool
from tools.retrieve_high_performers import retrieve_high_performers_tool


def _judge() -> LLM:
    return LLM(**llm_kwargs(JUDGE_MODEL))


def make_lifecycle_evaluator() -> Agent:
    return Agent(
        role="LifecycleEvaluator",
        goal=(
            "Each week, evaluate every artefact published in the last 90 days "
            "and propose one of four actions: REPOST (top performer at native "
            "cadence) / REPURPOSE (top performer worth a cross-format pass) / "
            "RETIRE (underperformer with no recovery signal) / BOOST (paid "
            "amplification for a winner). Every decision flows through the "
            "approval queue — never auto-applied."
        ),
        backstory=(
            "You're the team's editorial portfolio manager. You don't write — "
            "you decide what existing work deserves another life and what "
            "should quietly age out. The repurpose pipeline (thread → blog → "
            "video → meme) is your bread and butter; the retire decision is "
            "where you earn your keep. Most teams keep underperformers around "
            "out of sentiment; you don't."
        ),
        tools=[
            retrieve_high_performers_tool,
            recall_lessons_tool,
        ],
        llm=_judge(),
        allow_delegation=False,
        verbose=False,
    )


def task_evaluate_portfolio(evaluator: Agent) -> Task:
    return Task(
        description=(
            "Evaluate the workspace's published portfolio over the last 90 "
            "days.\n\n"
            "1. Use `retrieve_high_performers` to surface top-quartile "
            "   pieces per platform per KPI (engagement_rate primary, ctr + "
            "   conversion_rate secondary).\n"
            "2. For each top piece: recommend REPOST (if the cohort age + "
            "   audience freshness allow) or REPURPOSE (cross-format).\n"
            "3. For pieces with low percentile + low velocity + age > 30d: "
            "   recommend RETIRE.\n"
            "4. For top performers with non-saturated paid potential: "
            "   recommend BOOST with budget hint.\n"
            "5. Recall lessons via `recall_lessons` to surface past lifecycle "
            "   decisions that worked or didn't for this workspace.\n\n"
            "Repurpose pipeline (when REPURPOSE is chosen):\n"
            "  thread (X) → blog post → video script → meme/short.\n"
            "Each step in the pipeline is its own draft + approval cycle."
        ),
        agent=evaluator,
        expected_output=(
            "Per-artefact record: draft_id, action (REPOST | REPURPOSE | "
            "RETIRE | BOOST), rationale, suggested_repurpose_format (if "
            "applicable), suggested_boost_usd (if applicable), confidence."
        ),
    )


def build_lifecycle_crew(*, company_id: str) -> Crew:
    evaluator = make_lifecycle_evaluator()
    t_evaluate = task_evaluate_portfolio(evaluator)
    crew = Crew(
        agents=[evaluator],
        tasks=[t_evaluate],
        process=Process.sequential,
        verbose=False,
        memory=False,
    )    # NOTE: Langfuse tag wiring removed — see content_factory/crew.py.
    return crew
