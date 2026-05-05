// Motion adapter — HTML scene → MP4 via direct ffmpeg.
//
// The other free composer alongside Satori. Renders an HTML scene to a
// short MP4 by using ffmpeg's lavfi color filter for a still backdrop +
// drawtext for typography. No headless Chrome, no npx hyperframes — just
// ffmpeg invoked directly. Faster cold-start than Hyperframes (which
// has the npx warmup tax) and works on Node 20.
//
// Tradeoff: Motion's typography is ffmpeg drawtext (more limited than
// Hyperframes' headless-Chrome HTML rendering). For polished editorial
// output with custom fonts + animations, route to Hyperframes; for
// quick announcements + stat reveals, Motion is the cheap+fast path.
//
// $0 per render. Local-only. No API key.

import { randomUUID } from "node:crypto";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  AssetAdapterError,
  type AssetAdapter,
  type AssetGenerateInput,
  type AssetGenerateResult,
} from "./types";
import { uploadsDirFor, publicUrlFor, runProcess } from "./_shared";

const RENDER_TIMEOUT_MS = 60_000; // 60s — Motion renders are typically <10s

const ASPECT_DIMS: Record<string, { w: number; h: number }> = {
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
  "4:5": { w: 1080, h: 1350 },
};

export const motionAdapter: AssetAdapter = {
  type: "motion",
  kinds: ["video"],
  providerName: "Clipstack Motion",
  costClass: "free",
  approxCostUsd: 0,
  notes: "Direct ffmpeg HTML scene → MP4. Faster than Hyperframes (no npx tax); typography is ffmpeg drawtext (less polished).",

  async generate(input: AssetGenerateInput): Promise<AssetGenerateResult> {
    const jobId = randomUUID();
    const aspect = (input.aspectRatio && ASPECT_DIMS[input.aspectRatio])
      ? input.aspectRatio
      : "16:9";
    const dims = ASPECT_DIMS[aspect]!;
    const durationSec = clamp(input.durationSec ?? 8, 3, 60);
    const headline = input.brief.slice(0, 200);

    const projectDir = path.join(tmpdir(), `motion-${jobId}`);
    await mkdir(projectDir, { recursive: true });

    // Write the headline to a text file so ffmpeg's drawtext doesn't have
    // to deal with shell-escaping. textfile= reads each line per frame.
    const textPath = path.join(projectDir, "headline.txt");
    await writeFile(textPath, headline, "utf-8");

    const outName = `${jobId}.mp4`;
    const outDir = uploadsDirFor("motion");
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, outName);

    // ffmpeg -f lavfi -i "color=c=#0B0C0E:s=WxH:d=Ds" \
    //   -vf "drawtext=textfile=...:fontcolor=#F5F5F7:fontsize=64:..." \
    //   -y outPath
    //
    // The drawtext fontfile setting is omitted; ffmpeg falls back to
    // its bundled default (DejaVu Sans). For Doc 8 typography we'd
    // bundle Inter ttf into a known location and reference it here —
    // deferred to v2 when the prod uploads volume includes assets.
    const filter = [
      `drawtext=textfile=${escapeFilter(textPath)}`,
      `fontcolor=#F5F5F7`,
      `fontsize=${aspect === "9:16" ? 56 : 72}`,
      `box=0`,
      `x=(w-text_w)/2`,
      `y=(h-text_h)/2`,
    ].join(":");

    const args = [
      "-f", "lavfi",
      "-i", `color=c=#0B0C0E:s=${dims.w}x${dims.h}:d=${durationSec}:r=30`,
      "-vf", filter,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", "fast",
      "-tune", "stillimage",
      "-y",
      outPath,
    ];

    try {
      await runProcess("ffmpeg", args, RENDER_TIMEOUT_MS, {
        adapterType: "motion",
        cwd: projectDir,
      });
    } catch (err) {
      // Surface ffmpeg's stderr in the artifact failure message. Cleanup
      // the temp dir before bubbling up.
      await rm(projectDir, { recursive: true, force: true }).catch(() => {});
      if (err instanceof AssetAdapterError) throw err;
      throw new AssetAdapterError(`motion: ffmpeg render failed`, "motion", err);
    }

    await rm(projectDir, { recursive: true, force: true }).catch(() => {});

    return {
      mediaUrl: publicUrlFor("motion", outName),
      mediaMimeType: "video/mp4",
      providerModelId: "motion-drawtext-v1",
      costUsd: 0,
      meta: {
        aspectRatio: aspect,
        durationSec,
        dimensions: dims,
        encoder: "libx264",
      },
    };
  },
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * ffmpeg's filter syntax treats `:` and `\` specially. textfile= paths
 * with colons (Windows) or special chars need escaping; on POSIX with
 * /tmp paths this is a no-op but the helper future-proofs the call.
 */
function escapeFilter(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}
