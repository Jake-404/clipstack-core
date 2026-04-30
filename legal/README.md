# legal

Procurement-ready templates for Terms of Service, Privacy, IP ownership, and AI-assisted-content disclosure.

## What these are

Starting points. Each document is structured so a working lawyer can review and adapt rather than draft from a blank page. The voice is plain English; the structure tracks what enterprise procurement reviewers actually look for.

## What these are not

**Not legal advice.** No document in this directory has been reviewed by counsel. Do not deploy them at scale without one. They exist so a self-hoster can stand up a workspace with reasonable defaults and so a hosted SaaS deployment has a starting point its lawyer can edit rather than write from scratch.

## Files

| File | What it covers | Open Q (per plan) |
|---|---|---|
| [`ToS.md`](./ToS.md) | Use of the platform — acceptable use, account, billing, termination, dispute, liability | "ToS shell — counsel-reviewed before mainnet token launch" |
| [`Privacy.md`](./Privacy.md) | Data collection, retention, GDPR/CCPA posture, data processing | Same |
| [`IP-Ownership.md`](./IP-Ownership.md) | Customer owns generated artifacts; per-workspace data isolation; opt-in to shared improvement | Doc 5 §1.5 P0 — must answer before first paying user |
| [`AI-Disclosure.md`](./AI-Disclosure.md) | AI-assisted content disclosure language for outputs — what disclosure to inject, when | A.1 P0 |
| [`DPA.md`](./DPA.md) | Data Processing Agreement template — for agencies-with-EU-clients | Pre-launch (per plan §"Open Qs" #4) |

## Hosted vs. self-hosted

- **Hosted SaaS** (`clipstack.app`) — `hosted/legal/` overrides these defaults with the production-deployed, counsel-reviewed versions. Don't ship these MIT templates as production legal text.
- **Self-hosted** — workspaces use these defaults until they swap in their own. The `hosted/onboarding/` flow doesn't apply to self-hosters; they take responsibility for their own legal posture.

## How to use a template

1. Read it end-to-end.
2. Make a copy in your own workspace's repo (or in `hosted/legal/<your-deployment>/`).
3. Hand to counsel. They will edit. That is normal.
4. Never edit these MIT-licensed templates *here* with deployment-specific terms — they're shared starting points, not your contract.
