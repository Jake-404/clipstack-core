// Luma Dream Machine adapter — text→video, longer takes.
//
// 5-9 second takes with realistic camera physics. Pricing: ~$0.50 per
// generation. Async API (submit + poll). 30-90s typical render.

import {
  AssetAdapterError,
  requireApiKey,
  type AssetAdapter,
  type AssetGenerateInput,
  type AssetGenerateResult,
} from "./types";
import { placeholderResponse, pollUntilReady } from "./_shared";

const APPROX_COST_USD = 0.50;
const DEFAULT_MODEL = "ray-2";
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

export const lumaAdapter: AssetAdapter = {
  type: "luma",
  kinds: ["video"],
  providerName: "Luma Dream Machine",
  costClass: "metered",
  apiKeyEnvVar: "LUMA_API_KEY",
  approxCostUsd: APPROX_COST_USD,
  notes: "Long takes (5-9s), realistic camera physics. ~$0.50/clip.",
  docsUrl: "https://docs.lumalabs.ai/",

  async generate(input: AssetGenerateInput): Promise<AssetGenerateResult> {
    if (!process.env.LUMA_API_KEY && !input.apiKey) {
      return placeholderResponse({
        adapterType: "luma",
        providerModelId: DEFAULT_MODEL,
        approxCostUsd: APPROX_COST_USD,
        kind: "video",
      });
    }

    const apiKey = requireApiKey(lumaAdapter, input);
    const aspect = input.aspectRatio ?? "16:9";

    const submit = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: input.brief.slice(0, 1000),
        aspect_ratio: aspect,
        loop: false,
      }),
      signal: input.signal,
    });
    if (!submit.ok) {
      throw new AssetAdapterError(
        `luma submit: HTTP ${submit.status} — ${(await submit.text()).slice(0, 400)}`,
        "luma",
      );
    }
    const job = (await submit.json()) as { id: string };

    const final = await pollUntilReady<{
      id: string;
      state: string;
      assets?: { video?: string };
      failure_reason?: string;
    }>({
      intervalMs: POLL_INTERVAL_MS,
      timeoutMs: POLL_TIMEOUT_MS,
      signal: input.signal,
      adapterType: "luma",
      fetchStatus: async () => {
        const r = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${job.id}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: input.signal,
        });
        if (!r.ok) {
          throw new AssetAdapterError(
            `luma poll: HTTP ${r.status} — ${(await r.text()).slice(0, 400)}`,
            "luma",
          );
        }
        return (await r.json()) as { id: string; state: string; assets?: { video?: string }; failure_reason?: string };
      },
      isComplete: (s) => s.state === "completed" && Boolean(s.assets?.video),
      isFailed: (s) => (s.state === "failed" ? s.failure_reason ?? "render failed" : null),
    });

    const url = final.assets?.video;
    if (!url) {
      throw new AssetAdapterError(`luma: no video URL after poll completion`, "luma");
    }

    return {
      mediaUrl: url,
      mediaMimeType: "video/mp4",
      providerModelId: DEFAULT_MODEL,
      costUsd: APPROX_COST_USD,
      meta: {
        aspectRatio: aspect,
        lumaId: job.id,
      },
    };
  },
};
