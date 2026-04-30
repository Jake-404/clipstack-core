# Contributing to Clipstack Core

Thanks for considering a contribution. A few ground rules before you open a PR.

## The hard rule

**`core/` cannot import from `signals/`.** Period. This is enforced in CI via `scripts/check-core-isolation.sh`. The `core/` tree must build and run end-to-end with `signals/` deleted from disk. If you find yourself reaching for a regulatory regime, an algorithm heuristic, a persona library, or a crisis playbook from inside `core/`, that's a sign the abstraction lives in the wrong place — open a discussion, not a PR with the import.

## Other ground rules

- **No new tokens, fonts, colours, animations, or shadows** outside `services/approval-ui/lib/design-tokens/`. Doc 8 of the build spec is the source of truth; deviations get rejected.
- **Numbers are mono.** Every metric, ID, hash, price, timestamp uses `font-mono tabular-nums`. Non-negotiable.
- **No multi-agent chat surfaces.** Only the orchestrator (Mira) gets a chat dock. Hierarchy-of-interaction rule.
- **Adapters use the abstract interface.** Concrete CRM/CMS/Analytics/Ads adapters extend the base class in `services/adapters/<category>/base.py`. The platform calls against the interface only.
- **Every external-facing output passes through QA critics.** Brand-safety + claim-verifier + devil's-advocate. No bypass.
- **Smoke-test what you ship.** Typecheck after touching TypeScript. Run a representative request after touching a route. Don't ship "shipped, please verify."

## Workflow

1. Open an issue describing the change before significant work.
2. Branch from `main`. Use a descriptive name: `feat/`, `fix/`, `chore/`, `docs/` prefixes.
3. CI must pass: lint, typecheck, isolation check, eval suite.
4. PRs need a one-paragraph "why" and a verification note ("I tested X by Y").

## License

By submitting a PR, you agree your contribution is MIT-licensed.
