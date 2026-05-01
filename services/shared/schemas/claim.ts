import { z } from "zod";

// content_claims row — USP 8 provenance.
// Normalised version of the JSONB array on `drafts.claims`.

export const ClaimVerifierStatusSchema = z.enum([
  "pending",
  "verified",
  "drift",
  "dead_link",
  "unsupported",
  "paywalled",
  "rate_limited",
]);
export type ClaimVerifierStatus = z.infer<typeof ClaimVerifierStatusSchema>;

export const ContentClaimSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  draftId: z.string().uuid(),
  statement: z.string().min(1).max(4000),
  supportingUrl: z.string().url().nullable().optional(),
  snippet: z.string().nullable().optional(),
  snippetHash: z.string().nullable().optional(),
  verifierStatus: ClaimVerifierStatusSchema.default("pending"),
  // 0..1 cosine similarity between cited snippet and current source-page text.
  // null while pending or when verifier hasn't yet completed a run.
  verifierScore: z.number().min(0).max(1).nullable().optional(),
  verifierLastRunAt: z.string().datetime().nullable().optional(),
  verifierDetailsJson: z.record(z.unknown()).default({}),
  retrievedAt: z.string().datetime().nullable().optional(),
  authoredByAgentId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContentClaim = z.infer<typeof ContentClaimSchema>;

export const ContentClaimCreateSchema = ContentClaimSchema.pick({
  companyId: true,
  clientId: true,
  draftId: true,
  statement: true,
  supportingUrl: true,
  snippet: true,
  retrievedAt: true,
  authoredByAgentId: true,
});
export type ContentClaimCreate = z.infer<typeof ContentClaimCreateSchema>;

// ─── Verifier-run output shape ────────────────────────────────────────────

export const VerifierRunResultSchema = z.object({
  claimId: z.string().uuid(),
  status: ClaimVerifierStatusSchema,
  score: z.number().min(0).max(1).nullable(),
  // Free-text rationale for human readers; surfaced on the approval-ui
  // claim-details panel.
  rationale: z.string().min(1).max(2000),
  details: z.record(z.unknown()).default({}),
  ranAt: z.string().datetime(),
});
export type VerifierRunResult = z.infer<typeof VerifierRunResultSchema>;

export const VerifyClaimsRequestSchema = z.object({
  // Optional list of specific claim ids to re-verify; null = all claims for the draft.
  claimIds: z.array(z.string().uuid()).max(200).optional(),
  // Re-verify even claims that were verified recently. Default false: skip
  // claims with verifierLastRunAt within the last 7 days.
  force: z.boolean().default(false),
});
export type VerifyClaimsRequest = z.infer<typeof VerifyClaimsRequestSchema>;

export const VerifyClaimsResponseSchema = z.object({
  draftId: z.string().uuid(),
  claimCount: z.number().int().nonnegative(),
  byStatus: z.record(z.number().int().nonnegative()),
  results: z.array(VerifierRunResultSchema),
});
export type VerifyClaimsResponse = z.infer<typeof VerifyClaimsResponseSchema>;
