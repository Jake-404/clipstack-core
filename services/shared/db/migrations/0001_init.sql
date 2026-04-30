-- 0001_init.sql — tenant data model.
--
-- Declarative DDL for the Clipstack core tenant tables. Idempotent
-- (CREATE TABLE IF NOT EXISTS / DO blocks for type creation). Apply
-- before 0002_enable_rls.sql.
--
-- Shape mirrors services/shared/schemas/*.ts (zod) and *.py (pydantic).
-- When you change one, change all three in the same PR — CI structural
-- diff lands in A.2 to enforce.

-- ─── Extensions ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- pgvector for company_lessons.embedding — installed if available; absence
-- doesn't block the migration in A.1 (the column drops to bytea fallback).
-- A.2 makes this a hard requirement once recall_lessons goes live.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    BEGIN
      CREATE EXTENSION vector;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'vector extension unavailable; lessons.embedding will fall back to bytea in A.1';
    END;
  END IF;
END$$;

-- ─── Enums ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE company_type AS ENUM ('agency', 'client', 'in_house', 'solo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ui_mode AS ENUM ('web2', 'web3');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agent_role AS ENUM (
    'orchestrator', 'researcher', 'strategist', 'long_form_writer',
    'social_adapter', 'newsletter_adapter', 'brand_qa', 'devils_advocate_qa',
    'engagement', 'lifecycle', 'trend_detector', 'algorithm_probe',
    'live_event_monitor', 'claim_verifier', 'compliance'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agent_status AS ENUM ('idle', 'working', 'blocked', 'asleep', 'fired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lesson_kind AS ENUM ('human_denied', 'critic_blocked', 'policy_rule');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lesson_scope AS ENUM ('forever', 'this_topic', 'this_client');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE approval_kind AS ENUM (
    'draft_publish', 'engagement_reply', 'campaign_launch',
    'agent_replacement', 'reactive_trend', 'skill_install',
    'voice_corpus_add', 'metered_spend_unlock'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'denied', 'expired', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE deny_scope AS ENUM ('forever', 'this_topic', 'this_client');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE draft_status AS ENUM (
    'drafting', 'in_review', 'awaiting_approval', 'approved',
    'scheduled', 'published', 'denied', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE channel AS ENUM ('x', 'linkedin', 'reddit', 'tiktok', 'instagram', 'newsletter', 'blog');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE actor_kind AS ENUM ('user', 'agent', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE meter_event_kind AS ENUM (
    'publish', 'metered_asset_generation', 'x402_outbound_call',
    'x402_inbound_call', 'voice_score_query', 'compliance_check'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE permission_action AS ENUM (
    'read', 'create', 'update', 'delete', 'approve', 'deny',
    'publish', 'invite', 'revoke', 'export', 'admin'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Tables ────────────────────────────────────────────────────────────────

-- companies — the tenant root.
-- Self-referential parent_company_id models the agency → client nesting.
CREATE TABLE IF NOT EXISTS companies (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  type                company_type NOT NULL,
  parent_company_id   UUID REFERENCES companies(id) ON DELETE RESTRICT,
  ui_mode             ui_mode NOT NULL DEFAULT 'web2',
  brand_kit_id        UUID,                   -- FK target lands when brand_kits ships
  active_regimes      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  context_json        JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_companies_parent ON companies(parent_company_id) WHERE parent_company_id IS NOT NULL;

-- users — global identity (workspace-independent).
-- workos_user_id is populated by the WorkOS SSO callback; null until linked.
CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email               TEXT NOT NULL UNIQUE,
  name                TEXT,
  ui_mode             ui_mode NOT NULL DEFAULT 'web2',
  workos_user_id      TEXT UNIQUE,
  mfa_enrolled_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- memberships — user × company × role.
-- A user can have at most one active membership per (company_id, client_id).
-- client_id is null for agency-wide grants.
CREATE TABLE IF NOT EXISTS memberships (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES companies(id) ON DELETE CASCADE,
  role_id             UUID NOT NULL,          -- FK to roles below
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at          TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_active
  ON memberships(user_id, company_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memberships_company ON memberships(company_id);

-- roles — workspace-scoped role definitions.
-- Default roles seed in 0003_rbac_seed.sql; workspaces can clone + customise.
CREATE TABLE IF NOT EXISTS roles (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  slug                TEXT NOT NULL,           -- 'owner', 'admin', 'member', 'client_guest', or custom
  display_name        TEXT NOT NULL,
  description         TEXT,
  is_default          BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_company_slug ON roles(company_id, slug);

-- permissions — role × resource × action × allow/deny.
-- Resources are strings (not enum) to allow new resource types without DDL.
CREATE TABLE IF NOT EXISTS permissions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_id             UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  resource            TEXT NOT NULL,           -- 'draft', 'approval', 'agent', 'lesson', 'billing', etc.
  action              permission_action NOT NULL,
  allow               BOOLEAN NOT NULL DEFAULT true,
  client_id           UUID REFERENCES companies(id) ON DELETE CASCADE,  -- null = applies to all clients
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_unique
  ON permissions(company_id, role_id, resource, action,
                 COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_permissions_role ON permissions(role_id);

-- agents — per-company agent personas.
CREATE TABLE IF NOT EXISTS agents (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role                agent_role NOT NULL,
  display_name        TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  job_description     TEXT NOT NULL CHECK (length(job_description) BETWEEN 1 AND 2000),
  status              agent_status NOT NULL DEFAULT 'idle',
  model_profile       TEXT NOT NULL DEFAULT 'WRITER_MODEL',
  tools_allowed       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  spawned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agents_company ON agents(company_id);

-- company_lessons — USP 5 editorial memory.
-- embedding column is vector(384) when pgvector is installed; bytea fallback otherwise.
CREATE TABLE IF NOT EXISTS company_lessons (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES companies(id) ON DELETE CASCADE,
  kind                lesson_kind NOT NULL,
  scope               lesson_scope NOT NULL,
  rationale           TEXT NOT NULL CHECK (length(rationale) BETWEEN 20 AND 2000),
  topic_tags          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  embedding           BYTEA,                   -- A.2 alters to vector(384) when pgvector is verified
  captured_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  captured_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lessons_company ON company_lessons(company_id);
CREATE INDEX IF NOT EXISTS idx_lessons_scope ON company_lessons(company_id, scope) WHERE scope = 'forever';

-- drafts — every artifact the platform produces.
CREATE TABLE IF NOT EXISTS drafts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES companies(id) ON DELETE CASCADE,
  parent_draft_id     UUID REFERENCES drafts(id) ON DELETE SET NULL,
  channel             channel NOT NULL,
  status              draft_status NOT NULL DEFAULT 'drafting',
  title               TEXT,
  body                TEXT NOT NULL,
  hashtags            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  claims              JSONB NOT NULL DEFAULT '[]'::JSONB,
  voice_score         DOUBLE PRECISION CHECK (voice_score IS NULL OR (voice_score >= 0 AND voice_score <= 1)),
  predicted_percentile DOUBLE PRECISION CHECK (predicted_percentile IS NULL OR (predicted_percentile >= 0 AND predicted_percentile <= 100)),
  authored_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  approval_id         UUID,                    -- FK target on approvals (deferred to avoid cycle)
  scheduled_at        TIMESTAMPTZ,
  published_at        TIMESTAMPTZ,
  published_url       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drafts_company_status ON drafts(company_id, status);
CREATE INDEX IF NOT EXISTS idx_drafts_parent ON drafts(parent_draft_id) WHERE parent_draft_id IS NOT NULL;

-- approvals — the human-action queue.
CREATE TABLE IF NOT EXISTS approvals (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES companies(id) ON DELETE CASCADE,
  kind                approval_kind NOT NULL,
  status              approval_status NOT NULL DEFAULT 'pending',
  payload             JSONB NOT NULL,
  created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at          TIMESTAMPTZ,
  deny_rationale      TEXT CHECK (deny_rationale IS NULL OR length(deny_rationale) BETWEEN 20 AND 2000),
  deny_scope          deny_scope,
  expires_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_approvals_company_status ON approvals(company_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(company_id, created_at DESC) WHERE status = 'pending';

-- audit_log — append-only.
CREATE TABLE IF NOT EXISTS audit_log (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES companies(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,           -- string not enum to allow future kinds without DDL
  actor_kind          actor_kind NOT NULL,
  actor_id            TEXT,
  details_json        JSONB NOT NULL DEFAULT '{}'::JSONB,
  commitment_hash     TEXT,                    -- weeks 9-10: zk Layer A Poseidon commitment
  trace_id            TEXT,                    -- Langfuse trace id round-trip
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_company_time ON audit_log(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_kind ON audit_log(company_id, kind, occurred_at DESC);

-- meter_events — USP 10 metering counter.
CREATE TABLE IF NOT EXISTS meter_events (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES companies(id) ON DELETE CASCADE,
  kind                meter_event_kind NOT NULL,
  quantity            DOUBLE PRECISION NOT NULL CHECK (quantity >= 0),
  unit_cost_usd       DOUBLE PRECISION CHECK (unit_cost_usd IS NULL OR unit_cost_usd >= 0),
  total_cost_usd      DOUBLE PRECISION CHECK (total_cost_usd IS NULL OR total_cost_usd >= 0),
  ref_kind            TEXT,
  ref_id              TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meter_company_time ON meter_events(company_id, occurred_at DESC);

-- updated_at triggers — keep companies / users / drafts / agents fresh.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ BEGIN
  CREATE TRIGGER companies_touch BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER users_touch BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER drafts_touch BEFORE UPDATE ON drafts
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
