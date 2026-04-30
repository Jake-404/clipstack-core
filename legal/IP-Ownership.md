# IP Ownership — template

> **Template, not advice.** Have counsel review before you ship this to a paying customer. Last reviewed by counsel: *(none)*.

Plain version: **what you create using the platform is yours.** Long version below.

## 1. Customer-owned artifacts

You own everything you create or upload to your workspace:

- **Brand kits** — logos, palettes, voice notes, design tokens
- **Voice corpora** — your samples of approved voice
- **Lessons** — captured from approval denials, brand-safety blocks, policy rules
- **Drafts and shipped content** — all output the platform produces under your direction
- **Approval rationales** — the reasoning you record when you deny a draft
- **Performance data** — where you've connected analytics

You can export these any time from your workspace settings, in standard formats:
- Structured data (lessons, agent configurations, approvals): JSON
- Content artifacts (drafts, brand-kit text): Markdown
- Tabular data (post metrics, audit log): CSV

On cancellation we provide a complete export bundle (see [Privacy.md](./Privacy.md) §6).

## 2. Per-workspace data isolation

The platform's institutional-memory layer is per-tenant. Your lessons, voice corpus, and performance data shape *your* future drafts. They never shape anyone else's.

This isolation is structural, not policy:

- **Postgres** — row-level security on every tenant-scoped table; isolation enforced at the database connection level, not the application layer.
- **Vector store** — Qdrant collections are workspace-scoped; cross-workspace queries are physically impossible.
- **LLM context** — agent system prompts include only the requesting workspace's lessons + voice samples. There is no shared-corpus injection step.
- **Audit** — every read of workspace data writes an audit row including workspace ID + actor; cross-workspace reads (which only happen during platform support actions with documented authorization) generate distinct audit kinds.

## 3. Platform-level IP

The platform itself — orchestration framework, UI shell, adapter interfaces, critic-reviser loop, mistake-ledger schema — ships under MIT. You can fork, self-host, modify, redistribute. See `LICENSE`.

The signal packs (regulatory rules, algorithm heuristics, crisis playbooks, persona libraries, voice corpora seed weights, KOL roster) are proprietary. Their use is governed by your signal-pack license — separate from these Terms.

When you write your own signal-pack rules, persona configs, regulatory YAMLs, etc., those belong to you. The *framework* for using them belongs to the platform's MIT license.

## 4. AI-generated outputs and copyright

US, UK, and EU jurisprudence on AI-generated copyright is unsettled. As of 2026:

- US: works "produced by a machine or mere mechanical process" without "creative contribution from a human author" are not copyrightable in the US. Substantial human creative contribution restores copyrightability.
- UK: computer-generated works have a 50-year copyright term under CDPA s.9(3), with the author being "the person by whom the arrangements necessary for the creation of the work are undertaken" — which in this context is you, the workspace owner, as the human directing the agents.
- EU: shifts toward requiring "human author" element similar to US.

**What this means for you:** If you publish output verbatim with no human edit, your copyright posture is weak in the US and EU and limited in the UK. If you edit, select, arrange, or reframe — the typical workflow on this platform, since drafts go through human approval — you've made a creative contribution and the copyright posture strengthens.

We are not your lawyer. If copyright protection on outputs is load-bearing for your business model, get jurisdiction-specific advice.

## 5. Sharing improvements (optional)

We offer an opt-in shared-improvement program where you can contribute anonymised lesson patterns, voice-classifier improvements, or crisis-playbook templates to a shared pool that benefits other workspaces. In exchange you receive credits or a tier discount, disclosed at the time of opt-in.

This is **opt-in, not default.** Default posture: nothing of yours leaves your workspace.

If you opt in:
- We anonymise — workspace ID, client ID, and any PII detected by Presidio are stripped before contribution.
- You can opt out at any time. Already-contributed patterns can be requested for removal; we honour this within 30 days.
- The shared pool is governed by a separate Contributor License Agreement.

## 6. Inputs you upload

You warrant that you have rights to use, process, and let the platform process the materials you upload. If a third party claims your upload infringed their IP, you indemnify the platform for the third-party claim arising from your upload (subject to the liability cap in the Terms of Service).

## 7. Output review responsibility

The platform produces drafts. You review and approve. You decide what gets published. Outputs may include:

- Citations that the platform's claim verifier flagged as drifted (you saw the flag, you decided)
- Adaptations of your brand voice that miss the mark (you scored them, you approved)
- Content that, however technically compliant, lands wrong with your audience (your judgement call)

This is by design. The platform supplies the rails; you supply the editorial judgment. Liability for what ships is yours.

## 8. Changes

Material changes to IP posture (e.g., a new shared-improvement program type) require explicit opt-in at change time, not deemed acceptance via continued use.

---

*Template version: 0.1.0. Workspace deployment must replace placeholders, have counsel review, and append a "Last updated" date.*
