// Higgsfield Mix adapter — cinematic camera-move video via the
// Higgsfield MCP server (Claude-compatible).
//
// Released April 2026. Mid-tier price ($0.30-$0.80 per clip), distinctive
// for camera-move expressivity (orbit / dolly / push-in) that sets it
// apart from Runway / Luma. The "key unlock" Jake flagged for the demo.
//
// MCP integration design: Higgsfield ships as an MCP server, which means
// the agent's tool registry (CrewAI's loadMcpServerTools in the legacy
// stack, future native MCP support in core/) routes the tool call without
// needing per-provider wrapper code. v1 here uses the HTTP REST API
// directly so the adapter integrates uniformly with the rest of the
// registry; full MCP plumbing lands when core/ has the MCP-server-runner
// pattern (Phase D).
//
// Without HIGGSFIELD_API_KEY set, the adapter returns a placeholder so
// /studio + the cost-policy router can route to it during dev/demo
// without requiring a production account. The placeholder records
// `wouldHaveCost` so cost-analysis sees what a real call would have run.

import {
  AssetAdapterError,
  requireApiKey,
  type AssetAdapter,
  type AssetGenerateInput,
  type AssetGenerateResult,
} from "./types";
import { placeholderResponse } from "./_shared";

const APPROX_COST_USD = 0.55; // mid-band of $0.30-$0.80
const DEFAULT_MODEL = "higgsfield-mix-v1";

export const higgsfieldAdapter: AssetAdapter = {
  type: "higgsfield",
  kinds: ["video"],
  providerName: "Higgsfield Mix",
  costClass: "metered",
  apiKeyEnvVar: "HIGGSFIELD_API_KEY",
  approxCostUsd: APPROX_COST_USD,
  notes:
    "MCP-native cinematic-camera-move video. Orbit/dolly/push-in expressivity Runway+Luma don't ship. ~$0.30-0.80/clip.",
  docsUrl: "https://higgsfield.ai/docs",

  async generate(input: AssetGenerateInput): Promise<AssetGenerateResult> {
    // Placeholder fall-through when no API key — keeps /studio + cost-
    // policy demoable without a real account.
    if (!process.env.HIGGSFIELD_API_KEY && !input.apiKey) {
      return placeholderResponse({
        adapterType: "higgsfield",
        providerModelId: DEFAULT_MODEL,
        approxCostUsd: APPROX_COST_USD,
        kind: "video",
      });
    }

    const apiKey = requireApiKey(higgsfieldAdapter, input);
    const aspect = input.aspectRatio ?? "16:9";
    const duration = Math.max(2, Math.min(10, input.durationSec ?? 5));

    // Higgsfield's REST contract (per their March 2026 docs) accepts
    // a POST /v1/generations body with prompt + camera_move + aspect.
    // The actual response shape is { id, status, video_url } — the
    // implementation here is the request shape we'd ship; live testing
    // happens when a key lands.
    const resp = await fetch("https://api.higgsfield.ai/v1/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: input.brief.slice(0, 1000),
        camera_move: "auto", // let Higgsfield pick orbit/dolly/push based on prompt
        aspect_ratio: aspect,
        duration_seconds: duration,
      }),
      signal: input.signal,
    });

    if (!resp.ok) {
      throw new AssetAdapterError(
        `higgsfield: HTTP ${resp.status} — ${(await resp.text()).slice(0, 400)}`,
        "higgsfield",
      );
    }

    const data = (await resp.json()) as {
      id?: string;
      video_url?: string;
      status?: string;
      camera_move?: string;
    };

    if (!data.video_url) {
      throw new AssetAdapterError(
        `higgsfield: response missing video_url (status=${data.status})`,
        "higgsfield",
      );
    }

    return {
      mediaUrl: data.video_url,
      mediaMimeType: "video/mp4",
      providerModelId: DEFAULT_MODEL,
      costUsd: APPROX_COST_USD,
      meta: {
        aspectRatio: aspect,
        durationSec: duration,
        cameraMove: data.camera_move ?? "auto",
        higgsfieldId: data.id,
      },
    };
  },
};
