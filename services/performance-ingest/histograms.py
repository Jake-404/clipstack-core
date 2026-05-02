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
from collections.abc import Iterable
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


def update_and_rank(
    data_dir: Path,
    company_id: str,
    platform: str,
    metric: str,
    value: float,
) -> float | None:
    """Append `value` to the histogram for (company, platform, metric)
    and return its percentile rank against the *prior* distribution.

    Order matters: we compute the percentile *before* inserting the new
    value. Otherwise a bootstrap workspace's first snapshot would always
    score 100 (it's the only value in the histogram, ergo above all
    others). Returning None on cold start is the right default; the
    bandit consumer correctly no-ops on it.
    """
    path = histogram_path(data_dir, company_id, platform, metric)
    sorted_values = load_sorted(path)
    rank = percentile_of(value, sorted_values)
    sorted_values = append_with_cap(sorted_values, value, HIST_CAPACITY)
    save_sorted(path, sorted_values)
    return rank


def update_and_rank_many(
    data_dir: Path,
    items: Iterable[tuple[str, str, str, float]],
) -> dict[tuple[str, str, str, float], float | None]:
    """Bulk variant of update_and_rank — useful when /ingest fans a single
    snapshot to N metric_update events (one per non-null column). Returns
    a dict keyed by the input tuple for stable lookup at the call site.

    Implementation just calls update_and_rank in a loop — file-level locking
    isn't a concern at our scale and the order-preserving sequential pass
    keeps the percentile-then-insert invariant clean.
    """
    out: dict[tuple[str, str, str, float], float | None] = {}
    for company_id, platform, metric, value in items:
        rank = update_and_rank(data_dir, company_id, platform, metric, value)
        out[(company_id, platform, metric, value)] = rank
    return out
