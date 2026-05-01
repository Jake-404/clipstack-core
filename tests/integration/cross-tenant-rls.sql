-- Cross-tenant RLS integration test.
-- DoD A.1.1 — workspace A user attempting to read workspace B's data
-- (or write into B's tenant) is denied at the row level.
--
-- Prerequisites:
--   - All 6 migrations applied (0001 → 0006).
--   - Connected as a superuser (postgres) so the seed phase bypasses RLS.
--
-- The test SETs ROLE to clipstack_app for assertions so RLS is enforced
-- exactly as the application connection sees it.
--
-- Exit semantics: any RAISE EXCEPTION below aborts the whole script with
-- a non-zero exit code (psql's default ON_ERROR_STOP behaviour). The CI
-- runner treats abort = test fail. Successful completion = "all assertions
-- held."

\set ON_ERROR_STOP on

-- ─── Seed (superuser bypasses RLS) ─────────────────────────────────────────

BEGIN;

INSERT INTO companies (id, name, type) VALUES
  ('11111111-1111-1111-1111-111111111111', 'workspace-a', 'agency'),
  ('22222222-2222-2222-2222-222222222222', 'workspace-b', 'agency');

INSERT INTO drafts (id, company_id, channel, body) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'x', 'workspace-a draft body'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 'linkedin', 'workspace-b draft body');

COMMIT;

-- ─── Switch to RLS-bound role ─────────────────────────────────────────────
-- Superuser can SET ROLE to anything. After this, RLS policies apply.
-- (clipstack_app has NOBYPASSRLS — set in 0002.)

SET ROLE clipstack_app;

-- ─── Test 1: NO tenant context → fail closed ─────────────────────────────
-- The most important guarantee: a session that hasn't bound a tenant sees
-- zero rows. Without app.current_company_id, app_company_matches() returns
-- false for every row.

DO $$
DECLARE
  cnt INT;
BEGIN
  -- Make sure no leftover setting from a prior session.
  PERFORM set_config('app.current_company_id', '', true);
  SELECT count(*) INTO cnt FROM drafts;
  IF cnt != 0 THEN
    RAISE EXCEPTION 'TEST 1 FAIL — no-tenant session saw % drafts (expected 0)', cnt;
  END IF;
  RAISE NOTICE 'TEST 1 PASS — no-tenant session sees 0 drafts';
END $$;

-- ─── Test 2: tenant-A context → only A's rows visible ────────────────────

DO $$
DECLARE
  total INT;
  own_cnt INT;
  cross_cnt INT;
BEGIN
  PERFORM set_config('app.current_company_id', '11111111-1111-1111-1111-111111111111', true);
  SELECT count(*) INTO total FROM drafts;
  IF total != 1 THEN
    RAISE EXCEPTION 'TEST 2 FAIL — workspace-a session saw % drafts total (expected 1)', total;
  END IF;
  SELECT count(*) INTO own_cnt FROM drafts WHERE company_id = '11111111-1111-1111-1111-111111111111';
  SELECT count(*) INTO cross_cnt FROM drafts WHERE company_id = '22222222-2222-2222-2222-222222222222';
  IF own_cnt != 1 THEN
    RAISE EXCEPTION 'TEST 2 FAIL — workspace-a missed its own draft (own=% cross=%)', own_cnt, cross_cnt;
  END IF;
  IF cross_cnt != 0 THEN
    RAISE EXCEPTION 'RLS BREACH — workspace-a saw % workspace-b drafts (expected 0)', cross_cnt;
  END IF;
  RAISE NOTICE 'TEST 2 PASS — workspace-a sees own draft, NOT workspace-b';
END $$;

-- ─── Test 3: cross-tenant INSERT blocked by WITH CHECK ───────────────────
-- workspace-a session tries to INSERT a row tagged with workspace-b's
-- company_id. RLS WITH CHECK denies; we expect a privilege error.

DO $$
DECLARE
  err_caught BOOLEAN := false;
  err_state TEXT;
BEGIN
  PERFORM set_config('app.current_company_id', '11111111-1111-1111-1111-111111111111', true);
  BEGIN
    INSERT INTO drafts (company_id, channel, body) VALUES
      ('22222222-2222-2222-2222-222222222222', 'x', 'wrong-tenant write attempt');
    RAISE EXCEPTION 'RLS BREACH — workspace-a inserted a workspace-b draft';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      err_caught := true;
      GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE;
  END;
  IF NOT err_caught THEN
    RAISE EXCEPTION 'TEST 3 FAIL — INSERT was not blocked';
  END IF;
  RAISE NOTICE 'TEST 3 PASS — cross-tenant INSERT denied (sqlstate %)', err_state;
END $$;

-- ─── Test 4: switching context flips visibility ───────────────────────────
-- Same session can flip from workspace-a to workspace-b; LOCAL settings
-- are transaction-scoped so we use a single transaction here to mimic
-- the withTenant() pattern.

DO $$
DECLARE
  a_cnt INT;
  b_cnt INT;
BEGIN
  -- workspace-b context
  PERFORM set_config('app.current_company_id', '22222222-2222-2222-2222-222222222222', true);
  SELECT count(*) INTO b_cnt FROM drafts WHERE company_id = '22222222-2222-2222-2222-222222222222';
  IF b_cnt != 1 THEN
    RAISE EXCEPTION 'TEST 4 FAIL — workspace-b saw % own drafts (expected 1)', b_cnt;
  END IF;
  SELECT count(*) INTO a_cnt FROM drafts WHERE company_id = '11111111-1111-1111-1111-111111111111';
  IF a_cnt != 0 THEN
    RAISE EXCEPTION 'RLS BREACH — workspace-b saw % workspace-a drafts (expected 0)', a_cnt;
  END IF;
  RAISE NOTICE 'TEST 4 PASS — context switch flips visibility correctly';
END $$;

-- ─── Test 5: parent-child include flag ───────────────────────────────────
-- Establish workspace-b as a child of workspace-a. With
-- include_client_children=true, workspace-a should see both rows;
-- without it, only its own.

RESET ROLE;  -- back to superuser to mutate parent_company_id (workspace-b
              -- doesn't have an active tenant context that would let an
              -- RLS-bound role mutate the parent link).

UPDATE companies
   SET parent_company_id = '11111111-1111-1111-1111-111111111111'
 WHERE id = '22222222-2222-2222-2222-222222222222';

SET ROLE clipstack_app;

DO $$
DECLARE
  scoped_cnt INT;
  including_cnt INT;
BEGIN
  PERFORM set_config('app.current_company_id', '11111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('app.include_client_children', 'false', true);
  SELECT count(*) INTO scoped_cnt FROM drafts;
  IF scoped_cnt != 1 THEN
    RAISE EXCEPTION 'TEST 5 FAIL (scoped) — workspace-a saw % drafts with include=false (expected 1)', scoped_cnt;
  END IF;

  PERFORM set_config('app.include_client_children', 'true', true);
  SELECT count(*) INTO including_cnt FROM drafts;
  IF including_cnt != 2 THEN
    RAISE EXCEPTION 'TEST 5 FAIL (include) — workspace-a saw % drafts with include=true (expected 2)', including_cnt;
  END IF;

  RAISE NOTICE 'TEST 5 PASS — include_client_children flag works as documented';
END $$;

RESET ROLE;

\echo '────────────────────────────────────────'
\echo '  ALL CROSS-TENANT RLS ASSERTIONS PASS  '
\echo '────────────────────────────────────────'
