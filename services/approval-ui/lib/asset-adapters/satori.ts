// Satori adapter — HTML/JSX → PNG via @vercel/satori + @resvg/resvg-js.
//
// $0 per render. Local-only. No API key. Doc 8 typography (Inter +
// JetBrains Mono) baked into the v1 template so renders match Mission
// Control visually.
//
// Why Satori vs DOM-based renderers (puppeteer, etc): Satori is a
// deterministic JSX→SVG translator that doesn't spawn a browser, which
// means renders complete in <500ms with zero external runtime
// dependencies. The legacy Studio-era satori.ts (669 lines) had a
// template library; this v1 ships a single editorial-headline template
// — additional templates land per-design-partner-need.

import { randomUUID } from "node:crypto";

import {
  AssetAdapterError,
  type AssetAdapter,
  type AssetGenerateInput,
  type AssetGenerateResult,
} from "./types";
import { writeArtifactFile } from "./_shared";

// Inter + JetBrains Mono fetched once on first use, cached for the life
// of the process. ~250KB total at 400+700 weights — fine to hold in mem.
let interFont: ArrayBuffer | null = null;
let jetbrainsFont: ArrayBuffer | null = null;

async function loadFont(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Font fetch ${url} → ${resp.status}`);
  return resp.arrayBuffer();
}

async function ensureFonts(): Promise<{ inter: ArrayBuffer; jetbrains: ArrayBuffer }> {
  // Google Fonts ttf URLs (well-known CDN paths). Cached after first hit.
  if (!interFont) {
    interFont = await loadFont(
      "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ojIw2boKoduKmMEVuLyfMZg.ttf",
    );
  }
  if (!jetbrainsFont) {
    jetbrainsFont = await loadFont(
      "https://fonts.gstatic.com/s/jetbrainsmono/v22/tDbY2o-flEEny0FZhsfKu5WU4xD-IQ-PuZJJXxfpAO-LfgQ.ttf",
    );
  }
  return { inter: interFont, jetbrains: jetbrainsFont };
}

// Doc 8 charcoal palette mirroring globals.css for visual continuity.
const PALETTE = {
  bg: "#0B0C0E",
  bgGradient: "#14161A",
  text: "#F5F5F7",
  textMuted: "rgba(245, 245, 247, 0.6)",
  textTertiary: "rgba(245, 245, 247, 0.4)",
  accent: "#14B8A6", // teal-500 from accent palette
};

const ASPECT_DIMS: Record<string, { w: number; h: number }> = {
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
  "4:5": { w: 1080, h: 1350 },
};

export const satoriAdapter: AssetAdapter = {
  type: "satori",
  kinds: ["image"],
  providerName: "Clipstack Satori",
  costClass: "free",
  approxCostUsd: 0,
  notes: "JSX→PNG composer. Editorial template, Doc 8 charcoal + Inter + JetBrains Mono. ~500ms/render.",
  docsUrl: "https://github.com/vercel/satori",

  async generate(input: AssetGenerateInput): Promise<AssetGenerateResult> {
    const aspect = (input.aspectRatio && ASPECT_DIMS[input.aspectRatio])
      ? input.aspectRatio
      : "16:9";
    const dims = ASPECT_DIMS[aspect]!;
    const headline = input.brief.slice(0, 220);

    let satori: typeof import("satori").default;
    let Resvg: typeof import("@resvg/resvg-js").Resvg;
    try {
      const satoriMod = await import("satori");
      satori = satoriMod.default;
      const resvgMod = await import("@resvg/resvg-js");
      Resvg = resvgMod.Resvg;
    } catch (err) {
      throw new AssetAdapterError(
        `satori: dependencies not installed (run pnpm add satori @resvg/resvg-js)`,
        "satori",
        err,
      );
    }

    const fonts = await ensureFonts();

    const tree = {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          backgroundColor: PALETTE.bg,
          backgroundImage: `linear-gradient(180deg, ${PALETTE.bg} 0%, ${PALETTE.bgGradient} 100%)`,
          color: PALETTE.text,
          fontFamily: "Inter",
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                fontSize: "16px",
                fontFamily: "JetBrains Mono",
                color: PALETTE.accent,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: "32px",
              },
              children: "CLIPSTACK · SATORI",
            },
          },
          {
            type: "div",
            props: {
              style: {
                fontSize: aspect === "9:16" ? "64px" : "84px",
                fontWeight: 600,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                maxWidth: "85%",
              },
              children: headline,
            },
          },
          {
            type: "div",
            props: {
              style: {
                marginTop: "auto",
                fontSize: "14px",
                fontFamily: "JetBrains Mono",
                color: PALETTE.textTertiary,
                letterSpacing: "0.05em",
              },
              children: `${aspect} · satori-editorial-v1`,
            },
          },
        ],
      },
    };

    const svg = await satori(tree as never, {
      width: dims.w,
      height: dims.h,
      fonts: [
        { name: "Inter", data: fonts.inter, weight: 600, style: "normal" },
        { name: "JetBrains Mono", data: fonts.jetbrains, weight: 500, style: "normal" },
      ],
    });

    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: dims.w } });
    const png = resvg.render().asPng();

    const fileName = `${randomUUID()}.png`;
    const url = await writeArtifactFile("satori", fileName, png);

    return {
      mediaUrl: url,
      mediaMimeType: "image/png",
      providerModelId: "satori-editorial-v1",
      costUsd: 0,
      meta: {
        aspectRatio: aspect,
        dimensions: dims,
        template: "editorial",
      },
    };
  },
};
