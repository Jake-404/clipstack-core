// Suno adapter — text→music.
//
// AI-generated full-song production from a prompt. Pricing: ~$0.10 per
// generation; quality at the level where it's usable for podcast intros,
// brand jingles, social-media background tracks. Async API (submit + poll).
// 60-120s typical render.

import {
  AssetAdapterError,
  requireApiKey,
  type AssetAdapter,
  type AssetGenerateInput,
  type AssetGenerateResult,
} from "./types";
import { placeholderResponse, pollUntilReady } from "./_shared";

const APPROX_COST_USD = 0.10;
const DEFAULT_MODEL = "chirp-v3-5";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

export const sunoAdapter: AssetAdapter = {
  type: "suno",
  kinds: ["audio"],
  providerName: "Suno",
  costClass: "metered",
  apiKeyEnvVar: "SUNO_API_KEY",
  approxCostUsd: APPROX_COST_USD,
  notes: "AI music. Brand jingles, podcast intros, background tracks. ~$0.10/generation.",
  docsUrl: "https://suno.ai/docs",

  async generate(input: AssetGenerateInput): Promise<AssetGenerateResult> {
    if (!process.env.SUNO_API_KEY && !input.apiKey) {
      return placeholderResponse({
        adapterType: "suno",
        providerModelId: DEFAULT_MODEL,
        approxCostUsd: APPROX_COST_USD,
        kind: "audio",
      });
    }

    const apiKey = requireApiKey(sunoAdapter, input);

    const submit = await fetch("https://api.suno.ai/api/generate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: input.brief.slice(0, 1000),
        make_instrumental: false,
        wait_audio: false,
      }),
      signal: input.signal,
    });
    if (!submit.ok) {
      throw new AssetAdapterError(
        `suno submit: HTTP ${submit.status} — ${(await submit.text()).slice(0, 400)}`,
        "suno",
      );
    }
    const submitData = (await submit.json()) as Array<{ id: string }>;
    const jobId = submitData[0]?.id;
    if (!jobId) {
      throw new AssetAdapterError(`suno: submit returned no id`, "suno");
    }

    const final = await pollUntilReady<{ id: string; status: string; audio_url?: string; error?: string }>({
      intervalMs: POLL_INTERVAL_MS,
      timeoutMs: POLL_TIMEOUT_MS,
      signal: input.signal,
      adapterType: "suno",
      fetchStatus: async () => {
        const r = await fetch(`https://api.suno.ai/api/get?ids=${jobId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: input.signal,
        });
        if (!r.ok) {
          throw new AssetAdapterError(
            `suno poll: HTTP ${r.status} — ${(await r.text()).slice(0, 400)}`,
            "suno",
          );
        }
        const arr = (await r.json()) as Array<{ id: string; status: string; audio_url?: string; error?: string }>;
        const row = arr.find((x) => x.id === jobId);
        if (!row) throw new AssetAdapterError(`suno poll: id ${jobId} not in response`, "suno");
        return row;
      },
      isComplete: (s) => s.status === "complete" && Boolean(s.audio_url),
      isFailed: (s) => (s.status === "error" ? s.error ?? "generation failed" : null),
    });

    const url = final.audio_url;
    if (!url) {
      throw new AssetAdapterError(`suno: no audio_url after poll completion`, "suno");
    }

    return {
      mediaUrl: url,
      mediaMimeType: "audio/mpeg",
      providerModelId: DEFAULT_MODEL,
      costUsd: APPROX_COST_USD,
      meta: {
        sunoId: jobId,
      },
    };
  },
};
