"""LiteLLM profile loader. Doc 1 §5.

Crews and tools never import a model name directly. They reference one of
the named profiles below, which LiteLLM resolves to a concrete model per
infra/litellm/config.yaml. A model swap is a config change there, never a
code change here.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import httpx
import structlog

log = structlog.get_logger()

LITELLM_BASE_URL = os.getenv("LITELLM_BASE_URL", "http://litellm:4000")
LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "sk-clipstack-dev")


@dataclass(frozen=True)
class ModelProfile:
    """One named model profile per Doc 1 §5.

    `name` is the alias LiteLLM resolves (see infra/litellm/config.yaml
    `router_settings.model_group_alias`). Passed to CrewAI as
    `llm=LLM(model=profile.name, base_url=..., api_key=...)`.
    """

    name: str
    purpose: str


# Named profiles — order matches infra/litellm/config.yaml aliases.
WRITER_MODEL = ModelProfile(
    name="WRITER_MODEL",
    purpose="long-form drafting, brand voice, judgment calls (frontier)",
)
WRITER_LOCAL_MODEL = ModelProfile(
    name="WRITER_LOCAL_MODEL",
    purpose="PII-safe writer path (Ollama llama3.1)",
)
CLASSIFIER_MODEL = ModelProfile(
    name="CLASSIFIER_MODEL",
    purpose="cheap fast classify/extract (Haiku tier)",
)
CLASSIFIER_LOCAL_MODEL = ModelProfile(
    name="CLASSIFIER_LOCAL_MODEL",
    purpose="PII-safe classifier (Ollama qwen2.5)",
)
JUDGE_MODEL = ModelProfile(
    name="JUDGE_MODEL",
    purpose="critic/judge calls — separate vendor from writer to avoid same-bias-loop",
)
VOICE_EMBED_MODEL = ModelProfile(
    name="VOICE_EMBED_MODEL",
    purpose="voice fingerprint embeddings (PII-safe, local)",
)


def llm_kwargs(profile: ModelProfile) -> dict[str, str]:
    """LiteLLM -> CrewAI LLM kwargs adapter.

    Use as: `Agent(..., llm=LLM(**llm_kwargs(WRITER_MODEL)))`.
    """
    return {
        "model": profile.name,
        "base_url": LITELLM_BASE_URL,
        "api_key": LITELLM_MASTER_KEY,
    }


async def ensure_litellm_reachable(*, strict: bool = False) -> bool:
    """Probe the LiteLLM proxy. Logs a warning if unreachable in non-strict mode."""
    url = f"{LITELLM_BASE_URL}/health"
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(url)
            ok = r.status_code == 200
    except (httpx.HTTPError, OSError) as e:
        log.warning("litellm.unreachable", url=url, error=str(e))
        if strict:
            raise
        return False

    if not ok:
        log.warning("litellm.unhealthy", url=url, status=r.status_code)
    return ok
