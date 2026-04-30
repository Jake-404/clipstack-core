# adapters

Per-integration interface contracts for Clipstack core. **Phase A.0 ships interfaces only — no concrete implementations.**

## The pattern (mandatory — Doc 6 §14)

Every integration follows the same shape:

1. `<category>/base.ts` — TypeScript interface + result types. Used by the UI to render status, errors, and per-workspace adapter selection.
2. `<category>/base.py` — Python `ABC` mirroring the TS interface. Used by `services/agent-crewai/` + `services/agent-langgraph/` to call into the integration.
3. `<category>/<vendor>.{ts,py}` — concrete implementations (Phase A.2 onward; some land in vertical packs in `signals/`).

Strategy / engagement / lifecycle agents call the abstract interface only. The concrete adapter is selected per-workspace at runtime. This means:

- Switching vendor (e.g. HubSpot → Twenty) is a workspace setting, never a code change.
- Multi-vendor agencies configure different adapters per client.
- Mocking for tests is trivial.
- New vendors are additive, never breaking.

## Categories

| Category | A.0 status | Phase 1 vendors (planned) |
|---|---|---|
| `crm/` | ✓ base.ts + base.py | Twenty (primary), HubSpot, Salesforce, Attio, Pipedrive |
| `cms/` | ✓ base.ts + base.py | Payload, Directus, Strapi, Ghost |
| `analytics/` | ✓ base.ts + base.py | PostHog (primary), Plausible, Umami |
| `ads/` | ✓ base.ts + base.py | Pipeboard (managed), Google Ads, Meta Ads, TikTok Ads |
| `chat/` | ✓ base.ts + base.py | Chatwoot, Discord, Telegram |
| `email/` | ✓ base.ts + base.py | Listmonk, Mautic, Postmark |
| `video/` | ✓ base.ts + base.py | OpenMontage, Remotion, fal.ai |
| `seo/` | ✓ base.ts + base.py | Ahrefs, DataForSEO, Screaming Frog |

## Phase order for concrete vendors (locked Phase C)

- **A.0** (now): all 8 base interfaces.
- **A.2**: zero concrete adapters — feature work first.
- **B**: zero concrete adapters — provenance + LiteLLM hardening.
- **C**: **all four v1 integrations** ship: Twenty CRM, PostHog analytics, Pipeboard ads, one Headless CMS (vendor TBD per first design partner).
- **C+**: vendors as agencies request them.

## Hard rule

`core/services/adapters/<category>/base.{ts,py}` cannot import from `signals/`. CI gates this in `scripts/check-core-isolation.sh`.

Vertical packs that ship vendor-specific configuration (rate limits, default mappings, brand-safe defaults) live in `signals/<pack>/adapters/<category>/<vendor>.yaml` and are loaded by the concrete adapter's constructor. The interface stays signal-free.
