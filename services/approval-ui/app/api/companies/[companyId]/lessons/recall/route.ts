// POST /api/companies/:companyId/lessons/recall
// USP 5 editorial memory recall — cosine-similarity query against the
// workspace's `company_lessons.embedding` column (vector(384), ivfflat
// index since 0007).
//
// Consumed by:
//   - agent-crewai's `recall_lessons` tool (Strategist + LongFormWriter
//     + DevilsAdvocateQA + ClaimVerifier + BrandQA all use it; injected
//     into agent system prompts via the "What this team has learned"
//     block in buildSystemPrompt())
//   - approval-ui Mission Control "what your team learned this week"
//     surface (planned)
//
// Auth: service-token or session. RLS-scoped via withTenant (so even with
// a valid service token, a tenant can only recall its own lessons).
//
// Embedding flow:
//   1. Caller posts { topic: "...", k?, scope?, clientId? }
//   2. Route embeds `topic` via LiteLLM voice-embed profile (384-dim).
//   3. Cosine query: ORDER BY embedding <=> $vector (pgvector smallest-
//      first = most similar first).
//   4. Optional scope filter (forever | this_topic | this_client).
//   5. Audit one row per call; return top-K with similarity scores.

import { type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { badRequest, validationFailed } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { embed, vectorLiteral } from "@/lib/api/embeddings";
import { withTenant } from "@/lib/db/client";
import { companyLessons } from "@/lib/db/schema/lessons";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RecallBodySchema = z.object({
  topic: z.string().min(1).max(2000),
  k: z.number().int().min(1).max(20).default(5),
  scope: z.enum(["forever", "this_topic", "this_client"]).optional(),
  clientId: z.string().uuid().nullable().optional(),
});

interface RouteContext {
  params: Promise<{ companyId: string }>;
}

export const POST = withApi(async (req: NextRequest, ctx: RouteContext) => {
  const ctxAuth = await resolveServiceOrSession(req.headers);
  const { companyId } = await ctx.params;

  if (!isUuid(companyId)) badRequest("invalid companyId");
  if (ctxAuth.activeCompanyId !== companyId) {
    badRequest("active workspace does not match URL param");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    badRequest("body must be valid JSON");
  }
  const parsed = RecallBodySchema.safeParse(raw);
  if (!parsed.success) {
    validationFailed("invalid recall request", { issues: parsed.error.issues });
  }
  const { topic, k, scope, clientId } = parsed.data;

  // Embed outside withTenant — no DB needed for the LiteLLM call, and the
  // network roundtrip shouldn't hold a tenant-bound transaction open.
  const queryVec = await embed(topic);
  const queryLiteral = vectorLiteral(queryVec);

  const result = await withTenant(companyId, async (tx) => {
    // Drizzle doesn't ship a pgvector operator; use the sql template tag.
    // Cast `$1` to vector explicitly so postgres-js binds it as the right
    // type. Sort smallest-first (closest cosine distance = most similar).
    const distanceExpr = sql`${companyLessons.embedding} <=> ${queryLiteral}::vector`;

    const conditions = [
      eq(companyLessons.companyId, companyId),
      isNotNull(companyLessons.embedding),
    ];
    if (scope) conditions.push(eq(companyLessons.scope, scope));
    // If the caller is asking for client-scoped lessons, filter further.
    // null clientId means "agency-level only" — skip the client filter.
    if (scope === "this_client" && clientId) {
      conditions.push(eq(companyLessons.clientId, clientId));
    }

    const rows = await tx
      .select({
        id: companyLessons.id,
        kind: companyLessons.kind,
        scope: companyLessons.scope,
        rationale: companyLessons.rationale,
        topicTags: companyLessons.topicTags,
        clientId: companyLessons.clientId,
        capturedByUserId: companyLessons.capturedByUserId,
        capturedByAgentId: companyLessons.capturedByAgentId,
        capturedAt: companyLessons.capturedAt,
        // Distance is 0 (identical) → 1 (orthogonal) for cosine. Convert
        // to similarity = 1 - distance for the response so the agent's
        // mental model matches its system prompt language.
        similarity: sql<number>`1.0 - (${distanceExpr})`,
      })
      .from(companyLessons)
      .where(and(...conditions))
      .orderBy(distanceExpr)
      .limit(k);

    await auditAccess({
      tx,
      ctx: ctxAuth,
      companyId,
      kind: "lessons.recalled",
      details: {
        topicLength: topic.length,
        scope: scope ?? null,
        clientId: clientId ?? null,
        k,
        resultCount: rows.length,
      },
    });

    return rows;
  });

  return ok({
    topic_excerpt: topic.slice(0, 240),
    scope: scope ?? null,
    k,
    resultCount: result.length,
    lessons: result,
  });
});
