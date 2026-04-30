import { z } from "zod";

// A draft is the canonical writeable artifact a content_factory crew produces.
// Per-platform reshapes carry parentDraftId.

export const DraftStatusSchema = z.enum([
  "drafting",
  "in_review",
  "awaiting_approval",
  "approved",
  "scheduled",
  "published",
  "denied",
  "archived",
]);
export type DraftStatus = z.infer<typeof DraftStatusSchema>;

export const ChannelSchema = z.enum([
  "x",
  "linkedin",
  "reddit",
  "tiktok",
  "instagram",
  "newsletter",
  "blog",
]);
export type Channel = z.infer<typeof ChannelSchema>;

export const ClaimSchema = z.object({
  statement: z.string().min(1),
  supportingUrl: z.string().url().optional(),
  snippet: z.string().optional(),
  retrievedAt: z.string().datetime().optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const DraftSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  parentDraftId: z.string().uuid().nullable().optional(), // long-form -> per-channel reshape
  channel: ChannelSchema,
  status: DraftStatusSchema.default("drafting"),
  title: z.string().max(300).optional(),
  body: z.string(),
  hashtags: z.array(z.string()).default([]),
  claims: z.array(ClaimSchema).default([]),
  voiceScore: z.number().min(0).max(1).nullable().optional(),
  predictedPercentile: z.number().min(0).max(100).nullable().optional(),
  authoredByAgentId: z.string().uuid().nullable().optional(),
  approvalId: z.string().uuid().nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  publishedUrl: z.string().url().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Draft = z.infer<typeof DraftSchema>;
