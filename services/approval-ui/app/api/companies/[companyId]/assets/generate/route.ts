// POST /api/companies/:companyId/assets/generate
// Generic asset-generation dispatcher. Body:
//   { source, brief, kind, aspectRatio?, durationSec?, voiceId?, refs? }
//
// Routes by `source` to the appropriate adapter from lib/asset-adapters/
// registry. Free composers (satori, motion, hyperframes) execute immediately;
// metered providers fire in the background and the route returns 202 with
// the artifact id so the UI can poll.
//
// Cost-policy enforcement: METERED adapters cannot be triggered by the
// agent crew without per-call user approval. The route checks for the
// x-agent-trigger header and rejects if the resolved adapter is METERED
// or EXPENSIVE — agents go through the approval queue instead.

import { type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { badRequest, validationFailed, forbidden } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { artifacts } from "@/lib/db/schema/artifacts";
import { meterEvents } from "@/lib/db/schema/metering";
import { getAdapter } from "@/lib/asset-adapters/registry";
import { AssetAdapterError } from "@/lib/asset-adapters/types";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  source: z.string().min(1).max(40),
  brief: z.string().min(1).max(4000),
  kind: z.enum(["video", "image", "audio"]),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:5"]).optional(),
  durationSec: z.coerce.number().int().min(1).max(120).optional(),
  voiceId: z.string().max(100).optional(),
  refs: z.array(z.string().url()).max(8).optional(),
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

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    validationFailed("invalid generate body", { issues: parsed.error.issues });
  }
  const { source, brief, kind, aspectRatio, durationSec, voiceId, refs } = parsed.data;

  const adapter = getAdapter(source);
  if (!adapter) {
    badRequest(`unknown adapter source: ${source}`);
  }
  if (!adapter.kinds.includes(kind)) {
    badRequest(`adapter ${source} does not support kind=${kind}`);
  }

  // Cost-policy enforcement: agent-triggered calls cannot land on METERED
  // or EXPENSIVE adapters without a queued approval. The header is set by
  // the heartbeat dispatcher when an agent invokes asset.generate; humans
  // hitting /studio don't carry it, so the route handles them directly.
  const isAgentTriggered =
    req.headers.get("x-agent-trigger") === "true" ||
    req.headers.get("x-heartbeat-trigger") === "true";
  if (isAgentTriggered && adapter.costClass !== "free") {
    forbidden(
      `cost-policy: agent-triggered ${adapter.costClass} call to ${adapter.type} requires user approval. Route through the approval queue.`,
    );
  }

  // Insert the artifact row in queued state; persist across both sync and
  // async adapters so the /studio page lists it consistently.
  const insertedId = await withTenant(companyId, async (tx) => {
    await auditAccess({
      tx,
      ctx: ctxAuth,
      companyId,
      kind: "artifact.queued",
      details: { source, kind, costClass: adapter.costClass, brief: brief.slice(0, 80) },
    });
    const [row] = await tx
      .insert(artifacts)
      .values({
        companyId,
        kind,
        source,
        title: brief.slice(0, 80),
        prompt: brief,
        status: "queued",
        providerMeta: {
          aspectRatio: aspectRatio ?? null,
          durationSec: durationSec ?? null,
          voiceId: voiceId ?? null,
        },
        costUsd: 0,
      })
      .returning({ id: artifacts.id });
    return row?.id ?? null;
  });

  if (!insertedId) badRequest("failed to enqueue generation");

  // Fire the actual generation. Free composers run synchronously so the
  // user sees the result immediately; metered providers run in background
  // (because their async polling can take 30-90s).
  if (adapter.costClass === "free") {
    await runGeneration(companyId, insertedId, adapter, {
      brief,
      kind,
      aspectRatio,
      durationSec,
      voiceId,
      refs,
    });
    return ok({ companyId, jobId: insertedId, status: "complete" });
  }

  void runGeneration(companyId, insertedId, adapter, {
    brief,
    kind,
    aspectRatio,
    durationSec,
    voiceId,
    refs,
  });
  return ok({ companyId, jobId: insertedId, status: "queued" }, { status: 202 });
});

async function runGeneration(
  companyId: string,
  jobId: string,
  adapter: ReturnType<typeof getAdapter>,
  input: {
    brief: string;
    kind: "video" | "image" | "audio";
    aspectRatio?: string;
    durationSec?: number;
    voiceId?: string;
    refs?: string[];
  },
): Promise<void> {
  if (!adapter) return;

  // Mark rendering. Best-effort — main work is the actual generation call.
  try {
    await withTenant(companyId, async (tx) => {
      await tx.update(artifacts).set({ status: "rendering" }).where(eq(artifacts.id, jobId));
    });
  } catch (err) {
    console.error("[assets/generate] rendering-state flip failed", { jobId, err });
  }

  try {
    const result = await adapter.generate({
      brief: input.brief,
      kind: input.kind,
      aspectRatio: input.aspectRatio,
      durationSec: input.durationSec,
      voiceId: input.voiceId,
      refs: input.refs,
    });

    await withTenant(companyId, async (tx) => {
      // Write a meter_event for METERED+EXPENSIVE; FREE adapters skip the
      // meter row because they're at $0.
      let meterEventId: string | null = null;
      if (adapter.costClass !== "free" && result.costUsd > 0) {
        const [meter] = await tx
          .insert(meterEvents)
          .values({
            companyId,
            kind: "metered_asset_generation",
            quantity: 1,
            unitCostUsd: result.costUsd,
            totalCostUsd: result.costUsd,
            refKind: "artifact",
            refId: jobId,
            occurredAt: new Date(),
          })
          .returning({ id: meterEvents.id });
        meterEventId = meter?.id ?? null;
      }

      await tx
        .update(artifacts)
        .set({
          status: "complete",
          mediaUrl: result.mediaUrl,
          mediaMimeType: result.mediaMimeType,
          providerMeta: {
            ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
            ...(input.durationSec ? { durationSec: input.durationSec } : {}),
            ...result.meta,
            providerModelId: result.providerModelId,
            completedAt: new Date().toISOString(),
          },
          costUsd: result.costUsd,
          meterEventId,
        })
        .where(eq(artifacts.id, jobId));
    });
  } catch (err) {
    const message =
      err instanceof AssetAdapterError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[assets/generate] generation failed", { jobId, source: adapter.type, message });
    try {
      await withTenant(companyId, async (tx) => {
        await tx
          .update(artifacts)
          .set({ status: "failed", errorMessage: message.slice(0, 1800) })
          .where(eq(artifacts.id, jobId));
      });
    } catch (writeErr) {
      console.error("[assets/generate] failure-state write failed", { jobId, writeErr });
    }
  }
}
