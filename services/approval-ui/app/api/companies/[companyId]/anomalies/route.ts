// GET /api/companies/:companyId/anomalies?lookback_hours=24&z_threshold=2.5
// Mission Control's anomaly-alerts tile — surfaces drafts whose latest
// snapshot deviates >z_threshold σ from the workspace's running mean.
// Doc 4 §2.2 step 3.
//
// Proxies performance-ingest's POST /anomaly/scan, scoping by
// companyId from the URL param. Same auth + audit pattern as the
// experiments + post-metrics routes.
//
// Why GET on the proxy + POST on the underlying service: the tile is
// fundamentally a read view (no mutation), and HTTP caching + CDN
// edge-cache rules play nicer with GET. The body→query translation
// happens here.

import { type NextRequest } from "next/server";
import { z } from "zod";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { badRequest, validationFailed } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const QuerySchema = z.object({
  lookbackHours: z.coerce.number().int().min(1).max(168).default(24),
  zThreshold: z.coerce.number().min(0.5).max(10).default(2.5),
  clientId: z.string().uuid().optional(),
});

interface RouteContext {
  params: Promise<{ companyId: string }>;
}

const PERFORMANCE_INGEST_BASE_URL = process.env.PERFORMANCE_INGEST_BASE_URL;
const SERVICE_TOKEN = process.env.SERVICE_TOKEN;
const SERVICE_NAME = "approval-ui";
const PROXY_TIMEOUT_MS = 5000;

// Detection shape from performance-ingest's AnomalyDetection pydantic model.
// Mirrored on the client in components/mission-control/AnomaliesTile.tsx.
type Detection = {
  draft_id: string;
  platform: string;
  metric: string;
  z_score: number;
  value: number;
  rolling_mean: number;
  rolling_std: number;
  detected_at: string;
};

export const GET = withApi(async (req: NextRequest, ctx: RouteContext) => {
  const ctxAuth = await resolveServiceOrSession(req.headers);
  const { companyId } = await ctx.params;

  if (!isUuid(companyId)) badRequest("invalid companyId");
  if (ctxAuth.activeCompanyId !== companyId) {
    badRequest("active workspace does not match URL param");
  }

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    lookbackHours: url.searchParams.get("lookback_hours") ?? undefined,
    zThreshold: url.searchParams.get("z_threshold") ?? undefined,
    clientId: url.searchParams.get("client_id") ?? undefined,
  });
  if (!parsed.success) {
    validationFailed("invalid anomalies query", { issues: parsed.error.issues });
  }
  const { lookbackHours, zThreshold, clientId } = parsed.data;

  await withTenant(companyId, async (tx) => {
    await auditAccess({
      tx,
      ctx: ctxAuth,
      companyId,
      kind: "anomalies.listed",
      details: { lookbackHours, zThreshold, clientId: clientId ?? null },
    });
  });

  if (!PERFORMANCE_INGEST_BASE_URL || !SERVICE_TOKEN) {
    return ok({
      companyId,
      lookbackHours,
      zThreshold,
      detections: [] as Detection[],
      skipped: true,
    });
  }

  const ingestUrl = `${PERFORMANCE_INGEST_BASE_URL.replace(/\/$/, "")}/anomaly/scan`;
  let resp: Response;
  try {
    resp = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Clipstack-Service-Token": SERVICE_TOKEN,
        "X-Clipstack-Active-Company": companyId,
        "X-Clipstack-Service-Name": SERVICE_NAME,
      },
      body: JSON.stringify({
        company_id: companyId,
        client_id: clientId ?? null,
        lookback_hours: lookbackHours,
        z_threshold: zThreshold,
      }),
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
  } catch (err) {
    // Same observability pattern as /api/companies/:cid/experiments —
    // surface the cause to logs so a wedged backend doesn't hide as a
    // quietly empty Anomalies tile.
    console.error("[api/anomalies] performance-ingest unreachable", {
      companyId,
      ingestUrl,
      err,
    });
    return ok({
      companyId,
      lookbackHours,
      zThreshold,
      detections: [] as Detection[],
      skipped: true,
    });
  }

  if (!resp.ok) {
    return ok({
      companyId,
      lookbackHours,
      zThreshold,
      detections: [] as Detection[],
      skipped: true,
    });
  }

  const payload = (await resp.json()) as {
    detections?: Detection[];
    skipped?: boolean;
  };

  return ok({
    companyId,
    lookbackHours,
    zThreshold,
    detections: payload.detections ?? [],
    skipped: payload.skipped ?? false,
  });
});
