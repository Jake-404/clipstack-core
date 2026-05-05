// Asset-adapter framework — shared interface every provider implements.
//
// Distilled from the legacy `packages/agents/src/asset-adapters/types.ts`
// with the same shape so future ports can land in core/ without
// reshaping the adapter contract. Differences from legacy:
//   - costClass now lives on the adapter (FREE / METERED / EXPENSIVE),
//     replacing the requiresApiKey flag — clearer intent for the
//     cost-policy router.
//   - Result.summary removed (UI synthesizes from prompt + meta).
//   - Stricter `kind` typing — matches the artifacts table enum.

export type AssetKind = "video" | "image" | "audio";

/**
 * Cost classification per CLAUDE.md content-generation cost policy.
 *   FREE       — local renderer, $0 per call; agents may use autonomously
 *   METERED    — single paid provider call; agents need user approval
 *                (conditionalCheck on asset.generate gates on providerHint)
 *   EXPENSIVE  — multi-call orchestration ($5-50/render); agents cannot
 *                trigger; route hard-rejects x-agent-trigger headers
 */
export type CostClass = "free" | "metered" | "expensive";

export interface AssetGenerateInput {
  /** The brief / prompt the user (or agent) wrote. */
  brief: string;
  kind: AssetKind;
  /** Resolved provider API key, server-side. Adapters never read process.env directly. */
  apiKey?: string;
  /** Brand-kit context for color/font/voice defaults. Each field optional. */
  brandKit?: {
    primaryColor?: string | null;
    secondaryColor?: string | null;
    accentColor?: string | null;
    fontPrimary?: string | null;
    toneOfVoice?: string | null;
    logoUrl?: string | null;
  };
  /** "16:9" | "9:16" | "1:1" | "4:5" — adapters validate. */
  aspectRatio?: string;
  /** 5..60 seconds for video; ignored elsewhere. */
  durationSec?: number;
  /** Provider-specific resolution hint ("480p", "1080p", etc.). */
  resolution?: string;
  /** TTS voice id (ElevenLabs / others). */
  voiceId?: string;
  /** Reference URLs (image-to-image, image-to-video). */
  refs?: string[];
  /** Server-side abort signal — adapters should propagate to fetch + sleep. */
  signal?: AbortSignal;
}

export interface AssetGenerateResult {
  /** Public URL to the produced media. Local renders write to /uploads/<source>/<id>.<ext>; remote providers return their CDN URL. */
  mediaUrl: string;
  mediaMimeType: string;
  providerModelId: string;
  /** Actual USD cost. 0 for free local renders. */
  costUsd: number;
  /** Free-form provider metadata persisted in artifacts.provider_meta. */
  meta: Record<string, unknown>;
}

export interface AssetAdapter {
  /** Stable identifier — matches artifacts.source. */
  type: string;
  /** Kinds this adapter can produce. */
  kinds: readonly AssetKind[];
  /** Human-readable provider credit. */
  providerName: string;
  /** Cost class — drives the cost-policy approval gate. */
  costClass: CostClass;
  /** Env var name for the API key. undefined for free adapters. */
  apiKeyEnvVar?: string;
  /** Approximate USD cost per call (for budget planning). 0 for free. */
  approxCostUsd: number;
  /** Provider docs URL — surfaces in /studio for operators. */
  docsUrl?: string;
  /** Provider notes — surfaces in /studio cost-policy table. */
  notes?: string;
  generate(input: AssetGenerateInput): Promise<AssetGenerateResult>;
}

export class AssetAdapterError extends Error {
  constructor(
    message: string,
    public readonly adapterType: string,
    public readonly cause?: unknown,
  ) {
    super(message.slice(0, 1800));
    this.name = "AssetAdapterError";
  }
}

/**
 * Common helper — every adapter that needs an API key calls this. Throws
 * a clean AssetAdapterError when the key is missing rather than letting
 * the underlying SDK throw a confusing 401 later in the call chain.
 */
export function requireApiKey(adapter: AssetAdapter, input: AssetGenerateInput): string {
  if (!adapter.apiKeyEnvVar) {
    throw new AssetAdapterError(
      `${adapter.type}: apiKeyEnvVar not configured`,
      adapter.type,
    );
  }
  const key = input.apiKey ?? process.env[adapter.apiKeyEnvVar];
  if (!key) {
    throw new AssetAdapterError(
      `${adapter.type}: missing API key (set ${adapter.apiKeyEnvVar})`,
      adapter.type,
    );
  }
  return key;
}
