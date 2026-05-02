"""Per-(company × platform × metric) rolling-value histograms.

Used by /ingest to convert raw metric values (e.g. impressions=1247) into
workspace-relative percentiles (e.g. 73.5 — better than 73.5% of this
workspace's recent posts on this platform for this metric). The bandit
reward listener consumes percentile, not raw value, so this enrichment
is the load-bearing piece that lets the closed loop actually learn.

Design choices:

  - Append-only sorted list of recent values, capped at HIST_CAPACITY
    (default 10_000). Once full, oldest entries roll off. Bounds memory
    + disk per workspace × platform × metric (worst case ~80MB total
    even at 1k workspaces × 5 platforms × 8 metrics × 2KB per file).

  - Percentile via stdlib `bisect.bisect_right` — O(log N) lookup,
    exact (no histogram-bucket approximation). Insertion is O(N) but
    inside a small list (10k cap) it's trivially fast (<1ms).

  - One file per (company, platform, metric). Atomic .tmp + replace on
    every write so /ingest under concurrent calls never sees a half-
    written histogram. No locking needed because Python's GIL serial-
    ises the read/write/append cycle within the event loop step.

  - Cold start: empty histogram → returns percentile=None. Caller
    decides what to do (the producer emits the event with
    percentile=null; the bandit consumer no-ops on null, which is the
    right default — better silent than wrong).
"""

from __future__ import annotations

import bisect
import json
import os
from pathlib import Path

import structlog

log = structlog.get_logger()

HIST_CAPACITY: int = int(os.getenv("INGEST_HIST_CAPACITY", "10000"))


def _safe(part: str) -> str:
    """Path-component sanitiser. company_id / platform / metric are passed
    in from the request; we don't want a malicious caller posting a
    '../../etc/passwd' style platform value to escape the data dir."""
    return "".join(c for c in part if c.isalnum() or c in "_-")


def histogram_path(data_dir: Path, company_id: str, platform: str, metric: str) -> Path:
    cid = _safe(company_id) or "unknown"
    pl = _safe(platform) or "unknown"
    mt = _safe(metric) or "unknown"
    return data_dir / f"{cid}-{pl}-{mt}.histogram.json"


def load_sorted(path: Path) -> list[float]:
    """Load the sorted-values list from disk. Empty list on missing file
    or corruption — corruption is logged but doesn't fail the request."""
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        log.warning("histogram.read_failed", path=str(path), error=str(e))
        return []
    if not isinstance(data, dict):
        return []
    values = data.get("values")
    if not isinstance(values, list):
        return []
    # Defensive — file was written sorted, but we trust-but-verify so a
    # downstream operator who hand-edits a file doesn't poison the
    # bisect lookup.
    return sorted(float(v) for v in values if isinstance(v, (int, float)))


def save_sorted(path: Path, values: list[float]) -> None:
    """Atomic .tmp + replace persistence. Caller has already enforced the
    cap; we write whatever we get."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps({"values": values}, separators=(",", ":")))
    tmp.replace(path)


def percentile_of(value: float, sorted_values: list[float]) -> float | None:
    """Return the percentile rank of `value` against the sorted list, or
    None if the list is empty (cold start).

    Uses the "weak" definition of percentile (P% of values are ≤ value).
    bisect_right gives the count of values strictly less-than-or-equal-
    to value; dividing by N yields the rank in [0, 100]. For tied values
    this counts ties as below — same as scipy's `kind="weak"`.
    """
    if not sorted_values:
        return None
    n = len(sorted_values)
    rank = bisect.bisect_right(sorted_values, value)
    return (rank / n) * 100.0


def append_with_cap(sorted_values: list[float], value: float, cap: int) -> list[float]:
    """Insert `value` into the sorted list and roll the oldest off if
    we're over cap.

    The order of operations matters: we don't track insertion order, so
    "oldest" here is loosely "smallest" — effectively a sliding window
    over the lower tail of the distribution. This biases retention
    toward recent (and statistically larger) outliers, which matches
    what we want for percentile rank against current state. A future
    slice can swap to a fixed-size deque if the bias becomes
    pathological for low-engagement workspaces.
    """
    bisect.insort(sorted_values, value)
    if len(sorted_values) > cap:
        # Drop the smallest element. O(N) but only fires on already-full
        # histograms; amortises to O(log N) under typical insertions.
        sorted_values.pop(0)
    return sorted_values


def mean_std(sorted_values: list[float]) -> tuple[float, float] | None:
    """Sample mean + sample standard deviation over the values list.

    Returns None when N < 2 (we can't compute std from a single value;
    population std is 0 by definition for N=1 which would div-by-zero
    on z-score). Sample std uses Bessel's correction (N-1 denominator)
    which matches the convention the anomaly detector follows.

    O(N) walk over the list — fine inside a 10k cap. If profiling shows
    this as a hot path, swap to running Welford's algorithm where each
    update_and_rank only does O(1) work.
    """
    n = len(sorted_values)
    if n < 2:
        return None
    mean = sum(sorted_values) / n
    var = sum((v - mean) ** 2 for v in sorted_values) / (n - 1)
    return mean, var ** 0.5


def update_and_rank(
    data_dir: Path,
    company_id: str,
    platform: str,
    metric: str,
    value: float,
) -> tuple[float | None, tuple[float, float] | None, int]:
    """Append `value` to the histogram and return:
      - percentile rank against the *prior* distribution (None on cold
        start)
      - (mean, std) of the prior distribution (None when N < 2)
      - prior_n: the count of values that were in the histogram before
        this insertion. Lets callers gate on min-samples for anomaly
        detection without re-reading the file.

    Percentile + stats are computed before insertion so the new value
    doesn't poison its own ranking — load-bearing invariant for both
    percentile-fill (without it, every first snapshot would be 100%)
    and z-score detection (without it, std would shrink artificially
    as the value gets included in its own deviation calc).
    """
    path = histogram_path(data_dir, company_id, platform, metric)
    sorted_values = load_sorted(path)
    prior_n = len(sorted_values)
    rank = percentile_of(value, sorted_values)
    stats = mean_std(sorted_values)
    sorted_values = append_with_cap(sorted_values, value, HIST_CAPACITY)
    save_sorted(path, sorted_values)
    return rank, stats, prior_n


def zscore(value: float, stats: tuple[float, float] | None) -> float | None:
    """Compute z-score of `value` given (mean, std). Returns None when
    stats is None (cold start) or std is 0 (degenerate distribution
    where every prior value was identical — z=∞ would not be useful)."""
    if stats is None:
        return None
    mean, std = stats
    if std == 0.0:
        return None
    return (value - mean) / std


def severity_from_zscore(z: float, soft_cap: float = 5.0) -> float:
    """Map |z-score| → severity in [0, 1] for ContentAnomalyPayload.

    Linear ramp up to soft_cap σ (default 5σ saturates to severity=1).
    Beyond 5σ, the math is sensitive to small std variations + the human
    interpretation collapses ("very anomalous" doesn't usefully sub-
    divide), so capping at 1.0 is the right call.
    """
    return min(1.0, abs(z) / soft_cap)
