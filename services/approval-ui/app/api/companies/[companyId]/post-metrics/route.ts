// POST /api/companies/:companyId/post-metrics
// USP 1 closed-loop performance ingestion — durable persistence path.
//
// Called by:
//   - performance-ingest /ingest (the production write path; complements
//     its Redpanda content.metric_update emission so the historical
//     record persists even if the bus loses messages)
//   - manual workspace-admin imports + replays (CSV uploads, backfills)
//
// Service-token auth required. RLS-scoped via withTenant — even with a
// valid service token, a tenant can only write its own metrics.
//
// Idempotency: post_metrics has no natural unique key (snapshots
// intentionally allow multiple rows per (draft, platform, snapshot_at)
// for fine-grained timelines). Caller-side dedup is the source of truth;
// performance-ingest handles it via the running-histograms append-then-
// rank pattern. This route trusts the input.
//
// Ratios (ctr, engagement_rate, conversion_rate) + percentiles are NOT
// computed here — they're filled by a nightly rollup or by performance-
// ingest's enrichment path. This route's job is durable raw-counts
// persistence.

import { type NextRequest } from "next/server";
import { z } from "zod";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { badRequest, validationFailed } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { postMetrics } from "@/lib/db/schema/post-metrics";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Mirrors performance-ingest/main.py::MetricSnapshot field-for-field so the
// Python service's pydantic model can serialise straight into this body
// without remapping.
const SnapshotSchema = z.object({
  draftId: z.string().uuid(),
  platform: z.string().min(1).max(40),
  // ISO-8601; defaults to server now() when omitted. Capped 5min in future
  // to match the meter-events backdating-defense pattern.
  snapshotAt: z.string().datetime().optional(),
  impressions: z.number().int().nonnegative().optional(),
  reach: z.number().int().nonnegative().optional(),
  clicks: z.number().int().nonnegative().optional(),
  reactions: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  shares: z.number().int().nonnegative().optional(),
  saves: z.number().int().nonnegative().optional(),
  conversions: z.number().int().nonnegative().optional(),
  raw: z.record(z.unknown()).optional(),
});

const BatchSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  snapshots: z.array(SnapshotSchema).min(1).max(1000),
});

interface RouteContext {
  params: Promise<{ companyId: string }>;
}

const FIVE_MIN_MS = 5 * 60 * 1000;

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

  const parsed = BatchSchema.safeParse(raw);
  if (!parsed.success) {
    validationFailed("invalid post-metrics payload", { issues: parsed.error.issues });
  }
  const body = parsed.data;

  // Reject claimed-future snapshotAt across the whole batch up front so
  // we never persist any row in a batch that contains poison data.
  // Backdating + rollup-skewing protection mirrors the meter-events
  // route's tolerance window.
  const now = Date.now();
  for (const s of body.snapshots) {
    if (s.snapshotAt) {
      const t = Date.parse(s.snapshotAt);
      if (!Number.isFinite(t) || t > now + FIVE_MIN_MS) {
        badRequest("snapshotAt must not be > 5 minutes in the future");
      }
    }
  }

  const result = await withTenant(companyId, async (tx) => {
    const rows = body.snapshots.map((s) => ({
      companyId,
      clientId: body.clientId ?? null,
      draftId: s.draftId,
      platform: s.platform,
      snapshotAt: s.snapshotAt ? new Date(s.snapshotAt) : new Date(),
      impressions: s.impressions ?? null,
      reach: s.reach ?? null,
      clicks: s.clicks ?? null,
      reactions: s.reactions ?? null,
      comments: s.comments ?? null,
      shares: s.shares ?? null,
      saves: s.saves ?? null,
      conversions: s.conversions ?? null,
      raw: s.raw ?? {},
    }));

    const inserted = await tx
      .insert(postMetrics)
      .values(rows)
      .returning({ id: postMetrics.id });

    // One audit row per batch (not per snapshot) — at high ingest volume
    // a per-row audit would dwarf the metric data itself. Surfaced fields
    // let an operator confirm a batch's shape without joining to
    // post_metrics directly.
    await auditAccess({
      tx,
      ctx: ctxAuth,
      companyId,
      kind: "post_metrics.written",
      details: {
        batchSize: rows.length,
        insertedCount: inserted.length,
        clientId: body.clientId ?? null,
        // Sample first/last for quick ops sanity-check; never the full
        // batch (could be 1000 rows).
        firstDraftId: rows[0]?.draftId ?? null,
        lastDraftId: rows[rows.length - 1]?.draftId ?? null,
      },
    });

    return { insertedCount: inserted.length };
  });

  return ok(result);
});
