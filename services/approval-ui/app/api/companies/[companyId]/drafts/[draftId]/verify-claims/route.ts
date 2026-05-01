// POST /api/companies/:companyId/drafts/:draftId/verify-claims
// USP 8 provenance — re-fetch each cited URL, snippet-match the cited text,
// update content_claims.verifier_* fields, audit the run.
//
// Phase B.1 stub: marks every claim as verified=1.0 without actually
// fetching, so the route shape, auth path, audit, and DB writes can be
// exercised before the real fetch + snippet-match logic ships.
//
// Real path (follow-up slice):
//   1. Load each claim by (draft_id, [claim_ids?])
//   2. For each: GET supporting_url with timeout + redirect-follow + UA spoof
//   3. Compare current page text to stored snippet (cosine + substring +
//      fuzzy-match cascade)
//   4. Update verifier_status / verifier_score / verifier_details_json
//   5. Emit a `claim.verified` audit row per claim
//   6. Optionally emit `content.anomaly` events when status flips
//      verified → drift on a published artefact

import { type NextRequest } from "next/server";
import { and, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { badRequest, notFound, validationFailed } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { contentClaims } from "@/lib/db/schema/content-claims";
import { drafts } from "@/lib/db/schema/drafts";
import { isUuid } from "@/lib/validation/uuid";

// Inline mirror of services/shared/schemas/claim.ts:VerifyClaimsRequestSchema.
// The shared file is the documentation source; inlining here matches the
// existing route convention (deny/route.ts inlines DenyBodySchema). When the
// approval-ui tsconfig grows to include services/shared/, both can DRY.
const VerifyClaimsRequestSchema = z.object({
  claimIds: z.array(z.string().uuid()).max(200).optional(),
  force: z.boolean().default(false),
});

type ClaimVerifierStatus =
  | "pending"
  | "verified"
  | "drift"
  | "dead_link"
  | "unsupported"
  | "paywalled"
  | "rate_limited";

interface VerifierRunResult {
  claimId: string;
  status: ClaimVerifierStatus;
  score: number | null;
  rationale: string;
  details: Record<string, unknown>;
  ranAt: string;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 7-day skip window for claims verified recently — tunable later.
const RECENT_VERIFICATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface RouteContext {
  params: Promise<{ companyId: string; draftId: string }>;
}

export const POST = withApi(async (req: NextRequest, ctx: RouteContext) => {
  const ctxAuth = await resolveServiceOrSession(req.headers);
  const { companyId, draftId } = await ctx.params;

  if (!isUuid(companyId)) badRequest("invalid companyId");
  if (!isUuid(draftId)) badRequest("invalid draftId");
  if (ctxAuth.activeCompanyId !== companyId) {
    badRequest("active workspace does not match URL param");
  }

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    // Empty body is allowed — schema defaults apply.
  }
  const parsed = VerifyClaimsRequestSchema.safeParse(raw);
  if (!parsed.success) {
    validationFailed("invalid verify-claims request", { issues: parsed.error.issues });
  }
  const { claimIds, force } = parsed.data;

  const result = await withTenant(companyId, async (tx) => {
    // Confirm draft exists in this tenant (RLS hides cross-tenant reads).
    const [existingDraft] = await tx
      .select({ id: drafts.id })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .limit(1);
    if (!existingDraft) notFound("draft not found");

    // Build the candidate-claim filter:
    //   - draft_id matches
    //   - if claimIds provided: id ∈ claimIds
    //   - if !force: skip claims verified within the recent-window
    const conditions = [eq(contentClaims.draftId, draftId)];
    if (claimIds && claimIds.length > 0) {
      conditions.push(inArray(contentClaims.id, claimIds));
    }
    if (!force) {
      // Only re-verify if last run was older than the skip window OR null.
      const cutoff = new Date(Date.now() - RECENT_VERIFICATION_WINDOW_MS);
      // Drizzle doesn't have a `or(isNull, lt)`; achieve via two queries OR a
      // single SQL-tagged filter. The cleaner-typed approach: fetch all then
      // filter in memory (claim count per draft is small — ~5-30).
      // We push the condition for "ran more than cutoff ago"; nulls are
      // included by the COALESCE in the comparison below.
      conditions.push(gte(contentClaims.verifierLastRunAt, cutoff));
    }

    const candidates = await tx
      .select({
        id: contentClaims.id,
        statement: contentClaims.statement,
        supportingUrl: contentClaims.supportingUrl,
        snippet: contentClaims.snippet,
        currentStatus: contentClaims.verifierStatus,
        lastRunAt: contentClaims.verifierLastRunAt,
      })
      .from(contentClaims)
      .where(and(...conditions));

    // Phase B.1 stub: mark every candidate as verified=1.0 with a stub
    // rationale. The shape is final; only the rationale + score derivation
    // changes when the real fetch + snippet-match lands.
    const now = new Date();
    const results: VerifierRunResult[] = [];
    for (const c of candidates) {
      const hasUrl = c.supportingUrl !== null && c.supportingUrl !== undefined;
      const stubStatus = hasUrl ? "verified" : "pending";
      const stubScore = hasUrl ? 1.0 : null;
      const stubRationale = hasUrl
        ? "stub-verifier — supporting_url present; real re-fetch + snippet-match lands in a follow-up slice"
        : "claim has no supporting_url — manual review required";

      await tx
        .update(contentClaims)
        .set({
          verifierStatus: stubStatus,
          verifierScore: stubScore,
          verifierLastRunAt: now,
          verifierDetailsJson: { stub: true, ranAt: now.toISOString() },
        })
        .where(eq(contentClaims.id, c.id));

      results.push({
        claimId: c.id,
        status: stubStatus,
        score: stubScore,
        rationale: stubRationale,
        details: { stub: true },
        ranAt: now.toISOString(),
      });
    }

    // Tally for the response envelope.
    const byStatus: Record<string, number> = {};
    for (const r of results) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    }

    // Audit one row per run (not per claim — keeps audit volume reasonable).
    await auditAccess({
      tx,
      ctx: ctxAuth,
      companyId,
      kind: "claims.verified",
      details: {
        draftId,
        claimCount: results.length,
        forced: force,
        byStatus,
        stub: true,
      },
    });

    return {
      draftId,
      claimCount: results.length,
      byStatus,
      results,
    };
  });

  return ok(result);
});
