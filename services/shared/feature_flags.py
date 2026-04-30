"""Feature flags — Python mirror of feature-flags.ts.

Mirror rule: change one, change the other in the same PR. CI structural-diff
gates this in A.1; until then, code review.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _true_like(v: str | None) -> bool:
    return v is not None and v.lower() in {"true", "1", "yes", "on"}


CRYPTO_ENABLED = _true_like(os.getenv("CRYPTO_ENABLED"))
EVENTBUS_ENABLED = _true_like(os.getenv("EVENTBUS_ENABLED"))
BANDITS_ENABLED = _true_like(os.getenv("BANDITS_ENABLED")) and EVENTBUS_ENABLED
SIGNALS_LOADED = _true_like(os.getenv("SIGNALS_LOADED"))
AGENT_BUDGET_AUTONOMOUS = _true_like(os.getenv("AGENT_BUDGET_AUTONOMOUS"))


@dataclass(frozen=True)
class _Flags:
    CRYPTO_ENABLED: bool = CRYPTO_ENABLED
    EVENTBUS_ENABLED: bool = EVENTBUS_ENABLED
    BANDITS_ENABLED: bool = BANDITS_ENABLED
    SIGNALS_LOADED: bool = SIGNALS_LOADED
    AGENT_BUDGET_AUTONOMOUS: bool = AGENT_BUDGET_AUTONOMOUS


flags = _Flags()
