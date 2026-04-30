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
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { badRequest, forbidden, validationFailed } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { drafts } from "@/lib/db/schema/drafts";
import { postMetrics } from "@/lib/db/schema/post-metrics";

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

  if (!UUID_RE.test(companyId)) badRequest("invalid companyId");

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

  const rows = await withTenant(companyId, async (tx) => {
    const conditions = [
      eq(drafts.companyId, companyId),
      eq(drafts.status, "published"),
      gte(percentileColumn, percentile),
      isNotNull(valueColumn),
    ];
    if (platform) conditions.push(eq(postMetrics.platform, platform));

    return tx
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
      })
      .from(drafts)
      .innerJoin(postMetrics, eq(postMetrics.draftId, drafts.id))
      .where(and(...conditions))
      .orderBy(desc(valueColumn))
      .limit(k);
  });

  return ok({
    kpi,
    percentile,
    k,
    platform: platform ?? null,
    // Topic returned in the response so callers can confirm what was searched
    // even though A.2 doesn't yet use it for ranking.
    topic: topic ?? null,
    results: rows.map((r) => ({
      draftId: r.draftId,
      channel: r.channel,
      title: r.title,
      bodyExcerpt: excerpt(r.body, 240),
      publishedAt: r.publishedAt,
      publishedUrl: r.publishedUrl,
      kpiValue: r.kpiValue,
      kpiPercentile: r.kpiPercentile,
      snapshotAt: r.snapshotAt,
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
