"""Per-draft last-value cache for velocity computation.

Velocity = rate-of-change of a metric vs its prior snapshot. Surfaces in
the content.metric_update event's `velocity` field (units: metric-units
per second). Downstream consumers use velocity to:

  - Detect viral lift in real time (spike in clicks/min on a fresh post)
  - Flag stalled engagement (velocity collapsing post-launch)
  - Power "trending now" surfaces in Mission Control
  - Feed into bandit reward shaping (a future slice can blend percentile
    + velocity into a richer reward signal)

Storage layout:
  DATA_DIR/last_values/{company_id}-{draft_id}.json

One file per draft, all (platform × metric) combos in it. Compact:
~10 platforms × 8 metrics × 50 bytes ≈ 4KB per draft. Atomic writes
match the histogram pattern; concurrent /ingest calls within a single
event-loop step serialise on the GIL.

Cold start: no prior snapshot → velocity = None. Same fail-soft default
as percentile + z-score. Better silent than wrong.

Edge cases:
  - Zero time delta (same snapshot_at as prior) → None (avoids div-by-
    zero). Snapshot dedup belongs upstream; we don't fabricate a value.
  - Negative time delta (out-of-order snapshot) → None. Eventual
    consistency on the inbound side is fine for this metric — wait for
    the next in-order snapshot.
  - Bad JSON / missing prior file → cold-start path, velocity=None.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import structlog

log = structlog.get_logger()

LAST_VALUES_SUBDIR = "last_values"


def _safe(part: str) -> str:
    """Path-component sanitiser. Same as histograms._safe — kept duplicated
    rather than imported to keep the module self-contained + avoid a
    cross-module dep on a private helper."""
    return "".join(c for c in part if c.isalnum() or c in "_-")


def last_values_path(data_dir: Path, company_id: str, draft_id: str) -> Path:
    cid = _safe(company_id) or "unknown"
    did = _safe(draft_id) or "unknown"
    return data_dir / LAST_VALUES_SUBDIR / f"{cid}-{did}.json"


def iter_company_last_values(
    data_dir: Path,
    company_id: str,
) -> list[tuple[str, dict[str, dict[str, object]]]]:
    """Walk every last_values file for the workspace, yielding
    (draft_id, last_dict) pairs. Used by /anomaly/scan to find every
    draft with recent activity to z-score against the workspace
    histograms.

    Files are named "{company}-{draft}.json" — we filter by `{cid}-`
    prefix and strip it to recover the draft_id. Glob matches files
    only (skips the .tmp half-writes from atomic save_last).
    """
    cid = _safe(company_id)
    sub = data_dir / LAST_VALUES_SUBDIR
    if not sub.exists() or not cid:
        return []
    out: list[tuple[str, dict[str, dict[str, object]]]] = []
    prefix = f"{cid}-"
    for path in sub.glob(f"{cid}-*.json"):
        if path.name.endswith(".tmp"):
            continue
        # Strip "{cid}-" prefix and ".json" suffix to recover draft_id.
        # The cid prefix is sanitised; the draft_id portion is too. So
        # this round-trips correctly when called from the same code path
        # that wrote the file.
        draft_id = path.stem[len(prefix):]
        if not draft_id:
            continue
        last = load_last(path)
        if last:
            out.append((draft_id, last))
    return out


def load_last(path: Path) -> dict[str, dict[str, object]]:
    """Load the per-(platform, metric) last-value map for a draft.

    Shape: {"<platform>-<metric>": {"value": float, "snapshot_at": iso8601}}

    Empty dict on missing file or corruption — corruption logged but
    request never fails on a stale velocity calc.
    """
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        log.warning("last_values.read_failed", path=str(path), error=str(e))
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def save_last(path: Path, last: dict[str, dict[str, object]]) -> None:
    """Atomic .tmp + replace persistence."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(last, separators=(",", ":")))
    tmp.replace(path)


def _parse_iso(s: object) -> datetime | None:
    if not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def compute_velocity(
    new_value: float,
    new_snapshot_at: str,
    prior: dict[str, object] | None,
) -> float | None:
    """Velocity in metric-units per second.

    Returns None on cold start, malformed prior, equal/negative time
    delta. Positive on growth, negative on decline. Caller is responsible
    for downstream interpretation (e.g. velocity > 0 doesn't always mean
    "good" — for bounce_rate it's the opposite).
    """
    if prior is None:
        return None
    prior_value = prior.get("value")
    prior_at = _parse_iso(prior.get("snapshot_at"))
    new_at = _parse_iso(new_snapshot_at)
    if not isinstance(prior_value, (int, float)):
        return None
    if prior_at is None or new_at is None:
        return None
    delta_s = (new_at - prior_at).total_seconds()
    if delta_s <= 0:
        return None
    return (float(new_value) - float(prior_value)) / delta_s


def update_and_compute(
    data_dir: Path,
    company_id: str,
    draft_id: str,
    platform: str,
    metric: str,
    value: float,
    snapshot_at: str,
) -> float | None:
    """Lookup prior snapshot for this (draft × platform × metric),
    compute velocity, persist the new value as the next prior, return
    velocity (None on cold start).

    Designed to mirror histograms.update_and_rank's atomic-roundtrip
    contract: load → compute → persist → return. Single disk roundtrip
    per metric per snapshot.
    """
    path = last_values_path(data_dir, company_id, draft_id)
    last = load_last(path)
    key = f"{_safe(platform)}-{_safe(metric)}"
    prior = last.get(key) if isinstance(last.get(key), dict) else None
    velocity = compute_velocity(value, snapshot_at, prior)
    last[key] = {"value": float(value), "snapshot_at": snapshot_at}
    save_last(path, last)
    return velocity
