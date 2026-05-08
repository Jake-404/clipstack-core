// Managed Agents — weekly digest agent definition + session-spawn helpers.
//
// The agent's job: read structured workspace data (top performers,
// lessons captured, anomalies, decisions made) and write a 200-word
// editorial recap in Clipstack's voice. Future v2 also drives a
// 60-second Hyperframes video render.
//
// Why a Managed Agent vs a single Anthropic API call:
//   - The agent has a workspace (container) — future v2 wants it to
//     run analytics scripts, render the Hyperframes video via bash,
//     write the narrative to a file the UI can fetch.
//   - The session is stateful — for a multi-tenant cron-driven
//     digest, sessions can be archived per workspace and replayed
//     for audit.
//   - The agent loop is server-managed — Anthropic handles the
//     prompt-cache + thinking + tool routing; we just stream events.
//
// For v1 we don't use any of those superpowers — a single API call
// would suffice. This is the integration proof-of-concept; the
// superpowers come in v2 (video render) and v3 (cron-driven
// per-workspace).

import type Anthropic from "@anthropic-ai/sdk";

import { getMiraVoiceBody } from "./voice";

// ─── Agent definition ───────────────────────────────────────────────────

export const DIGEST_AGENT_NAME = "Clipstack Weekly Digest";

/**
 * The digest-task-specific instructions. Combined with the Mira voice
 * body at agent-update time to form the full system prompt. Voice is
 * the load-bearing constraint; this is the task layer on top.
 *
 * Length guidance: 180-220 words. Long enough to surface 3 specific
 * data points, short enough to read in 60 seconds aloud (≈ 60-second
 * video voice-over at conversational pace).
 */
export const DIGEST_TASK_INSTRUCTIONS = `## This agent's task: weekly digest

Once a week, write a 200-word recap of what the workspace's team did. The recap is what the workspace owner reads in 60 seconds before their first meeting Monday morning.

You will receive structured digest data in the user message — top performers, lessons captured, decisions made, throughput numbers. Read it, then write the recap.

Structure:
- Open with the headline finding (the top performer or the most consequential decision).
- Middle paragraph names a second specific data point — a captured lesson, an anomaly, a decision pattern.
- Close with one concrete recommendation for next week, anchored in the data.

Length: 180-220 words.

Do not echo the data back. Do not list every number. Pick the 2-3 most consequential data points and let them carry the narrative. Apply Mira's voice (above) to every sentence.`;

/**
 * Compose the full system prompt: Mira's voice (loaded from
 * skills/mira-voice/SKILL.md) followed by the digest-specific task
 * instructions. The voice body is the same content that would be
 * uploaded as an MA Skill, but injected here for cheaper latency
 * (system prompts cache; skills load + reason per session).
 *
 * Same composition pattern works for any future Mira-driven agent:
 * import getMiraVoiceBody() + concatenate with the agent-specific
 * task instructions.
 */
export function composeDigestSystemPrompt(): string {
  return `${getMiraVoiceBody()}\n\n---\n\n${DIGEST_TASK_INSTRUCTIONS}`;
}


/**
 * Tools the agent gets. Currently empty — voice is system-prompt-
 * injected (no skill to load), digest data arrives in the user
 * message (no tools to fetch), output is plain prose (no tools to
 * write). Empty toolset is the cheapest possible inference surface.
 *
 * History:
 *   - v1.0 (commit e70263d): full `agent_toolset_20260401` enabled
 *     by default. Cost ~120s / ~12k out tokens because the model
 *     burned thinking on whether to invoke 5 tools it never used.
 *   - v1.0.1 (commit 9dbfa1d): tools dropped entirely. ~15s, ~400
 *     out tokens. Voice in inline system prompt.
 *   - v1.1 (intra-day 2026-05-08): re-enabled `read` to load Mira
 *     voice as an MA Skill. Cost regressed to ~50s, 1-in-3 timeout
 *     risk. Kept the architectural cleanliness, lost the latency.
 *   - v1.2 (this): tools dropped again. Voice moved to system-prompt
 *     injection from skills/mira-voice/SKILL.md (read at
 *     agent-update time, not session time). Restored ~15s baseline,
 *     kept multi-agent voice reuse via composeDigestSystemPrompt().
 *
 * v2 (Hyperframes 60s video render) will enable `bash` for `npx
 * hyperframes render`. Update this constant + run
 * scripts/update-managed-agents.ts at that point.
 */
export const DIGEST_AGENT_TOOLS: ReadonlyArray<never> = [];

/**
 * The model that powers the agent. **Sonnet 4.6, locked 2026-05-08
 * after a 3v3 head-to-head against Opus 4.7** (both with empty tools).
 *
 * Empirical comparison (3 runs each, scripts/smoke-test-managed-agents.ts
 * against stub digest data):
 *
 *                   Sonnet 4.6        Opus 4.7
 *   latency         15.2s × 3 (zero   35-61s (one run crossed the
 *                   variance)         60s route timeout — 504 risk)
 *   output tokens   324-444           2,164-5,770 (5-15× more)
 *   est. cost/call  ~$0.006           ~$0.10 (17× more)
 *   word count      184-206           181-197
 *   voice quality   consistent floor  higher peaks, lower floor
 *
 * Quality verdict: Opus had two excellent runs ("editorial attention
 * concentrates where the percentile lives instead of where the volume
 * is", "That single capture will outlast every metric on this page")
 * and one merely-competent run. Sonnet had three voice-aligned runs
 * with comparable grandiose framing ("the audience is already living
 * inside the problem Clipstack solves", "1 of them will still matter
 * in a year").
 *
 * For a recurring user-facing surface (digest fires weekly per
 * workspace), consistent quality beats occasional brilliance, and
 * the latency variance on Opus would force a maxDuration bump +
 * timeout-handling code path that Sonnet doesn't need.
 *
 * If you want to re-run the comparison: edit this constant to
 * "claude-opus-4-7", run scripts/update-managed-agents.ts, then
 * scripts/smoke-test-managed-agents.ts ≥3 times.
 */
export const DIGEST_AGENT_MODEL = "claude-sonnet-4-6" as const;

// ─── Session spawning ──────────────────────────────────────────────────

export interface DigestData {
  weekEndDate: Date;
  weekStartDate: Date;
  topPerformers: Array<{
    title: string | null;
    channel: string;
    avgPercentile: number;
    impressions: number | null;
  }>;
  lessonsCaptured: {
    total: number;
    forever: number;
    thisTopic: number;
    thisClient: number;
    samples: Array<{ rationale: string; scope: string }>;
  };
  anomaliesCount: number;
  decisionsMade: {
    approved: number;
    denied: number;
    weekApprovals: number;
    total: number;
  };
  publishedCount: number;
  draftsCreated: number;
}

/**
 * Format the digest data into a kickoff user message. The agent reads
 * this once and produces the recap. Format choice: structured Markdown
 * vs JSON vs natural-language prose. JSON is the most parseable but
 * the agent has to translate it; prose is the most agent-friendly but
 * loses precision; Markdown sits in the middle and matches what the
 * agent's writing-output context is most familiar with from training.
 */
export function buildDigestKickoffMessage(data: DigestData): string {
  const dateRange = `${data.weekStartDate.toISOString().slice(0, 10)} → ${data.weekEndDate.toISOString().slice(0, 10)}`;

  const topPerformersList = data.topPerformers.length === 0
    ? "_(none — no published drafts with engagement metrics in the window)_"
    : data.topPerformers
        .map((p, i) => {
          const title = p.title?.trim() || "(untitled draft)";
          const impressions = p.impressions !== null ? p.impressions.toLocaleString("en-US") : "—";
          return `${i + 1}. ${title} (${p.channel}) — p${Math.round(p.avgPercentile)}, ${impressions} impressions`;
        })
        .join("\n");

  const lessonSamplesList = data.lessonsCaptured.samples.length === 0
    ? "_(no new lessons this week)_"
    : data.lessonsCaptured.samples
        .map((l) => `- [${l.scope}] ${l.rationale}`)
        .join("\n");

  return `Weekly digest data — ${dateRange}

## Top performers (last 7d, by avg engagement percentile)
${topPerformersList}

## Lessons captured this week
- Total: ${data.lessonsCaptured.total} (${data.lessonsCaptured.forever} forever, ${data.lessonsCaptured.thisTopic} topic-bounded, ${data.lessonsCaptured.thisClient} client-specific)

Sample rationales:
${lessonSamplesList}

## Decisions
- Approved: ${data.decisionsMade.approved}
- Denied: ${data.decisionsMade.denied}
- Bulk weekly approvals: ${data.decisionsMade.weekApprovals}
- Total: ${data.decisionsMade.total}

## Throughput
- Drafts published: ${data.publishedCount}
- Drafts created: ${data.draftsCreated}
- Anomalies flagged: ${data.anomaliesCount}

Write the 200-word weekly recap. Plain prose, no headers, no markdown. Open with the headline finding, name a second specific data point in the middle paragraph, close with one concrete recommendation for next week.`;
}

// ─── One-shot narrate flow ─────────────────────────────────────────────

export interface NarrateResult {
  /** The 200-word recap. */
  narrative: string;
  /** Session ID for audit / replay. */
  sessionId: string;
  /** Token usage from the session — surfaced in the UI for cost visibility. */
  inputTokens: number;
  outputTokens: number;
  /** Total elapsed wall-clock time from session create → idle. */
  elapsedMs: number;
}

/**
 * Spawn a digest agent session, kick it with the digest data, drain
 * events to idle, return the assembled narrative.
 *
 * Why drain-to-idle vs streaming back to the client: the full session
 * round-trip (create → kickoff → 200-word output → idle) measures
 * ~15s on the tuned Sonnet-4.6-no-tools config (smoke-test 2026-05-08).
 * SSE complexity doesn't pay off at that scale — the user pays the
 * latency cost inline and sees the recap appear in one shot. If v2
 * adds the Hyperframes video render path (which is 30-60s), we add
 * SSE there because the wait is long enough to need progress feedback.
 */
export async function narrateDigest(
  client: Anthropic,
  agentId: string,
  environmentId: string,
  data: DigestData,
): Promise<NarrateResult> {
  const startMs = Date.now();

  // Create the session — agent + environment combo gives us a fresh
  // container per run. Title is human-readable for the dashboard.
  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    title: `Weekly digest · ${data.weekEndDate.toISOString().slice(0, 10)}`,
  });

  // Open the stream BEFORE sending the kickoff. The MA docs are clear:
  // events emitted before the stream is open arrive as a buffered batch
  // (or are missed entirely if the connection lags). Stream-first is
  // the canonical pattern.
  const stream = await client.beta.sessions.events.stream(session.id);

  await client.beta.sessions.events.send(session.id, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text: buildDigestKickoffMessage(data) }],
      },
    ],
  });

  // Drain events. We collect text fragments from agent.message events;
  // anything else (thinking, tool use) we ignore for v1. The session
  // finishes when status_idle fires with a terminal stop_reason or
  // session.status_terminated arrives.
  const textChunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of stream) {
    if (event.type === "agent.message") {
      for (const block of event.content) {
        if (block.type === "text") {
          textChunks.push(block.text);
        }
      }
    } else if (event.type === "span.model_request_end") {
      // model_usage carries input/output token counts per inference.
      // Sum across the session for the cost-visibility surface.
      const usage = event.model_usage;
      if (usage) {
        inputTokens += usage.input_tokens ?? 0;
        outputTokens += usage.output_tokens ?? 0;
      }
    } else if (event.type === "session.status_terminated") {
      // Terminal state — break.
      break;
    } else if (event.type === "session.status_idle") {
      // Idle — break only if stop_reason is terminal. requires_action
      // means the agent is waiting on a custom tool result; v1 doesn't
      // use custom tools so this branch is defensive only.
      const stopReason = event.stop_reason?.type;
      if (stopReason && stopReason !== "requires_action") break;
    }
  }

  const elapsedMs = Date.now() - startMs;
  const narrative = textChunks.join("").trim();

  return {
    narrative,
    sessionId: session.id,
    inputTokens,
    outputTokens,
    elapsedMs,
  };
}
