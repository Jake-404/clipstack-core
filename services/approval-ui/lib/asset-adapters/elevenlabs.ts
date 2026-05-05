// ElevenLabs adapter — text→speech.
//
// Best-in-class TTS quality. Sync API (no polling). Pricing: ~$0.30 per
// 1k characters at multilingual_v2; ~10-15 cents per 30-second narration.

import { randomUUID } from "node:crypto";

import {
  AssetAdapterError,
  requireApiKey,
  type AssetAdapter,
  type AssetGenerateInput,
  type AssetGenerateResult,
} from "./types";
import { placeholderResponse, writeArtifactFile } from "./_shared";

const APPROX_COST_USD = 0.15;
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs "Rachel" — neutral default
const DEFAULT_MODEL = "eleven_multilingual_v2";

export const elevenlabsAdapter: AssetAdapter = {
  type: "elevenlabs",
  kinds: ["audio"],
  providerName: "ElevenLabs",
  costClass: "metered",
  apiKeyEnvVar: "ELEVENLABS_API_KEY",
  approxCostUsd: APPROX_COST_USD,
  notes: "Best-in-class TTS. ~$0.30/1k chars; ~10-15¢ per 30s narration.",
  docsUrl: "https://elevenlabs.io/docs",

  async generate(input: AssetGenerateInput): Promise<AssetGenerateResult> {
    if (!process.env.ELEVENLABS_API_KEY && !input.apiKey) {
      return placeholderResponse({
        adapterType: "elevenlabs",
        providerModelId: DEFAULT_MODEL,
        approxCostUsd: APPROX_COST_USD,
        kind: "audio",
      });
    }

    const apiKey = requireApiKey(elevenlabsAdapter, input);
    const voiceId = input.voiceId ?? DEFAULT_VOICE_ID;
    const text = input.brief.slice(0, 5000);

    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: DEFAULT_MODEL,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
      signal: input.signal,
    });
    if (!resp.ok) {
      throw new AssetAdapterError(
        `elevenlabs: HTTP ${resp.status} — ${(await resp.text()).slice(0, 400)}`,
        "elevenlabs",
      );
    }

    const audioBuffer = Buffer.from(await resp.arrayBuffer());
    const fileName = `${randomUUID()}.mp3`;
    const url = await writeArtifactFile("elevenlabs", fileName, audioBuffer);

    // Cost estimate: ~$0.30 per 1k chars (multilingual_v2 list price).
    const charCount = text.length;
    const costUsd = (charCount / 1000) * 0.30;

    return {
      mediaUrl: url,
      mediaMimeType: "audio/mpeg",
      providerModelId: DEFAULT_MODEL,
      costUsd,
      meta: {
        voiceId,
        charCount,
        modelId: DEFAULT_MODEL,
      },
    };
  },
};
