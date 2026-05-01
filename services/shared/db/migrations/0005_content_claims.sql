-- 0005_content_claims.sql — USP 8 content provenance.
--
-- Each draft carries a list of claims (statement + supporting_url + snippet).
-- This table normalises the JSONB array on `drafts.claims` so the verifier
-- can re-fetch sources, snippet-match cited text, and detect drift /
-- link-rot / unsupported assertions over time.
--
-- The claim graph: a draft has many claims; claims are versioned via
-- (draft_id, retrieved_at) pairs; the latest verifier run sets verifier_status.
-- A future slice extends with claim-to-claim relationships (citation reuse,
-- contradicting claims, etc.).
--
-- Apply after 0004_post_metrics.sql.

DO $$ BEGIN
  CREATE TYPE claim_verifier_status AS ENUM (
    'pending',      -- not yet verified
    'verified',     -- snippet matches source text
    'drift',        -- snippet differs from source text (page edited / phrasing shifted)
    'dead_link',    -- supporting_url returned 4xx/5xx or DNS-failed
    'unsupported',  -- source no longer supports the claim's literal sense (LLM-judged)
    'paywalled',    -- source behind a paywall the verifier can't bypass
    'rate_limited'  -- transient: try later, don't downgrade verified state
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS content_claims (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id               UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id                UUID REFERENCES companies(id) ON DELETE CASCADE,
  draft_id                 UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,

  -- The claim itself.
  statement                TEXT NOT NULL CHECK (length(statement) BETWEEN 1 AND 4000),
  supporting_url           TEXT,            -- nullable: some claims are policy / definition
  snippet                  TEXT,            -- the cited substring of the source page
  snippet_hash             TEXT,            -- sha256 of normalised snippet for fast equality check

  -- Verification state.
  verifier_status          claim_verifier_status NOT NULL DEFAULT 'pending',
  verifier_score           DOUBLE PRECISION CHECK (
    verifier_score IS NULL OR (verifier_score >= 0 AND verifier_score <= 1)
  ),
  verifier_last_run_at     TIMESTAMPTZ,
  verifier_details_json    JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- Provenance tracking.
  retrieved_at             TIMESTAMPTZ,     -- when the snippet was originally extracted
  authored_by_agent_id     UUID REFERENCES agents(id) ON DELETE SET NULL,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_claims_draft ON content_claims(draft_id);
CREATE INDEX IF NOT EXISTS idx_content_claims_company_status
  ON content_claims(company_id, verifier_status, verifier_last_run_at);
-- Stale-claim queue: "verified more than 30 days ago" is a candidate for re-verification.
CREATE INDEX IF NOT EXISTS idx_content_claims_stale
  ON content_claims(company_id, verifier_last_run_at)
  WHERE verifier_status = 'verified';

-- ─── Updated-at trigger ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_content_claims_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_claims_updated_at ON content_claims;
CREATE TRIGGER content_claims_updated_at
  BEFORE UPDATE ON content_claims
  FOR EACH ROW
  EXECUTE FUNCTION touch_content_claims_updated_at();

-- ─── RLS (mirrors 0002 pattern) ─────────────────────────────────────────
ALTER TABLE content_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON content_claims;
CREATE POLICY tenant_isolation ON content_claims
  USING (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

-- ─── Grants ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON content_claims TO clipstack_app;
