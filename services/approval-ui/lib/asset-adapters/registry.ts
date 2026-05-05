// Asset-adapter registry — single source of truth for what providers
// are wired in core/. Each adapter lazy-imports so a missing optional
// dep (e.g. resvg-js on a build that doesn't ship native binaries)
// doesn't break the whole registry.
//
// Lookup contract:
//   getAdapter(source) → { adapter, found: true }
//                      | { adapter: null, found: false } when source unknown
//
// The /api/.../assets/generate route uses this to dispatch by `source`
// in the request body.

import type { AssetAdapter, AssetKind } from "./types";

import { satoriAdapter } from "./satori";
import { motionAdapter } from "./motion";
import { higgsfieldAdapter } from "./higgsfield";
import { runwayAdapter } from "./runway";
import { lumaAdapter } from "./luma";
import { elevenlabsAdapter } from "./elevenlabs";
import { sunoAdapter } from "./suno";
// Hyperframes already lives at lib/hyperframes/ as a standalone runner;
// it predates the adapter framework. The registry exposes it under the
// same contract for /studio cost-policy display, but rendering still
// goes through the existing /hyperframes/render route.
import { hyperframesAdapterShim } from "./hyperframes-shim";

/**
 * Catalogue of every adapter wired in core/. Order matters for /studio's
 * default rendering — FREE adapters list first (cost-policy reflex:
 * prefer free composer paths) followed by METERED in alphabetical order.
 */
export const ADAPTERS: readonly AssetAdapter[] = [
  // ─── FREE — agents may use autonomously ──────────
  satoriAdapter,             // HTML/JSX → PNG
  motionAdapter,             // HTML → MP4 via direct ffmpeg
  hyperframesAdapterShim,    // HTML → MP4 via npx hyperframes (sidecar)
  // ─── METERED — needs approval per call ──────────
  elevenlabsAdapter,         // TTS
  higgsfieldAdapter,         // cinematic camera-move video (MCP)
  lumaAdapter,               // text → video
  runwayAdapter,             // text → video
  sunoAdapter,               // text → music
] as const;

export function getAdapter(source: string): AssetAdapter | null {
  return ADAPTERS.find((a) => a.type === source) ?? null;
}

export function getAdaptersForKind(kind: AssetKind): AssetAdapter[] {
  return ADAPTERS.filter((a) => a.kinds.includes(kind));
}

export function describeAdapters(): Array<{
  type: string;
  providerName: string;
  costClass: AssetAdapter["costClass"];
  kinds: readonly AssetKind[];
  approxCostUsd: number;
  apiKeyConfigured: boolean;
  notes?: string;
  docsUrl?: string;
}> {
  return ADAPTERS.map((a) => ({
    type: a.type,
    providerName: a.providerName,
    costClass: a.costClass,
    kinds: a.kinds,
    approxCostUsd: a.approxCostUsd,
    apiKeyConfigured: a.apiKeyEnvVar
      ? Boolean(process.env[a.apiKeyEnvVar])
      : true, // free adapters never need a key
    notes: a.notes,
    docsUrl: a.docsUrl,
  }));
}
