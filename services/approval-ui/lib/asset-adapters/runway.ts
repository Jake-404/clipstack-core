// Runway Gen-3 adapter — text→video.
//
// Best-in-class for general-purpose text-to-video with tight motion +
// strong prompt adherence. Pricing: ~$0.05/second of output ≈ $1-3 per
// 5-10s clip. Async API (submit + poll). 60s typical render.

import {
  AssetAdapterError,
  requireApiKey,
  type AssetAdapter,
  type AssetGenerateInput,
  type AssetGenerateResult,
} from "./types";
import { placeholderResponse, pollUntilReady } from "./_shared";

const APPROX_COST_USD = 1.50;
const DEFAULT_MODEL = "gen3a-turbo";
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 5 * 60_000; // 5 min — Gen-3 typically 30-90s

export const runwayAdapter: AssetAdapter = {
  type: "runway",
  kinds: ["video"],
  providerName: "Runway Gen-3",
  costClass: "metered",
  apiKeyEnvVar: "RUNWAY_API_KEY",
  approxCostUsd: APPROX_COST_USD,
  notes: "Text→video, tight motion, strong prompt adherence. ~$0.05/sec output.",
  docsUrl: "https://docs.dev.runwayml.com/",

  async generate(input: AssetGenerateInput): Promise<AssetGenerateResult> {
    if (!process.env.RUNWAY_API_KEY && !input.apiKey) {
      return placeholderResponse({
        adapterType: "runway",
        providerModelId: DEFAULT_MODEL,
        approxCostUsd: APPROX_COST_USD,
        kind: "video",
      });
    }

    const apiKey = requireApiKey(runwayAdapter, input);
    const duration = Math.max(5, Math.min(10, input.durationSec ?? 5));
    const aspect = input.aspectRatio ?? "16:9";

    // Submit
    const submit = await fetch("https://api.dev.runwayml.com/v1/text_to_video", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Runway-Version": "2024-11-06",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        promptText: input.brief.slice(0, 1000),
        model: DEFAULT_MODEL,
        duration,
        ratio: aspect.replace(":", ":"),
      }),
      signal: input.signal,
    });
    if (!submit.ok) {
      throw new AssetAdapterError(
        `runway submit: HTTP ${submit.status} — ${(await submit.text()).slice(0, 400)}`,
        "runway",
      );
    }
    const job = (await submit.json()) as { id: string };

    // Poll
    const final = await pollUntilReady<{ id: string; status: string; output?: string[]; failure?: string }>({
      intervalMs: POLL_INTERVAL_MS,
      timeoutMs: POLL_TIMEOUT_MS,
      signal: input.signal,
      adapterType: "runway",
      fetchStatus: async () => {
        const r = await fetch(`https://api.dev.runwayml.com/v1/tasks/${job.id}`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "X-Runway-Version": "2024-11-06",
          },
          signal: input.signal,
        });
        if (!r.ok) {
          throw new AssetAdapterError(
            `runway poll: HTTP ${r.status} — ${(await r.text()).slice(0, 400)}`,
            "runway",
          );
        }
        return (await r.json()) as { id: string; status: string; output?: string[]; failure?: string };
      },
      isComplete: (s) => s.status === "SUCCEEDED" && Array.isArray(s.output) && s.output.length > 0,
      isFailed: (s) => (s.status === "FAILED" ? s.failure ?? "render failed" : null),
    });

    const url = final.output?.[0];
    if (!url) {
      throw new AssetAdapterError(`runway: no output URL after poll completion`, "runway");
    }

    return {
      mediaUrl: url,
      mediaMimeType: "video/mp4",
      providerModelId: DEFAULT_MODEL,
      costUsd: APPROX_COST_USD,
      meta: {
        aspectRatio: aspect,
        durationSec: duration,
        runwayId: job.id,
      },
    };
  },
};
