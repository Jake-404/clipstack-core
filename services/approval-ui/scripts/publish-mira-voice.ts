// Publish (or republish) the Mira voice skill to Anthropic's Managed
// Agents stack. The source of truth is skills/mira-voice/SKILL.md;
// this script uploads it as a custom MA skill and prints the skill_id
// to copy into .env.local.
//
// Run from services/approval-ui:
//   pnpm exec tsx scripts/publish-mira-voice.ts
//
// What it does:
//   1. Loads .env.local (so ANTHROPIC_API_KEY resolves)
//   2. Reads skills/mira-voice/SKILL.md
//   3. Calls client.beta.skills.create with the file
//   4. Prints the new skill_id + version
//
// Idempotency: NOT idempotent. Each run uploads a new skill version
// (skills are append-only — each create returns a new id). To attach
// the new skill to the digest agent, copy the printed id into
// .env.local as MANAGED_AGENTS_MIRA_VOICE_SKILL_ID, then run
// scripts/update-managed-agents.ts which reads the env var and patches
// the agent's `skills` field.
//
// The MA skills API expects "files": all files in the same top-level
// directory, with SKILL.md at the root. We have one file so the upload
// is a single-element array.

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

import { getAnthropicClient } from "@/lib/managed-agents/client";

const SKILL_DIR = resolve(process.cwd(), "skills", "mira-voice");
const SKILL_FILE = resolve(SKILL_DIR, "SKILL.md");

async function main(): Promise<void> {
  console.log("[mira-voice:publish] ─── publishing Mira voice skill ───");
  console.log("");

  if (!existsSync(SKILL_FILE)) {
    console.error(`[mira-voice:publish] SKILL.md not found at ${SKILL_FILE}`);
    process.exit(1);
  }

  const skillBody = readFileSync(SKILL_FILE, "utf8");
  console.log(`[mira-voice:publish]   source: ${SKILL_FILE}`);
  console.log(`[mira-voice:publish]   size:   ${skillBody.length.toLocaleString("en-US")} chars`);

  const client = getAnthropicClient();

  console.log("[mira-voice:publish] uploading to Anthropic...");
  // Skills API expects files to be inside a top-level folder, with
  // SKILL.md at the root of that folder. So filename takes the form
  // `<skill-name>/SKILL.md`. A bare "SKILL.md" (no folder prefix) is
  // rejected with "SKILL.md file must be exactly in the top-level
  // folder."
  const skillFile = new File(
    [Buffer.from(skillBody, "utf8")],
    "mira-voice/SKILL.md",
    { type: "text/markdown" },
  );

  // Skills API: each upload requires a unique display_title (skills
  // are immutable resources keyed by ID — no in-place update). Use a
  // YYYY-MM-DD-HHMM suffix so republishes don't collide. The agent
  // points at the latest skill_id; old versions stay in the org's
  // skill list as historical record.
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 13);
  const displayTitle = `Mira's voice (${stamp})`;

  const skill = await client.beta.skills.create({
    display_title: displayTitle,
    files: [skillFile],
  });

  console.log(`[mira-voice:publish]   display_title: ${displayTitle}`);

  console.log("");
  console.log(`[mira-voice:publish]   ✓ skill.id:      ${skill.id}`);
  // The skill response carries a version field per MA — useful for
  // pinning if we ever want a frozen voice for reproducibility.
  if ("version" in skill && skill.version) {
    console.log(`[mira-voice:publish]   ✓ skill.version: ${String(skill.version)}`);
  }

  console.log("");
  console.log("─".repeat(72));
  console.log("Add this line to services/approval-ui/.env.local:");
  console.log("");
  console.log(`MANAGED_AGENTS_MIRA_VOICE_SKILL_ID=${skill.id}`);
  console.log("─".repeat(72));
  console.log("");
  console.log(
    "Then run scripts/update-managed-agents.ts to attach the skill to the",
  );
  console.log("digest agent (and any future Mira-driven agents).");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[mira-voice:publish] failed:", err);
    process.exit(1);
  });
