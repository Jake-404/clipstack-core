"""CrewAI tool stubs — Phase A.0.

Each tool is a CrewAI `BaseTool` with a typed input schema and a body that
returns placeholder data. The roadmap below names the phase that wires it
to a real backend.

| Tool                       | Wired in | Backend                                          |
|----------------------------|----------|--------------------------------------------------|
| recall_lessons             | A.0      | Postgres + Qdrant (USP 5; already shipped local) |
| retrieve_high_performers   | A.2      | Postgres post_metrics + content_embeddings       |
| voice_score                | A.2      | services/voice-scorer (SetFit + corpus)          |
| asset_search               | A.2      | brand-kit asset library + Qdrant embeddings       |
| pay_and_fetch              | 5.1      | x402 outbound (USP-C1)                           |
| claim_verifier             | B        | services/provenance (USP 8)                      |
| hashtag_intel              | A.3      | per-platform algorithm pollers (Doc 4 §2.6)      |
"""
