// Mira voice — load the canonical voice body from skills/mira-voice/
// SKILL.md and expose it as a string for system-prompt injection.
//
// Why a file (not an inline constant): the voice doc is long-form
// content that benefits from markdown rendering, PR review, and
// being shared across every Mira-driven agent (digest, future
// research crew, vertical-pack composition, etc.). Markdown file is
// the right format; this module just gives TypeScript a clean
// import path.
//
// Why injected into the system prompt (not attached as an MA Skill):
// empirically (smoke-tests 2026-05-08), attaching the same content
// as a Skill cost ~50s mean latency + 1-in-3 risk of crossing the 60s
// route timeout because the agent has to `read` the skill body each
// session and reason over it before composing. System prompts cache
// across sessions and don't carry the per-session read overhead.
// Voice rules are short, deterministic, always-relevant — they're
// prompt-shaped, not skill-shaped. Skills are still the right
// primitive for big/conditional/inspectable knowledge (Anthropic's
// pdf/docx skills, future vertical compliance packs, persona
// libraries) — just not for voice.
//
// Strip the YAML front matter when loading: the front matter is for
// the Skills API metadata (name, description), not for the model.
// What goes into the system prompt is just the markdown body.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let cachedVoiceBody: string | null = null;

/**
 * Resolve the SKILL.md path relative to this module. Works in both
 * Next.js bundled runtime (where __dirname-equivalents exist via the
 * compiled output) and tsx CLI scripts (which call this module
 * directly). Falls back to cwd-relative resolution if the
 * filesystem-relative path doesn't resolve.
 */
function resolveSkillMdPath(): string {
  // tsx + ESM: import.meta.url is the way. CJS Next.js bundle:
  // __dirname-style. Try both.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — import.meta is available in all relevant runtimes
  const here = typeof import.meta !== "undefined" && import.meta.url
    ? // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      dirname(fileURLToPath(import.meta.url))
    : __dirname;

  // From lib/managed-agents/voice.ts → ../../skills/mira-voice/SKILL.md
  const relPath = resolve(here, "..", "..", "skills", "mira-voice", "SKILL.md");
  if (existsSync(relPath)) return relPath;

  // Fallback: cwd-relative (script invocations from package root).
  const cwdPath = resolve(process.cwd(), "skills", "mira-voice", "SKILL.md");
  if (existsSync(cwdPath)) return cwdPath;

  throw new Error(
    `[mira-voice] SKILL.md not found. Looked at:\n  ${relPath}\n  ${cwdPath}`,
  );
}

/**
 * Load Mira's voice body — the SKILL.md content with the YAML front
 * matter stripped. Cached after first read.
 */
export function getMiraVoiceBody(): string {
  if (cachedVoiceBody !== null) return cachedVoiceBody;

  const path = resolveSkillMdPath();
  const raw = readFileSync(path, "utf8");

  // Strip YAML front matter (between leading "---" lines). If the
  // file has no front matter, return the raw content.
  const fmMatch = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
  cachedVoiceBody = (fmMatch ? fmMatch[1] : raw).trim();
  return cachedVoiceBody;
}
