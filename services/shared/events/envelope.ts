import { z } from "zod";

import { TOPICS, type TopicName } from "./topics";

// The envelope every event carries on the bus.
// Schema is shared across topics; the per-topic payload shape lives in schemas.ts.

export const EventEnvelopeBaseSchema = z.object({
  /** Stable id for idempotency. ULID format recommended (e.g. evt_01HXYZ...). */
  id: z.string().min(8).max(64),
  topic: z.enum([
    TOPICS.CONTENT_PUBLISHED,
    TOPICS.CONTENT_METRIC_UPDATE,
    TOPICS.CONTENT_ANOMALY,
    TOPICS.TREND_DETECTED,
    TOPICS.COMPETITOR_SIGNAL,
    TOPICS.PLATFORM_ALGORITHM_SHIFT,
    TOPICS.CAMPAIGN_BRIEF_UPDATED,
    TOPICS.LIVE_EVENT_DETECTED,
    TOPICS.ENGAGEMENT_OPPORTUNITY,
  ]),
  /** Schema version of the payload. Bump on breaking changes. */
  version: z.number().int().positive().default(1),
  occurredAt: z.string().datetime(),
  /** Required on every event. Consumers filter; the bus does not. */
  companyId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  /** Langfuse trace id round-trip. Optional but encouraged. */
  traceId: z.string().nullable().optional(),
});

export type EventEnvelopeBase = z.infer<typeof EventEnvelopeBaseSchema>;

/**
 * Type helper to build a fully-typed envelope for a specific topic+payload.
 * Use as: EnvelopedEvent<typeof TOPICS.CONTENT_PUBLISHED, ContentPublishedPayload>
 */
export type EnvelopedEvent<T extends TopicName, P> = EventEnvelopeBase & {
  topic: T;
  payload: P;
};
