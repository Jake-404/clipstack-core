-- 0004_post_metrics.sql — USP 1 closed-loop performance learning.
--
-- Two new tables that turn published-post engagement signals into agent
-- context. Every published draft accrues metrics; every metric row pairs
-- with an embedding so cosine-similarity search against a topic returns
-- this workspace's top historical performers on that topic.
--
-- Apply after 0003_rbac_seed.sql.
--
-- The plan reference: A.2 line 342 — `retrieve_high_performers` tool
-- injected into Strategist + LongFormWriter system prompts.

-- ─── Helpers from 0002 are already in place: app_company_matches() etc. ──

-- ─── post_metrics ─────────────────────────────────────────────────────────
-- One row per (draft, platform, snapshot_at). Polled per Doc 4 §2.2 with
-- <5min SLA when EVENTBUS_ENABLED is on; for A.2 we ingest snapshots on
-- whatever cadence the workspace has wired (manual upload, plausible/posthog
-- export, X/LinkedIn API polling).
CREATE TABLE IF NOT EXISTS post_metrics (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES companies(id) ON DELETE CASCADE,
  draft_id            UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  -- platform mirrors `channel` enum but accepts the same values as text so a
  -- new platform doesn't require enum migration to start collecting metrics
  platform            TEXT NOT NULL,
  snapshot_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Core engagement KPIs. Nullable for platforms that don't report them.
  impressions         BIGINT,
  reach               BIGINT,
  clicks              BIGINT,
  reactions           BIGINT,         -- likes + reactions, normalised
  comments            BIGINT,
  shares              BIGINT,
  saves               BIGINT,
  conversions         BIGINT,
  -- Derived ratios (recomputed from base counts at ingest; stored for index speed)
  ctr                 DOUBLE PRECISION CHECK (ctr IS NULL OR (ctr >= 0 AND ctr <= 1)),
  engagement_rate     DOUBLE PRECISION CHECK (engagement_rate IS NULL OR (engagement_rate >= 0 AND engagement_rate <= 1)),
  conversion_rate     DOUBLE PRECISION CHECK (conversion_rate IS NULL OR (conversion_rate >= 0 AND conversion_rate <= 1)),
  -- Workspace-relative percentile rank within (company, kpi). Computed by a
  -- nightly rollup; lets retrieve_high_performers filter without resorting.
  ctr_percentile      DOUBLE PRECISION CHECK (ctr_percentile IS NULL OR (ctr_percentile >= 0 AND ctr_percentile <= 100)),
  engagement_percentile DOUBLE PRECISION CHECK (engagement_percentile IS NULL OR (engagement_percentile >= 0 AND engagement_percentile <= 100)),
  conversion_percentile DOUBLE PRECISION CHECK (conversion_percentile IS NULL OR (conversion_percentile >= 0 AND conversion_percentile <= 100)),
  -- Pass-through for platform-specific fields (X impressions vs views vs
  -- profile-clicks etc.) without proliferating columns
  raw                 JSONB NOT NULL DEFAULT '{}'::JSONB,
  collected_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_post_metrics_draft ON post_metrics(draft_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_metrics_company_platform ON post_metrics(company_id, platform, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_metrics_high_engagement
  ON post_metrics(company_id, engagement_percentile DESC)
  WHERE engagement_percentile IS NOT NULL;

-- One canonical "latest" row per (draft, platform) — the most recent snapshot.
-- A view to keep retrieval queries from re-doing window functions.
CREATE OR REPLACE VIEW post_metrics_latest AS
  SELECT DISTINCT ON (draft_id, platform)
    *
  FROM post_metrics
  ORDER BY draft_id, platform, snapshot_at DESC;

-- ─── content_embeddings ───────────────────────────────────────────────────
-- One row per draft (or per draft.body version). Stored as bytea fallback in
-- A.1 to match company_lessons; A.2 follow-up alters to vector(384) once we
-- verify pgvector is present in every deployment target.
CREATE TABLE IF NOT EXISTS content_embeddings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES companies(id) ON DELETE CASCADE,
  draft_id            UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  -- Hash of the embedded text — lets us skip re-embedding identical drafts.
  text_hash           TEXT NOT NULL,
  embedding           BYTEA NOT NULL,
  -- 384 default (MiniLM-L6-v2) — used to validate the byte length on read.
  embedding_dim       INTEGER NOT NULL DEFAULT 384,
  model_version       TEXT NOT NULL DEFAULT 'minilm-l6-v2-2024-09',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_embeddings_company ON content_embeddings(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_embeddings_draft_hash
  ON content_embeddings(draft_id, text_hash);

-- ─── Enable RLS on the new tables (consistent with 0002) ─────────────────
ALTER TABLE post_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON post_metrics;
CREATE POLICY tenant_isolation ON post_metrics
  USING (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

ALTER TABLE content_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_embeddings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON content_embeddings;
CREATE POLICY tenant_isolation ON content_embeddings
  USING (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

-- ─── Grants for clipstack_app role ────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON post_metrics, content_embeddings TO clipstack_app;
GRANT SELECT ON post_metrics_latest TO clipstack_app;
