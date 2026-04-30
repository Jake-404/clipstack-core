# AI-Assisted Content Disclosure — template

> **Template, not advice.** Have counsel review before deploying this disclosure language. Last reviewed by counsel: *(none)*.

Where required by regulation or platform rules, content produced through Clipstack should carry a disclosure that AI assisted in its creation. This document specifies *when* to disclose and *what language* to use.

## 1. When disclosure is required

The legal landscape varies by jurisdiction and platform. As of 2026:

| Trigger | Disclosure required? | Source |
|---|---|---|
| EU AI Act — generative content marketed as "AI-generated" | Yes (Art. 52) | EU AI Act, in force 2025 |
| FTC endorsement guidelines (US) — "material connections" framing | Where content is endorsement-shaped and AI processed | FTC Endorsement Guides 2023 |
| Coalition for Content Provenance and Authenticity (C2PA) — ad platforms increasingly require | Implicit signing, optional explicit text | C2PA spec |
| Most platform ToS (LinkedIn, Meta, X, TikTok) — synthetic media labelling | Conditional on synthetic-media percentage | Per-platform |
| Health / financial advice content | Always, plus regulated-claim disclosure | Domain-specific (FDA / FCA / SEC / MiCA) |

Workspaces with active regulatory regimes (`companies.activeRegimes` in the schema — e.g., `mica`, `fca`, `fda`) auto-inject the corresponding disclosure block. The compliance-pack loader resolves which disclosure applies; the BrandQA agent enforces.

## 2. Standard disclosure language

### General — short form (≤120 chars, post body)

> *Drafted with AI assistance and reviewed by a human editor.*

Use for: social posts, blog headers, short newsletter pieces. The "reviewed by a human editor" half is load-bearing — it accurately describes the platform's HITL flow and matches the FTC's "material connection" framing.

### General — long form (footer or end-of-article)

> *This piece was drafted with AI assistance and reviewed by a member of our team before publication. AI tools used: Clipstack platform with [model profile]. Source citations are inline; verification is welcomed.*

Use for: long-form articles, press releases, anything where reader trust is load-bearing.

### Regulated-claim — financial (FCA / MiCA / SEC)

> *Capital at risk. This content was drafted with AI assistance and reviewed by a human. It is for general information and is not a recommendation, advice, or solicitation. Consult an authorised adviser before acting.*

Auto-injected when `active_regimes` includes `fca`, `mica`, or `sec`. The brand-safety scanner (`brand_safety_check` tool) emits `severity='disclosure_required'` for any draft mentioning yield, returns, market price, or instrument class.

### Regulated-claim — health (FDA / EMA / TGA)

> *AI-assisted content reviewed by a human. This material is for educational purposes and is not medical advice. Consult a qualified healthcare professional before making treatment decisions.*

Auto-injected when `active_regimes` includes `fda`, `ema`, or `tga`.

### Regulated-claim — legal

> *AI-assisted content reviewed by a human. This is general information, not legal advice. For specific situations, consult a licensed lawyer in your jurisdiction.*

Auto-injected when `active_regimes` includes `legal`.

## 3. Where the disclosure goes

| Surface | Placement |
|---|---|
| LinkedIn post | First or last paragraph; inline preferred over footer |
| X / Twitter thread | End of last tweet, before any signature |
| Newsletter | Footer, before the unsubscribe link |
| Blog post | After title, before article body — or as a footer block — your editorial choice |
| Video caption | Description field, top section |
| Audio / podcast | Show notes; audio mention not required unless platform-specific rule |

## 4. C2PA provenance signing (deferred)

C2PA-signed assets (cryptographically attested AI provenance, embedded in image/video metadata) are deferred to platform v2 — heavy native dependency cost (`c2pa-python` + signing toolchain). Workspaces that need C2PA today should sign post-export with a vendor tool.

When C2PA ships natively, it pairs with USP 8 (claim verification) — every asset carries a provenance bundle linking back to the workspace's claim graph.

## 5. The boundary

These templates exist so a workspace can ship reasonable defaults. They are not a substitute for:

- Counsel reviewing the language for your jurisdiction.
- Your own editorial standards on disclosure tone.
- Platform-specific labelling tools (e.g., LinkedIn's AI-content label, X's synthetic-media label) which apply *in addition* to text disclosure.

## 6. The non-disclosure path

Some content does not need disclosure: internal-only briefs, draft material that won't ship, conversations with an agent in your workspace's chat surface that don't produce published artifacts. The disclosure attaches to *publication*, not to *use of AI*.

---

*Template version: 0.1.0.*
