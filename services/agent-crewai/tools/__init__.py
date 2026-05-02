"""CrewAI tool stubs — Phase A.0/A.1.

Each tool is a CrewAI `BaseTool` with a typed input schema and a body that
returns placeholder data. The roadmap below names the phase that wires it
to a real backend.

| Tool                       | Wired in | Backend                                          |
|----------------------------|----------|--------------------------------------------------|
| recall_lessons             | A.0      | Postgres + Qdrant (USP 5; already shipped local) |
| retrieve_high_performers   | A.2      | Postgres post_metrics + content_embeddings       |
| voice_score                | A.2      | services/voice-scorer (SetFit + corpus)          |
| brand_safety_check         | A.2      | services/brand-safety (regex + CLASSIFIER_MODEL) |
| asset_search               | A.2      | brand-kit asset library + Qdrant embeddings       |
| pay_and_fetch              | 5.1      | x402 outbound (USP-C1)                           |
| claim_verifier             | B        | services/provenance (USP 8)                      |
| hashtag_intel              | A.3      | per-platform algorithm pollers (Doc 4 §2.6)      |
| register_bandit            | post-A.3 | services/bandit-orchestrator (Doc 4 §2.3)        |
| recent_anomalies           | post-A.3 | services/performance-ingest /anomaly/scan        |
"""
