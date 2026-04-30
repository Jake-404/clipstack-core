"""The 9 named topics — Doc 4 §2.1 locked.

Sole source of truth. Producers and consumers import these constants; never
hard-code a topic name as a string at the call site.
"""

from __future__ import annotations

from typing import Final, Literal


class Topics:
    CONTENT_PUBLISHED: Final = "content.published"
    CONTENT_METRIC_UPDATE: Final = "content.metric_update"
    CONTENT_ANOMALY: Final = "content.anomaly"
    TREND_DETECTED: Final = "trend.detected"
    COMPETITOR_SIGNAL: Final = "competitor.signal"
    PLATFORM_ALGORITHM_SHIFT: Final = "platform.algorithm_shift"
    CAMPAIGN_BRIEF_UPDATED: Final = "campaign.brief_updated"
    LIVE_EVENT_DETECTED: Final = "live_event.detected"
    ENGAGEMENT_OPPORTUNITY: Final = "engagement.opportunity"


TopicName = Literal[
    "content.published",
    "content.metric_update",
    "content.anomaly",
    "trend.detected",
    "competitor.signal",
    "platform.algorithm_shift",
    "campaign.brief_updated",
    "live_event.detected",
    "engagement.opportunity",
]

ALL_TOPICS: tuple[str, ...] = (
    Topics.CONTENT_PUBLISHED,
    Topics.CONTENT_METRIC_UPDATE,
    Topics.CONTENT_ANOMALY,
    Topics.TREND_DETECTED,
    Topics.COMPETITOR_SIGNAL,
    Topics.PLATFORM_ALGORITHM_SHIFT,
    Topics.CAMPAIGN_BRIEF_UPDATED,
    Topics.LIVE_EVENT_DETECTED,
    Topics.ENGAGEMENT_OPPORTUNITY,
)

TOPIC_PARTITIONS: dict[str, int] = {
    Topics.CONTENT_PUBLISHED: 4,
    Topics.CONTENT_METRIC_UPDATE: 16,
    Topics.CONTENT_ANOMALY: 4,
    Topics.TREND_DETECTED: 2,
    Topics.COMPETITOR_SIGNAL: 2,
    Topics.PLATFORM_ALGORITHM_SHIFT: 1,
    Topics.CAMPAIGN_BRIEF_UPDATED: 2,
    Topics.LIVE_EVENT_DETECTED: 2,
    Topics.ENGAGEMENT_OPPORTUNITY: 8,
}
