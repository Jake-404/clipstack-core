"""Feature engineering for the percentile-predictor.

Kept in its own module so the engineering can evolve independently of the
endpoint code, and so /train + /predict share exactly the same code path.
A new feature added here automatically appears in both places without a
schema drift between training-time and inference-time vectors.

Feature ordering is part of the model contract. `FEATURE_NAMES` is the
canonical order — model artefacts persist this list; on load we assert
the saved order matches the current code or 500 with a "model out of
sync, retrain" message.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

# Canonical channel set. Out-of-set channels collapse to a sentinel "other".
CHANNELS: tuple[str, ...] = (
    "x",
    "linkedin",
    "reddit",
    "tiktok",
    "instagram",
    "newsletter",
    "blog",
)

# Order matters — LightGBM's feature_importances_ aligns 1:1 with this list.
# Append new features at the end; never reorder. Bumping the list = retrain.
FEATURE_NAMES: tuple[str, ...] = (
    "word_count",
    "text_len",
    "hashtag_count",
    "has_media",
    "voice_score",
    "claim_count",
    "scheduled_hour",
    "scheduled_dow",
    *(f"channel_{c}" for c in CHANNELS),
    "channel_other",
)


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        # Tolerate trailing 'Z' which fromisoformat doesn't accept on 3.11.
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def featurise(features: dict[str, Any]) -> list[float]:
    """Turn a DraftFeatures dict into a stable-ordered float vector.

    Missing fields fall back to neutral defaults (median-ish):
      - voice_score → 0.5 (mid)
      - scheduled_hour → 12 (noon)
      - scheduled_dow → 2 (Wednesday)
      - word_count → splits text on whitespace
    """
    text = str(features.get("text") or "")
    word_count = features.get("word_count")
    if word_count is None:
        word_count = len(text.split())

    hashtags = features.get("hashtags") or []
    voice_score = features.get("voice_score")
    if voice_score is None:
        voice_score = 0.5

    sched = _parse_iso(features.get("scheduled_for"))
    sched_hour = sched.hour if sched else 12
    sched_dow = sched.weekday() if sched else 2

    channel = features.get("channel") or ""
    chan_flags = [1.0 if channel == c else 0.0 for c in CHANNELS]
    chan_other = 0.0 if channel in CHANNELS else 1.0

    return [
        float(word_count),
        float(len(text)),
        float(len(hashtags)),
        1.0 if features.get("has_media") else 0.0,
        float(voice_score),
        float(features.get("claim_count") or 0),
        float(sched_hour),
        float(sched_dow),
        *chan_flags,
        chan_other,
    ]
