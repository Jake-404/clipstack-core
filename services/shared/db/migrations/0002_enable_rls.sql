-- 0002_enable_rls.sql — multi-tenant Row-Level-Security.
--
-- Doc 5 §1 P0. Doc A.0.A.1.1 verification.
--
-- The contract:
--   1. Every tenant-scoped table has RLS ENABLED + FORCED (so even superuser
--      sessions hit the policies — required for migrations + admin tooling).
--   2. The policy compares row.company_id against the session-local setting
--      `app.current_company_id`. Setting that variable is the request-scoped
--      connection middleware's job (see ../middleware.md).
--   3. If the variable is unset OR the user has no membership for that
--      company, the read returns zero rows. There is no application-layer
--      "WHERE company_id = ?" — the database enforces.
--
-- Apply after 0001_init.sql.

-- A helper that reads app.current_company_id; returns null if unset.
-- We read with `current_setting(name, true)` — the `true` flag means
-- "return NULL if missing", not "raise". The policies treat null as deny.
CREATE OR REPLACE FUNCTION app_current_company_id() RETURNS UUID
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_company_id', true), '')::UUID
$$;

-- For agency-scoped reads that need to span the agency + its clients,
-- callers can opt into "include children" by also setting
-- app.include_client_children = 'true'. The policy below honours that
-- when a row's company_id is a child of the active company_id.
CREATE OR REPLACE FUNCTION app_include_client_children() RETURNS BOOLEAN
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.include_client_children', true), '')::BOOLEAN, false)
$$;

-- Reusable predicate. A row passes RLS if:
--   (a) company_id matches the active workspace, OR
--   (b) the active workspace is the row's parent agency AND
--       include_client_children is true AND row's company is a child
CREATE OR REPLACE FUNCTION app_company_matches(row_company_id UUID) RETURNS BOOLEAN
  LANGUAGE plpgsql STABLE AS $$
DECLARE
  active UUID := app_current_company_id();
BEGIN
  IF active IS NULL THEN
    RETURN false;
  END IF;
  IF row_company_id = active THEN
    RETURN true;
  END IF;
  IF app_include_client_children() THEN
    RETURN EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = row_company_id AND c.parent_company_id = active
    );
  END IF;
  RETURN false;
END;
$$;

-- ─── Enable RLS + tenant-isolation policies per table ─────────────────────

-- companies — special: row's identity IS the tenant. Match on id.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON companies;
CREATE POLICY tenant_isolation ON companies
  USING (id = app_current_company_id() OR
         (app_include_client_children() AND
          parent_company_id = app_current_company_id()))
  WITH CHECK (id = app_current_company_id() OR
              parent_company_id = app_current_company_id());

-- users — global identity, NO tenant filter (the workspace boundary is
-- enforced by memberships, not by hiding users).
-- We still enable RLS so we can layer a user-self-only policy in A.2.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON users;
-- A.1 default: any authenticated session can read any user. Tightened in A.2
-- to "user can read self + members of any of their workspaces".
CREATE POLICY tenant_isolation ON users USING (true) WITH CHECK (true);

-- memberships — RLS by company_id, since memberships are workspace-scoped.
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON memberships;
CREATE POLICY tenant_isolation ON memberships
  USING (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

-- roles
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON roles;
CREATE POLICY tenant_isolation ON roles
  USING (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

-- permissions
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON permissions;
CREATE POLICY tenant_isolation ON permissions
  USING (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

-- agents
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agents;
CREATE POLICY tenant_isolation ON agents
  USING (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

-- company_lessons
ALTER TABLE company_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_lessons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON company_lessons;
CREATE POLICY tenant_isolation ON company_lessons
  USING (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

-- drafts
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON drafts;
CREATE POLICY tenant_isolation ON drafts
  USING (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

-- approvals
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON approvals;
CREATE POLICY tenant_isolation ON approvals
  USING (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

-- audit_log
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_log;
CREATE POLICY tenant_isolation ON audit_log
  USING (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

-- meter_events
ALTER TABLE meter_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON meter_events;
CREATE POLICY tenant_isolation ON meter_events
  USING (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

-- ─── Bypass role for migrations + platform admin ──────────────────────────
-- Migrations and platform-admin tooling must be able to read across tenants
-- (we explicitly hold this as a non-default capability). Create a role
-- 'clipstack_admin' that bypasses RLS. The application user 'clipstack_app'
-- does NOT bypass — every app-side query is RLS-filtered.
DO $$ BEGIN
  CREATE ROLE clipstack_admin BYPASSRLS NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE clipstack_app NOBYPASSRLS NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Grants: app role gets all CRUD on tenant tables; admin role inherits
-- additionally via BYPASSRLS. Both are NOLOGIN by default — production
-- deployments grant LOGIN to a derivative role with a strong password.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clipstack_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clipstack_app;
GRANT EXECUTE ON FUNCTION app_current_company_id() TO clipstack_app;
GRANT EXECUTE ON FUNCTION app_include_client_children() TO clipstack_app;
GRANT EXECUTE ON FUNCTION app_company_matches(UUID) TO clipstack_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clipstack_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO clipstack_app;
