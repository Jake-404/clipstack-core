// Shared helpers for asset adapters.
//
// File-system writes for local renderers go through writeArtifactFile;
// HTTP-based providers route through pollUntilReady for async polling.
// Keeping these here means each adapter file stays narrowly focused on
// the provider-specific request shape.

import { mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { AssetAdapterError } from "./types";

/**
 * Where local renderers write their output. The Next.js static pipeline
 * serves /public/uploads/* at the matching URL; UPLOADS_DIR overrides
 * for production deployments using a different volume.
 */
export function uploadsDirFor(source: string): string {
  if (process.env.UPLOADS_DIR) return path.join(process.env.UPLOADS_DIR, source);
  return path.resolve(process.cwd(), "public", "uploads", source);
}

/**
 * Public URL the browser fetches the rendered file from. Pairs with
 * uploadsDirFor() so the path written matches the URL served.
 */
export function publicUrlFor(source: string, fileName: string): string {
  return `/uploads/${source}/${fileName}`;
}

/**
 * Write a buffer to the local uploads dir for a given adapter.
 * Returns the public URL the browser can fetch the file from.
 */
export async function writeArtifactFile(
  source: string,
  fileName: string,
  data: Buffer | Uint8Array | string,
): Promise<string> {
  const dir = uploadsDirFor(source);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), data);
  return publicUrlFor(source, fileName);
}

/**
 * Subprocess helper. All adapter spawns route through here so timeout +
 * stderr capture + non-zero-exit error handling is consistent.
 */
export interface ProcResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function runProcess(
  cmd: string,
  args: string[],
  timeoutMs: number,
  opts: { cwd?: string; adapterType: string } = { adapterType: "unknown" },
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: opts.cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new AssetAdapterError(`${cmd} timed out after ${timeoutMs}ms`, opts.adapterType));
    }, timeoutMs);
    proc.stdout.on("data", (b) => {
      stdout += b.toString();
    });
    proc.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    proc.on("error", (err) => {
      clearTimeout(t);
      reject(new AssetAdapterError(`${cmd} failed: ${err.message}`, opts.adapterType, err));
    });
    proc.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) {
        reject(
          new AssetAdapterError(
            `${cmd} exited ${code}. stderr: ${stderr.slice(0, 400)}`,
            opts.adapterType,
          ),
        );
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}

/**
 * Async polling helper for HTTP-based async providers (Runway, Luma,
 * Suno, etc.). Polls a status URL every `intervalMs` until the
 * `isComplete()` predicate returns true OR the deadline trips OR the
 * AbortSignal fires. Adapters wrap this around their provider-specific
 * status-fetch + completion-check logic.
 */
export async function pollUntilReady<T>(opts: {
  fetchStatus: () => Promise<T>;
  isComplete: (status: T) => boolean;
  isFailed: (status: T) => string | null;
  intervalMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
  adapterType: string;
}): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      throw new AssetAdapterError(`${opts.adapterType}: aborted`, opts.adapterType);
    }
    const status = await opts.fetchStatus();
    const failure = opts.isFailed(status);
    if (failure) {
      throw new AssetAdapterError(`${opts.adapterType}: ${failure}`, opts.adapterType);
    }
    if (opts.isComplete(status)) return status;
    await sleep(opts.intervalMs, opts.signal);
  }
  throw new AssetAdapterError(
    `${opts.adapterType}: polling timed out after ${opts.timeoutMs}ms`,
    opts.adapterType,
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const t = setTimeout(() => resolve(), ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      }, { once: true });
    }
  });
}

/**
 * Stub adapter helper — for paid providers we haven't fully wired yet
 * but want to register so /studio shows them in the cost-policy table
 * and the cost-policy router can route to them. Returns a placeholder
 * URL pointing to a "stub artifact" image that's clear about what
 * happened.
 *
 * When the real API key is configured AND HTTP is reachable, the
 * adapter uses its real implementation; without a key, it falls
 * through to this stub so the developer sees a working flow without
 * needing every vendor account.
 */
export async function placeholderResponse(opts: {
  adapterType: string;
  providerModelId: string;
  approxCostUsd: number;
  kind: "video" | "image" | "audio";
}): Promise<{ mediaUrl: string; mediaMimeType: string; providerModelId: string; costUsd: number; meta: Record<string, unknown> }> {
  // Public stub assets ship with the repo at /public/stubs/. Each
  // adapter has a kind-specific placeholder so the UI renders the right
  // player. Cost is recorded as 0 in the stub path — the meter event
  // captures "would-have-cost approxCostUsd if real" via meta so cost-
  // analysis still has the data.
  const mimeMap = { video: "video/mp4", image: "image/png", audio: "audio/mpeg" };
  const extMap = { video: "mp4", image: "png", audio: "mp3" };
  return {
    mediaUrl: `/uploads/stubs/${opts.adapterType}-placeholder.${extMap[opts.kind]}`,
    mediaMimeType: mimeMap[opts.kind],
    providerModelId: opts.providerModelId,
    costUsd: 0,
    meta: {
      stub: true,
      reason: `${opts.adapterType} adapter ran without API key — returning placeholder. Configure key + retry for a real call.`,
      wouldHaveCost: opts.approxCostUsd,
    },
  };
}
