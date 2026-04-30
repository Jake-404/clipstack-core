// The 9 named topics — Doc 4 §2.1 locked.
// Sole source of truth. Producers and consumers import these constants;
// never hard-code a topic name as a string at the call site.

export const TOPICS = {
  CONTENT_PUBLISHED: "content.published",
  CONTENT_METRIC_UPDATE: "content.metric_update",
  CONTENT_ANOMALY: "content.anomaly",
  TREND_DETECTED: "trend.detected",
  COMPETITOR_SIGNAL: "competitor.signal",
  PLATFORM_ALGORITHM_SHIFT: "platform.algorithm_shift",
  CAMPAIGN_BRIEF_UPDATED: "campaign.brief_updated",
  LIVE_EVENT_DETECTED: "live_event.detected",
  ENGAGEMENT_OPPORTUNITY: "engagement.opportunity",
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

/** Used to discover all topics (e.g. for n8n consumer-group provisioning). */
export const ALL_TOPICS: TopicName[] = Object.values(TOPICS);

/**
 * Suggested partitions per topic. High-volume topics (metric_update, anomaly)
 * get more partitions; rare topics (algorithm_shift, brief_updated) need
 * fewer. These are deployment hints, not part of the contract — Redpanda's
 * `auto_create_topics` honours them on first publish.
 */
export const TOPIC_PARTITIONS: Record<TopicName, number> = {
  [TOPICS.CONTENT_PUBLISHED]: 4,
  [TOPICS.CONTENT_METRIC_UPDATE]: 16,
  [TOPICS.CONTENT_ANOMALY]: 4,
  [TOPICS.TREND_DETECTED]: 2,
  [TOPICS.COMPETITOR_SIGNAL]: 2,
  [TOPICS.PLATFORM_ALGORITHM_SHIFT]: 1,
  [TOPICS.CAMPAIGN_BRIEF_UPDATED]: 2,
  [TOPICS.LIVE_EVENT_DETECTED]: 2,
  [TOPICS.ENGAGEMENT_OPPORTUNITY]: 8,
};
