// Update the existing Managed Agents digest agent in-place with the
// current source-of-truth config from lib/managed-agents/digest-agent.ts.
//
// Use this when:
//   - DIGEST_AGENT_SYSTEM_PROMPT changes (new voice rule, length tweak)
//   - DIGEST_AGENT_TOOLS changes (e.g. v2 re-enables the toolset for
//     Hyperframes video render)
//   - DIGEST_AGENT_MODEL changes (Sonnet ↔ Opus tuning)
//
// Run from services/approval-ui:
//   pnpm exec tsx scripts/update-managed-agents.ts
//
// Idempotent in the sense of "running it twice in a row with no source
// changes is a no-op apart from the version bump". Each call increments
// the agent's version field (optimistic-concurrency).
//
// Required env: ANTHROPIC_API_KEY + MANAGED_AGENTS_DIGEST_AGENT_ID
// (resolved from .env.local automatically — no manual export needed).

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

import {
  getAnthropicClient,
  getDigestAgentId,
} from "@/lib/managed-agents/client";
import {
  DIGEST_AGENT_MODEL,
  DIGEST_AGENT_TOOLS,
  composeDigestSystemPrompt,
} from "@/lib/managed-agents/digest-agent";

async function main(): Promise<void> {
  console.log("[managed-agents:update] ─── updating digest agent in-place ───");
  console.log("");

  const agentId = getDigestAgentId();
  if (!agentId) {
    console.error(
      "[managed-agents:update] MANAGED_AGENTS_DIGEST_AGENT_ID not set. Run setup-managed-agents.ts first.",
    );
    process.exit(1);
  }

  const client = getAnthropicClient();

  // Read current version for the optimistic-concurrency check on update.
  const current = await client.beta.agents.retrieve(agentId);
  console.log(`[managed-agents:update]   agent.id:        ${current.id}`);
  console.log(`[managed-agents:update]   current.version: ${current.version}`);
  console.log(`[managed-agents:update]   current.model:   ${typeof current.model === "string" ? current.model : current.model?.id}`);

  // Voice now lives in the system prompt (composed from
  // skills/mira-voice/SKILL.md), not as an attached MA Skill.
  // Skill-as-attachment was tested 2026-05-08 and rejected on
  // latency grounds — see digest-agent.ts comment for the data.
  // Pass `skills: []` to actively clear any previously-attached skill.
  const composedPrompt = composeDigestSystemPrompt();

  console.log("");
  console.log(`[managed-agents:update] writing new config:`);
  console.log(`[managed-agents:update]   model:  ${DIGEST_AGENT_MODEL}`);
  console.log(`[managed-agents:update]   tools:  [${DIGEST_AGENT_TOOLS.length} entries]`);
  console.log(`[managed-agents:update]   prompt: ${composedPrompt.length.toLocaleString("en-US")} chars (voice + task)`);
  console.log(`[managed-agents:update]   skills: [] (voice now system-prompt-injected)`);

  const updated = await client.beta.agents.update(agentId, {
    version: current.version,
    model: DIGEST_AGENT_MODEL,
    system: composedPrompt,
    tools: [...DIGEST_AGENT_TOOLS],
    skills: [], // clear any previously-attached skill
  });

  console.log("");
  console.log(`[managed-agents:update]   ✓ updated`);
  console.log(`[managed-agents:update]   new.version:   ${updated.version}`);
  console.log(`[managed-agents:update]   new.model:     ${typeof updated.model === "string" ? updated.model : updated.model?.id}`);
  if ("skills" in updated && Array.isArray(updated.skills)) {
    console.log(`[managed-agents:update]   new.skills:    [${updated.skills.length} attached]`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[managed-agents:update] failed:", err);
    process.exit(1);
  });
