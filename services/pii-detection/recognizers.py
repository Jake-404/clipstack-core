"""Custom Presidio recognizers — CRYPTO_WALLET + API_KEY.

Both are regex-based (Presidio's PatternRecognizer wrapper). The patterns
are tuned for high-precision over recall: a CRYPTO_WALLET hit needs the
full address shape, and API_KEY only fires on common provider prefixes,
so the false-positive rate stays low. Loosening either is a workspace
config decision later — bias-toward-precision matches the "never log
detected text in audit details" PII discipline (Privacy.md §1): when in
doubt, miss it rather than redact-too-aggressively-and-confuse-the-user.
"""

from __future__ import annotations

from presidio_analyzer import Pattern, PatternRecognizer

# ─── CRYPTO_WALLET ──────────────────────────────────────────────────────────
# Three address shapes worth catching today:
#   1. Bitcoin legacy/SegWit (P2PKH/P2SH/Bech32):
#        ^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$
#   2. Ethereum + EVM-compatible (VeChain main+test, Base, Arbitrum, etc):
#        ^0x[a-fA-F0-9]{40}$
#   3. Solana (base58, 32-44 chars, no 0/O/I/l):
#        ^[1-9A-HJ-NP-Za-km-z]{32,44}$
# Solana intentionally omitted from v1 — its base58 charset overlaps
# heavily with regular text and produces false positives. Add when a
# workspace explicitly opts in.

_CRYPTO_PATTERNS = [
    Pattern(
        name="bitcoin_address",
        # Word-boundary anchored so we don't match mid-word.
        regex=r"\b(?:bc1[a-zA-HJ-NP-Z0-9]{25,39}|[13][a-zA-HJ-NP-Z0-9]{25,39})\b",
        score=0.85,
    ),
    Pattern(
        name="evm_address",
        # 0x + 40 hex chars. Ethereum, VeChain (VET/VTHO contracts), Base,
        # Arbitrum, Polygon — all share this format.
        regex=r"\b0x[a-fA-F0-9]{40}\b",
        score=0.9,
    ),
]


CryptoWalletRecognizer = PatternRecognizer(
    supported_entity="CRYPTO_WALLET",
    patterns=_CRYPTO_PATTERNS,
    # No context words: a wallet address is identifiable by shape alone,
    # and adding context (e.g., "address", "wallet") would inflate FP on
    # generic mentions like "Etherscan address".
    context=[],
)


# ─── API_KEY ────────────────────────────────────────────────────────────────
# Provider-prefix patterns. Far from exhaustive — covers the most common
# leak shapes the platform will see in inbound briefs / pasted code:
#
#   sk-… / sk_…   → OpenAI / Anthropic / Stripe / many others
#   pk_…          → Stripe publishable
#   ghp_… / gho_… → GitHub PAT / OAuth
#   xoxb-…        → Slack bot
#   AKIA…         → AWS access key id
#
# The `key_…` workspace-internal naming pattern is intentionally NOT here
# — `key_user_pref` and similar are noise.

_API_KEY_PATTERNS = [
    Pattern(
        name="openai_anthropic_stripe_secret",
        # sk-XXXXXXXX with at least 16 follow chars (covers test + live keys).
        regex=r"\bsk-[A-Za-z0-9_-]{16,}\b",
        score=0.9,
    ),
    Pattern(
        name="stripe_secret_underscore",
        # sk_test_… / sk_live_… variant.
        regex=r"\bsk_(?:test|live)_[A-Za-z0-9]{16,}\b",
        score=0.95,
    ),
    Pattern(
        name="stripe_publishable",
        regex=r"\bpk_(?:test|live)_[A-Za-z0-9]{16,}\b",
        score=0.9,
    ),
    Pattern(
        name="github_pat",
        # Personal access token (classic + fine-grained).
        regex=r"\bgh[ps]_[A-Za-z0-9]{36,}\b",
        score=0.95,
    ),
    Pattern(
        name="github_oauth",
        regex=r"\bgho_[A-Za-z0-9]{36,}\b",
        score=0.95,
    ),
    Pattern(
        name="slack_bot_token",
        regex=r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b",
        score=0.95,
    ),
    Pattern(
        name="aws_access_key_id",
        regex=r"\bAKIA[0-9A-Z]{16}\b",
        score=0.95,
    ),
]


ApiKeyRecognizer = PatternRecognizer(
    supported_entity="API_KEY",
    patterns=_API_KEY_PATTERNS,
    context=[],
)


def custom_recognizers() -> list[PatternRecognizer]:
    """All Clipstack-defined recognizers in one list. Wired by main.py."""
    return [CryptoWalletRecognizer, ApiKeyRecognizer]
