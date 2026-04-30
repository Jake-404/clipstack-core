import { z } from "zod";

// One human-actionable item in the approval queue.
// Drafts, replies, calendar items, agent-replacement proposals, reactive trends — all approvals.

export const ApprovalKindSchema = z.enum([
  "draft_publish",            // a content draft awaiting human approve/deny
  "engagement_reply",         // proposed reply to a customer / mention (Doc 4 §2.9)
  "campaign_launch",          // paid campaign go-live
  "agent_replacement",        // Mira proposing fire-and-rebuild
  "reactive_trend",           // trend-watcher proposing reactive content
  "skill_install",            // proposed install of a marketplace skill
  "voice_corpus_add",         // sample pushed to brand voice corpus
  "metered_spend_unlock",     // unlock a paid asset call past per-agent cap
]);
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;

export const ApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "expired",
  "revoked",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  kind: ApprovalKindSchema,
  status: ApprovalStatusSchema.default("pending"),
  payload: z.record(z.unknown()),  // kind-specific shape; validated per-kind in routes
  createdByAgentId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  decidedByUserId: z.string().uuid().nullable().optional(),
  decidedAt: z.string().datetime().nullable().optional(),
  // USP 5 — present on deny.
  denyRationale: z.string().min(20).max(2000).nullable().optional(),
  denyScope: z.enum(["forever", "this_topic", "this_client"]).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const DenyRequestSchema = z.object({
  rationale: z.string().min(20).max(2000),
  scope: z.enum(["forever", "this_topic", "this_client"]),
});
export type DenyRequest = z.infer<typeof DenyRequestSchema>;
