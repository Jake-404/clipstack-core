// GET /api/companies/:companyId/drafts/high-performers
// USP 1 closed-loop — return this workspace's drafts that scored in the top
// percentile on a given KPI for the given platform/topic. Consumed by:
//   - agent-crewai's `retrieve_high_performers` tool (Strategist + LongFormWriter)
//   - approval-ui Mission Control "what's worked" tile (planned)
//
// Phase A.2 simple version: ranks by absolute KPI value within the percentile
// filter. Topic-vector cosine similarity adds in a follow-up slice once the
// embedding service is wired (USP 3 voice-scorer slice ships the embed model).

import { type NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { embed, vectorLiteral } from "@/lib/api/embeddings";
import { badRequest, forbidden, validationFailed } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { contentEmbeddings } from "@/lib/db/schema/content-embeddings";
import { drafts } from "@/lib/db/schema/drafts";
import { postMetrics } from "@/lib/db/schema/post-metrics";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Query schema ────────────────────────────────────────────────────────

const KpiSchema = z.enum(["ctr", "engagement_rate", "conversion_rate"]);
type Kpi = z.infer<typeof KpiSchema>;

const PlatformSchema = z.enum([
  "x",
  "linkedin",
  "reddit",
  "tiktok",
  "instagram",
  "newsletter",
  "blog",
]);

const QuerySchema = z.object({
  kpi: KpiSchema.default("engagement_rate"),
  // Workspace-relative percentile floor — returns drafts at OR ABOVE this
  // percentile within the workspace. 75 = top quartile.
  percentile: z
    .coerce.number()
    .int()
    .min(50)
    .max(99)
    .default(75),
  k: z.coerce.number().int().min(1).max(20).default(3),
  platform: PlatformSchema.optional(),
  // Reserved for vector-similarity ranking once embeddings ship; currently
  // ignored by the route. Tool consumers pass it for forward compatibility.
  topic: z.string().min(1).max(500).optional(),
});

// ─── Route ───────────────────────────────────────────────────────────────

interface RouteContext {
  params: Promise<{ companyId: string }>;
}

export const GET = withApi(async (req: NextRequest, ctx: RouteContext) => {
  const ctxAuth = await resolveServiceOrSession(req.headers);
  const { companyId } = await ctx.params;

  if (!isUuid(companyId)) badRequest("invalid companyId");

  // Authorisation — caller's active workspace must match the URL param.
  // Service tokens carry the active company in their context; user sessions
  // carry the user's chosen workspace.
  if (ctxAuth.activeCompanyId !== companyId) {
    forbidden("active workspace does not match URL param");
  }

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    kpi: url.searchParams.get("kpi") ?? undefined,
    percentile: url.searchParams.get("percentile") ?? undefined,
    k: url.searchParams.get("k") ?? undefined,
    platform: url.searchParams.get("platform") ?? undefined,
    topic: url.searchParams.get("topic") ?? undefined,
  });
  if (!parsed.success) {
    validationFailed("invalid query parameters", { issues: parsed.error.issues });
  }

  const { kpi, percentile, k, platform, topic } = parsed.data;
  const percentileColumn = percentileColumnFor(kpi);
  const valueColumn = valueColumnFor(kpi);

  // When a topic is supplied, embed it once outside withTenant and use it
  // to cosine-rerank the candidate set. Without a topic, fall back to
  // ordering by absolute KPI value (the A.2 behaviour). The embed call is
  // outside the tenant txn so the network roundtrip doesn't hold a
  // transaction open.
  let topicVecLiteral: string | null = null;
  if (topic) {
    try {
      topicVecLiteral = vectorLiteral(await embed(topic));
    } catch (e) {
      // Fail-soft: if LiteLLM is unreachable, log the cause and fall back
      // to KPI-only ranking. The agent's prompt still gets useful results;
      // it just doesn't get the topic-aware re-rank that day.
      console.warn(
        "[high-performers] embed failed, falling back to KPI-only ranking",
        e instanceof Error ? e.message : e,
      );
      topicVecLiteral = null;
    }
  }

  const rows = await withTenant(companyId, async (tx) => {
    const conditions = [
      eq(drafts.companyId, companyId),
      eq(drafts.status, "published"),
      gte(percentileColumn, percentile),
      isNotNull(valueColumn),
    ];
    if (platform) conditions.push(eq(postMetrics.platform, platform));

    if (topicVecLiteral) {
      // Topic-aware path: blend KPI percentile (workspace-relative
      // performance) with cosine similarity to the topic. Score formula:
      //   0.6 * (kpi_percentile / 100) + 0.4 * (1 - cosine_distance)
      // Tunable via workspace config later; A.3 default 60/40 favours
      // proven performance over topic match.
      const distanceExpr = sql`${contentEmbeddings.embedding} <=> ${topicVecLiteral}::vector`;
      const scoreExpr = sql<number>`
        0.6 * (${percentileColumn} / 100.0) + 0.4 * (1.0 - (${distanceExpr}))
      `;

      const result = await tx
        .select({
          draftId: drafts.id,
          channel: drafts.channel,
          title: drafts.title,
          body: drafts.body,
          publishedAt: drafts.publishedAt,
          publishedUrl: drafts.publishedUrl,
          kpiValue: valueColumn,
          kpiPercentile: percentileColumn,
          snapshotAt: postMetrics.snapshotAt,
          blendedScore: scoreExpr,
        })
        .from(drafts)
        .innerJoin(postMetrics, eq(postMetrics.draftId, drafts.id))
        .innerJoin(contentEmbeddings, eq(contentEmbeddings.draftId, drafts.id))
        .where(and(...conditions))
        .orderBy(desc(scoreExpr))
        .limit(k);

      await auditAccess({
        tx,
        ctx: ctxAuth,
        companyId,
        kind: "drafts.read.high_performers",
        details: {
          kpi,
          percentile,
          k,
          platform: platform ?? null,
          topic: topic ?? null,
          rankingMode: "topic_blended",
          resultCount: result.length,
        },
      });
      return { rows: result, mode: "topic_blended" as const };
    }

    // KPI-only path (no topic OR embed failed).
    const result = await tx
      .select({
        draftId: drafts.id,
        channel: drafts.channel,
        title: drafts.title,
        body: drafts.body,
        publishedAt: drafts.publishedAt,
        publishedUrl: drafts.publishedUrl,
        kpiValue: valueColumn,
        kpiPercentile: percentileColumn,
        snapshotAt: postMetrics.snapshotAt,
        blendedScore: sql<number | null>`NULL::DOUBLE PRECISION`,
      })
      .from(drafts)
      .innerJoin(postMetrics, eq(postMetrics.draftId, drafts.id))
      .where(and(...conditions))
      .orderBy(desc(valueColumn))
      .limit(k);

    await auditAccess({
      tx,
      ctx: ctxAuth,
      companyId,
      kind: "drafts.read.high_performers",
      details: {
        kpi,
        percentile,
        k,
        platform: platform ?? null,
        topic: topic ?? null,
        rankingMode: "kpi_only",
        embedFailedFallback: Boolean(topic && !topicVecLiteral),
        resultCount: result.length,
      },
    });
    return { rows: result, mode: "kpi_only" as const };
  });

  return ok({
    kpi,
    percentile,
    k,
    platform: platform ?? null,
    topic: topic ?? null,
    rankingMode: rows.mode,
    results: rows.rows.map((r) => ({
      draftId: r.draftId,
      channel: r.channel,
      title: r.title,
      bodyExcerpt: excerpt(r.body, 240),
      publishedAt: r.publishedAt,
      publishedUrl: r.publishedUrl,
      kpiValue: r.kpiValue,
      kpiPercentile: r.kpiPercentile,
      snapshotAt: r.snapshotAt,
      blendedScore: r.blendedScore,
    })),
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────

function percentileColumnFor(kpi: Kpi) {
  switch (kpi) {
    case "ctr":
      return postMetrics.ctrPercentile;
    case "engagement_rate":
      return postMetrics.engagementPercentile;
    case "conversion_rate":
      return postMetrics.conversionPercentile;
  }
}

function valueColumnFor(kpi: Kpi) {
  switch (kpi) {
    case "ctr":
      return postMetrics.ctr;
    case "engagement_rate":
      return postMetrics.engagementRate;
    case "conversion_rate":
      return postMetrics.conversionRate;
  }
}

function excerpt(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
