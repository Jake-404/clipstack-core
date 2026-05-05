// Hyperframes shim — exposes the existing Hyperframes runner under the
// AssetAdapter contract. Hyperframes already has its own /api/.../hyperframes/
// route + runner module; this shim is just for the adapter registry so
// /studio's cost-policy table + the future generic /assets/generate
// dispatcher can reference Hyperframes the same way they reference the
// other free composers.
//
// Renders still go through the existing /hyperframes/render route by
// preference (it has the queued/rendering/complete state machine the UI
// polls); calling generate() here invokes the runner directly and
// returns a single result without persisting an artifact row — the
// caller is expected to handle persistence.

import { renderHyperframes } from "@/lib/hyperframes/runner";
import { randomUUID } from "node:crypto";

import {
  type AssetAdapter,
  type AssetGenerateInput,
  type AssetGenerateResult,
} from "./types";

export const hyperframesAdapterShim: AssetAdapter = {
  type: "hyperframes",
  kinds: ["video"],
  providerName: "Clipstack Hyperframes",
  costClass: "free",
  approxCostUsd: 0,
  notes:
    "HTML→MP4 via npx hyperframes (CLI sidecar). Higher-fidelity typography than Motion (headless Chrome). Requires Node 22+ + ffmpeg + npx.",
  docsUrl: "https://hyperframes.heygen.com/",

  async generate(input: AssetGenerateInput): Promise<AssetGenerateResult> {
    const jobId = randomUUID();
    const aspect = (input.aspectRatio as "16:9" | "9:16" | "1:1" | "4:5") ?? "16:9";
    const durationSec = Math.max(5, Math.min(60, input.durationSec ?? 10));

    const result = await renderHyperframes({
      jobId,
      prompt: input.brief,
      durationSec,
      aspectRatio: aspect,
    });

    return {
      mediaUrl: result.publicUrl,
      mediaMimeType: "video/mp4",
      providerModelId: "hyperframes-canonical-v1",
      costUsd: 0,
      meta: {
        aspectRatio: aspect,
        durationSec: result.durationSec,
        appliedStyleKey: result.appliedStyleKey,
      },
    };
  },
};
