-- 0006_draft_revisions.sql — Phase B.4 (HITL surfaces) — branch view backing.
--
-- The publish_pipeline's review_cycle node currently bumps `revision_count`
-- on `PublishState` but doesn't persist the intermediate body / scores /
-- critic notes anywhere. The Mission Control branch view surface (Doc 4 §4
-- HITL co-creation) needs that history so a human approver can:
--   (a) see what each revision said + scored
--   (b) compare side-by-side against any prior revision
--   (c) follow the verdict chain (revise → revise → pass) at a glance
--
-- Tree shape: most cases are linear (max-3 revisions in sequence). A branch
-- forms when percentile_gate reroutes to review_cycle after one already
-- passed — that's a separate sub-chain. parent_revision_id captures both.
--
-- Apply after 0005_content_claims.sql.

DO $$ BEGIN
  CREATE TYPE review_verdict AS ENUM (
    'pass',     -- review-cycle critic cleared the draft
    'revise',   -- fixable issues; LangGraph routes back through review_cycle
    'block'     -- structural problem; routes to record_block_lesson
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS draft_revisions (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id               UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id                UUID REFERENCES companies(id) ON DELETE CASCADE,
  draft_id                 UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,

  -- Self-reference forms the tree. NULL = initial revision (revision_number=0).
  parent_revision_id       UUID REFERENCES draft_revisions(id) ON DELETE SET NULL,

  -- 0-indexed; matches PublishState.revision_count at the moment of capture.
  revision_number          INTEGER NOT NULL CHECK (revision_number >= 0),

  -- Snapshot of the body at this revision. Stored verbatim so the branch
  -- view can render or diff without consulting any other source.
  body                     TEXT NOT NULL,

  -- Critic outputs at this revision. Null when the critic hasn't run yet.
  voice_score              DOUBLE PRECISION CHECK (
    voice_score IS NULL OR (voice_score >= 0 AND voice_score <= 1)
  ),
  voice_passes             BOOLEAN,
  predicted_percentile     DOUBLE PRECISION CHECK (
    predicted_percentile IS NULL OR (predicted_percentile >= 0 AND predicted_percentile <= 100)
  ),
  predicted_percentile_low  DOUBLE PRECISION,
  predicted_percentile_high DOUBLE PRECISION,
  critic_notes             TEXT,
  review_verdict           review_verdict,

  -- Provenance: which agent/run produced this revision.
  authored_by_agent_id     UUID REFERENCES agents(id) ON DELETE SET NULL,
  langgraph_run_id         TEXT,        -- match against PublishState.run_id

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draft_revisions_draft
  ON draft_revisions(draft_id, revision_number);
CREATE INDEX IF NOT EXISTS idx_draft_revisions_company_run
  ON draft_revisions(company_id, langgraph_run_id);
-- Two revisions of the same draft can't share a revision_number — enforces
-- the linearity assumption inside a single branch (sub-branches differ on
-- parent_revision_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_draft_revisions_draft_branch_number
  ON draft_revisions(draft_id, COALESCE(parent_revision_id::text, ''), revision_number);

-- ─── RLS (mirrors 0002 pattern) ─────────────────────────────────────────
ALTER TABLE draft_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON draft_revisions;
CREATE POLICY tenant_isolation ON draft_revisions
  USING (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

-- ─── Grants ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON draft_revisions TO clipstack_app;
