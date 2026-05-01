// GET /api/companies/:companyId/drafts/:draftId/revisions
// Phase B.4 — branch view backing.
//
// Returns the full revision tree for a draft, ordered by created_at ascending.
// The component nests by parent_revision_id; this route just hands back a
// flat list and lets the client structure it. Most cases are linear (1-3
// revisions in a chain).
//
// Auth: service-token or session. RLS-scoped via withTenant.

import { type NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { badRequest, notFound } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { draftRevisions } from "@/lib/db/schema/draft-revisions";
import { drafts } from "@/lib/db/schema/drafts";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ companyId: string; draftId: string }>;
}

const BODY_EXCERPT_LEN = 500;

export const GET = withApi(async (req: NextRequest, ctx: RouteContext) => {
  const ctxAuth = await resolveServiceOrSession(req.headers);
  const { companyId, draftId } = await ctx.params;

  if (!isUuid(companyId)) badRequest("invalid companyId");
  if (!isUuid(draftId)) badRequest("invalid draftId");
  if (ctxAuth.activeCompanyId !== companyId) {
    badRequest("active workspace does not match URL param");
  }

  const result = await withTenant(companyId, async (tx) => {
    // Confirm draft exists in this tenant. RLS hides cross-tenant reads;
    // we still 404 explicitly so the response shape distinguishes
    // "no draft" from "draft has zero revisions yet".
    const [existingDraft] = await tx
      .select({ id: drafts.id })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .limit(1);
    if (!existingDraft) notFound("draft not found");

    const rows = await tx
      .select({
        id: draftRevisions.id,
        parentRevisionId: draftRevisions.parentRevisionId,
        revisionNumber: draftRevisions.revisionNumber,
        body: draftRevisions.body,
        voiceScore: draftRevisions.voiceScore,
        voicePasses: draftRevisions.voicePasses,
        predictedPercentile: draftRevisions.predictedPercentile,
        predictedPercentileLow: draftRevisions.predictedPercentileLow,
        predictedPercentileHigh: draftRevisions.predictedPercentileHigh,
        criticNotes: draftRevisions.criticNotes,
        reviewVerdict: draftRevisions.reviewVerdict,
        authoredByAgentId: draftRevisions.authoredByAgentId,
        langgraphRunId: draftRevisions.langgraphRunId,
        createdAt: draftRevisions.createdAt,
      })
      .from(draftRevisions)
      .where(eq(draftRevisions.draftId, draftId))
      .orderBy(asc(draftRevisions.createdAt));

    await auditAccess({
      tx,
      ctx: ctxAuth,
      companyId,
      kind: "drafts.read.revisions",
      details: { draftId, revisionCount: rows.length },
    });

    return {
      draftId,
      revisionCount: rows.length,
      revisions: rows.map((r) => ({
        id: r.id,
        parentRevisionId: r.parentRevisionId,
        revisionNumber: r.revisionNumber,
        // Trim body to keep response small; full body fetched on-demand
        // by a separate /revisions/[id] route when the user clicks Expand.
        bodyExcerpt: excerpt(r.body, BODY_EXCERPT_LEN),
        voiceScore: r.voiceScore,
        voicePasses: r.voicePasses,
        predictedPercentile: r.predictedPercentile,
        predictedPercentileLow: r.predictedPercentileLow,
        predictedPercentileHigh: r.predictedPercentileHigh,
        criticNotes: r.criticNotes,
        reviewVerdict: r.reviewVerdict,
        authoredByAgentId: r.authoredByAgentId,
        langgraphRunId: r.langgraphRunId,
        createdAt: r.createdAt,
      })),
    };
  });

  return ok(result);
});

function excerpt(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
