// Per-topic payload schemas. zod runtime validators + inferred TS types.
// Mirror of schemas.py. Doc 4 §2.1 locked the field set per topic; this file
// formalises into typed payloads.
//
// To add a new field to a payload:
//   1. Bump the topic's `version` in producers.
//   2. Add a new schema variant here as `<Name>PayloadV2Schema` and a union.
//   3. Consumers branch on event.version until everyone's on v2.
//   4. After 30 days, remove the v1 variant.

import { z } from "zod";

// ─── content.published ─────────────────────────────────────────────────────

export const ContentPublishedPayloadSchema = z.object({
  draftId: z.string().uuid(),
  channel: z.enum(["x", "linkedin", "reddit", "tiktok", "instagram", "newsletter", "blog"]),
  publishedUrl: z.string().url().nullable().optional(),
  publishedAt: z.string().datetime(),
  campaignId: z.string().uuid().nullable().optional(),
  /** When bandit allocation produced this variant choice. */
  banditVariantId: z.string().nullable().optional(),
});
export type ContentPublishedPayload = z.infer<typeof ContentPublishedPayloadSchema>;

// ─── content.metric_update ─────────────────────────────────────────────────

export const ContentMetricUpdatePayloadSchema = z.object({
  draftId: z.string().uuid(),
  platform: z.string(),
  /** Metric name, e.g. 'ctr' | 'engagement_rate' | 'conversion_rate' | platform-native */
  metric: z.string().min(1),
  value: z.number(),
  /** Workspace-relative percentile within the same metric. */
  percentile: z.number().min(0).max(100).nullable().optional(),
  /** Rate of change since the previous snapshot (per-minute). Null on first snapshot. */
  velocity: z.number().nullable().optional(),
  snapshotAt: z.string().datetime(),
});
export type ContentMetricUpdatePayload = z.infer<typeof ContentMetricUpdatePayloadSchema>;

// ─── content.anomaly ───────────────────────────────────────────────────────

export const ContentAnomalyPayloadSchema = z.object({
  draftId: z.string().uuid(),
  platform: z.string(),
  /** 'spike' | 'drop' | 'flat' | platform-specific | LLM-flagged */
  anomalyKind: z.string().min(1),
  /** 0..1 — z-score-style severity, or LLM-judged severity. */
  severity: z.number().min(0).max(1),
  metric: z.string().nullable().optional(),
  detail: z.record(z.unknown()).default({}),
  detectedAt: z.string().datetime(),
});
export type ContentAnomalyPayload = z.infer<typeof ContentAnomalyPayloadSchema>;

// ─── trend.detected ────────────────────────────────────────────────────────

export const TrendDetectedPayloadSchema = z.object({
  topic: z.string().min(1),
  /** Free-text summary the agent can plug into a draft brief. */
  summary: z.string().min(1).max(500),
  /** Rate of mentions / sec at detection. */
  velocity: z.number().min(0),
  platforms: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
  /** Relevance to active campaigns × velocity × competitive whitespace, 0..1. */
  relevanceScore: z.number().min(0).max(1).nullable().optional(),
  ttlSeconds: z.number().int().positive().default(43_200),  // 12h default
});
export type TrendDetectedPayload = z.infer<typeof TrendDetectedPayloadSchema>;

// ─── competitor.signal ─────────────────────────────────────────────────────

export const CompetitorSignalPayloadSchema = z.object({
  /** Tracked competitor handle, domain, or entity id (per-workspace config). */
  entity: z.string().min(1),
  /** 'published' | 'pivoted' | 'hire' | 'launch' | 'pricing_change' | 'crisis' */
  actionKind: z.string().min(1),
  contentHash: z.string().nullable().optional(),
  contentUrl: z.string().url().nullable().optional(),
  /** Estimated percentile of the competitor's piece in their own audience. */
  estimatedPercentile: z.number().min(0).max(100).nullable().optional(),
  observedAt: z.string().datetime(),
});
export type CompetitorSignalPayload = z.infer<typeof CompetitorSignalPayloadSchema>;

// ─── platform.algorithm_shift ──────────────────────────────────────────────

export const PlatformAlgorithmShiftPayloadSchema = z.object({
  platform: z.enum(["x", "linkedin", "reddit", "tiktok", "instagram"]),
  /** Free-text signal name e.g. 'link-post-decay' | 'video-first-priority'. */
  signalKind: z.string().min(1),
  confidence: z.number().min(0).max(1),
  /** Magnitude of the change in performance (e.g. -0.30 = 30% drop). */
  magnitude: z.number(),
  /** When AlgorithmProbe first observed; not when it confirmed. */
  observedAt: z.string().datetime(),
  /** Bumped signals/algorithms/<platform>/current.yaml version, if rewritten. */
  newAlgorithmVersion: z.string().nullable().optional(),
});
export type PlatformAlgorithmShiftPayload = z.infer<typeof PlatformAlgorithmShiftPayloadSchema>;

// ─── campaign.brief_updated ────────────────────────────────────────────────

export const CampaignBriefUpdatedPayloadSchema = z.object({
  campaignId: z.string().uuid(),
  /** SemVer-ish version string of the campaign brief after the update. */
  briefVersion: z.string(),
  /** Free-text human-readable diff summary. */
  diffSummary: z.string().min(1).max(2000),
  /** Triggered by: 'human' | 'strategist_agent' | 'metrics_threshold' | ... */
  triggeredBy: z.string().min(1),
  changedFields: z.array(z.string()).default([]),
  updatedAt: z.string().datetime(),
});
export type CampaignBriefUpdatedPayload = z.infer<typeof CampaignBriefUpdatedPayloadSchema>;

// ─── live_event.detected ───────────────────────────────────────────────────

export const LiveEventDetectedPayloadSchema = z.object({
  /** 'industry-news' | 'crisis' | 'cultural-moment' | 'regulatory' | ... */
  eventKind: z.string().min(1),
  headline: z.string().min(1).max(500),
  sourceUrl: z.string().url().nullable().optional(),
  /** 0..10 severity scale; workspaces configure pause-publishes threshold. */
  severity: z.number().int().min(0).max(10),
  /** 0..1 — relevance to active campaigns. */
  relevanceScore: z.number().min(0).max(1),
  /** Suggested action: 'pause-publishes' | 'add-disclosure' | 'draft-response' | 'log'. */
  suggestedAction: z.string().nullable().optional(),
  detectedAt: z.string().datetime(),
});
export type LiveEventDetectedPayload = z.infer<typeof LiveEventDetectedPayloadSchema>;

// ─── engagement.opportunity ────────────────────────────────────────────────

export const EngagementOpportunityPayloadSchema = z.object({
  /** The draft / post that triggered this opportunity (the original outbound). */
  sourceDraftId: z.string().uuid(),
  platform: z.string(),
  /** 'reply' | 'quote-tweet' | 'thread-continuation' | 'community-moderation' */
  opportunityKind: z.string().min(1),
  /** External id of the inbound interaction (reply id, qt id, comment id). */
  externalInteractionId: z.string().min(1),
  /** Suggested action — drafted reply text, recommendation, etc. */
  suggestedAction: z.string().min(1).max(2000).nullable().optional(),
  /** 0..1 — how worthwhile to act on. */
  priorityScore: z.number().min(0).max(1),
  /** SLA window in seconds; engagement.opportunity expires if not acted on. */
  slaSeconds: z.number().int().positive().default(300),
  detectedAt: z.string().datetime(),
});
export type EngagementOpportunityPayload = z.infer<typeof EngagementOpportunityPayloadSchema>;

// ─── Topic → schema lookup ────────────────────────────────────────────────

export const PAYLOAD_SCHEMAS = {
  "content.published": ContentPublishedPayloadSchema,
  "content.metric_update": ContentMetricUpdatePayloadSchema,
  "content.anomaly": ContentAnomalyPayloadSchema,
  "trend.detected": TrendDetectedPayloadSchema,
  "competitor.signal": CompetitorSignalPayloadSchema,
  "platform.algorithm_shift": PlatformAlgorithmShiftPayloadSchema,
  "campaign.brief_updated": CampaignBriefUpdatedPayloadSchema,
  "live_event.detected": LiveEventDetectedPayloadSchema,
  "engagement.opportunity": EngagementOpportunityPayloadSchema,
} as const;
