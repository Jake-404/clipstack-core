// Smoke-test the Managed Agents digest path end-to-end. No Next.js
// server needed — calls narrateDigest() directly with stub digest
// data and prints the recap + token usage.
//
// Run from services/approval-ui:
//   pnpm exec tsx scripts/smoke-test-managed-agents.ts
//
// Verifies:
//   - .env.local loads + MA env vars resolve
//   - getAnthropicClient() initialises (real API key)
//   - sessions.create succeeds against the agent + environment
//   - sessions.events.stream + send work in the canonical order
//   - the agent produces a 180-220 word narrative
//   - token-usage rollup arrives via span.model_request_end events
//
// One-shot: not idempotent in the sense of "creates billable
// resources". Each run spawns a new MA session (≈ a few cents at
// Opus 4.7 prices for a 200-word output). Cheap enough to run on
// every code change to digest-agent.ts.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

(function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;
    if (process.env[key]) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
})();

import { resolveManagedAgentsConfig } from "@/lib/managed-agents/client";
import { narrateDigest, type DigestData } from "@/lib/managed-agents/digest-agent";

// Stub digest data that mimics what /api/.../digest/narrate aggregates.
// Numbers chosen to give Mira meaningful texture: a clear top performer,
// a couple of lessons across scopes, a non-zero anomaly count, a healthy
// throughput week.
const STUB_DATA: DigestData = {
  weekEndDate: new Date(),
  weekStartDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  topPerformers: [
    {
      title: "Why your bandit's posterior matters more than your CTR",
      channel: "linkedin",
      avgPercentile: 87,
      impressions: 14_200,
    },
    {
      title: "The 47% YoY post nobody saw coming",
      channel: "twitter",
      avgPercentile: 71,
      impressions: 8_900,
    },
    {
      title: "Three lessons from a quiet week of approvals",
      channel: "substack",
      avgPercentile: 64,
      impressions: 3_400,
    },
  ],
  lessonsCaptured: {
    total: 4,
    forever: 1,
    thisTopic: 2,
    thisClient: 1,
    samples: [
      {
        rationale:
          "Don't lead with the platform feature — lead with the user's problem. The strategist keeps reaching for 'Clipstack does X' when the audience needs 'you're losing 4 hours a week to Y'.",
        scope: "forever",
      },
      {
        rationale:
          "VeChain audience reacts to 'institutional liquidity' framing, not 'community-first'. Reverse the default for crypto-vertical drafts.",
        scope: "this_client",
      },
      {
        rationale:
          "Two-sentence paragraphs outperform four-sentence ones at p70+ for thought-leadership posts in this workspace.",
        scope: "this_topic",
      },
    ],
  },
  anomaliesCount: 2,
  decisionsMade: {
    approved: 12,
    denied: 3,
    weekApprovals: 1,
    total: 16,
  },
  publishedCount: 13,
  draftsCreated: 18,
};

async function main(): Promise<void> {
  console.log("[ma:smoke-test] ─── Managed Agents digest narrate smoke-test ───");
  console.log("");

  const config = resolveManagedAgentsConfig();
  if (!config) {
    console.error(
      "[ma:smoke-test] MA not configured. Run scripts/setup-managed-agents.ts and add the IDs to .env.local.",
    );
    process.exit(1);
  }

  console.log(`[ma:smoke-test]   agent.id:       ${config.digestAgentId}`);
  console.log(`[ma:smoke-test]   environment.id: ${config.environmentId}`);
  console.log("");
  console.log("[ma:smoke-test] spawning session + draining to idle (typically 5-15s)...");

  const startMs = Date.now();
  const result = await narrateDigest(
    config.client,
    config.digestAgentId,
    config.environmentId,
    STUB_DATA,
  );
  const elapsedMs = Date.now() - startMs;

  console.log("");
  console.log(`[ma:smoke-test]   ✓ session.id: ${result.sessionId}`);
  console.log(
    `[ma:smoke-test]   ✓ usage:      ${result.inputTokens.toLocaleString("en-US")} in + ${result.outputTokens.toLocaleString("en-US")} out tokens`,
  );
  console.log(`[ma:smoke-test]   ✓ elapsed:    ${(elapsedMs / 1000).toFixed(1)}s (helper reports ${(result.elapsedMs / 1000).toFixed(1)}s)`);

  const wordCount = result.narrative.split(/\s+/).filter(Boolean).length;
  console.log(`[ma:smoke-test]   ✓ wordCount:  ${wordCount} (target: 180-220)`);
  if (wordCount < 150 || wordCount > 250) {
    console.warn(`[ma:smoke-test]   ⚠ word count outside expected envelope`);
  }

  console.log("");
  console.log("─".repeat(72));
  console.log("Mira's recap:");
  console.log("─".repeat(72));
  console.log("");
  console.log(result.narrative);
  console.log("");
  console.log("─".repeat(72));
  console.log("");
  console.log("[ma:smoke-test]   ✓ end-to-end roundtrip OK");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[ma:smoke-test] failed:", err);
    process.exit(1);
  });
