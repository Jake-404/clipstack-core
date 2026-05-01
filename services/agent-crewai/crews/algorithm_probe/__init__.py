"""algorithm_probe crew — Doc 4 §2.6.

Active platform-algorithm shift detection. Runs known-pattern test posts on
the workspace's least-sensitive surface, measures decay against baseline,
and aggregates platform-wide changes across the customer base (anonymised).
Updates `signals/algorithms/<platform>/current.yaml` and emits
`platform.algorithm_shift` when confidence clears threshold.

Acceptance per Doc 4: shifts detected within 7 days of onset.
"""

from .crew import build_algorithm_probe_crew

__all__ = ["build_algorithm_probe_crew"]
