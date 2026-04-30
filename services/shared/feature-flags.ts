// Feature flags — orthogonal switches (Phase A.0 verification A.0.2).
// The platform must run end-to-end with all of these `false`.
//
// Hard rule: every conditional gate reads from this module.
// Never `process.env.X` directly — always go through these typed accessors so
// the call site shows up in grep when we need to map flag → consumers.

const trueLike = (v: string | undefined) =>
  v !== undefined && ["true", "1", "yes", "on"].includes(v.toLowerCase());

/** Crypto-mode UI surfaces + x402 inbound/outbound + USDC settlement.
 *  Unlocked at Phase 5.x. Default OFF. */
export const CRYPTO_ENABLED = trueLike(process.env.CRYPTO_ENABLED);

/** Redpanda 9-topic event bus + bandits + predicted-percentile pre-publish.
 *  Unlocked Phase A.3. Default OFF. */
export const EVENTBUS_ENABLED = trueLike(process.env.EVENTBUS_ENABLED);

/** mabwiser bandit allocation across published variants.
 *  Requires EVENTBUS_ENABLED. Doc 4 §2.3. */
export const BANDITS_ENABLED = trueLike(process.env.BANDITS_ENABLED) && EVENTBUS_ENABLED;

/** Whether `signals/` packs (regulatory, algorithms, crisis playbooks, personas)
 *  are mounted on this deployment. Self-hosters without signal access run
 *  with this OFF and get the bare critic + generic prompts. */
export const SIGNALS_LOADED = trueLike(process.env.SIGNALS_LOADED);

/** Per-agent autonomous metered spend (CLAUDE.md cost policy + ClipstackAgentBudget.sol).
 *  Off by default. When true, agents within budget cap fire paid calls without per-call approval. */
export const AGENT_BUDGET_AUTONOMOUS = trueLike(process.env.AGENT_BUDGET_AUTONOMOUS);

export const flags = {
  CRYPTO_ENABLED,
  EVENTBUS_ENABLED,
  BANDITS_ENABLED,
  SIGNALS_LOADED,
  AGENT_BUDGET_AUTONOMOUS,
} as const;

export type FlagName = keyof typeof flags;
