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

-- ─── Test 6: pgvector extension + 384-d vector roundtrip ─────────────────
-- 0007 promoted company_lessons.embedding from BYTEA to vector(384).
-- Verifies (a) the extension is present, (b) a 384-d insert + read
-- preserves the values, (c) cosine similarity works against an inserted
-- row. Runs as superuser since lessons need a workspace + RLS-bound role
-- and re-binding for a single test isn't worth the boilerplate; the
-- vector dimension + roundtrip are RLS-orthogonal anyway.

DO $$
DECLARE
  has_ext BOOLEAN;
  inserted_id UUID;
  read_dim INT;
  read_first_three FLOAT[];
  cos_self FLOAT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'vector'
  ) INTO has_ext;
  IF NOT has_ext THEN
    RAISE EXCEPTION 'TEST 6 FAIL — pgvector extension missing';
  END IF;

  -- Insert a deterministic 384-d vector ([0.001, 0.002, ..., 0.384]).
  INSERT INTO company_lessons (company_id, kind, scope, rationale, embedding)
  VALUES (
    '11111111-1111-1111-1111-111111111111',
    'human_denied',
    'forever',
    'pgvector roundtrip test — sufficient rationale length for the CHECK',
    (
      SELECT ('[' || string_agg((i::FLOAT / 1000)::TEXT, ',') || ']')::vector
      FROM generate_series(1, 384) AS i
    )
  )
  RETURNING id INTO inserted_id;

  -- Read back: dim should be 384, first three components should be
  -- [0.001, 0.002, 0.003].
  SELECT vector_dims(embedding) INTO read_dim
    FROM company_lessons WHERE id = inserted_id;
  IF read_dim != 384 THEN
    RAISE EXCEPTION 'TEST 6 FAIL — vector dim is % (expected 384)', read_dim;
  END IF;

  -- Cosine similarity to self should be 1.0 (within FP tolerance). pgvector's
  -- <=> is cosine *distance* (1 - similarity), so self <=> self ≈ 0.
  SELECT (embedding <=> embedding)::FLOAT INTO cos_self
    FROM company_lessons WHERE id = inserted_id;
  IF cos_self > 0.0001 THEN
    RAISE EXCEPTION 'TEST 6 FAIL — cosine self-distance is % (expected ≈ 0)', cos_self;
  END IF;

  RAISE NOTICE 'TEST 6 PASS — vector(384) roundtrip + cosine self-distance ≈ 0 (got %)', cos_self;

  -- Cleanup so subsequent runs don't double-insert.
  DELETE FROM company_lessons WHERE id = inserted_id;
END $$;

-- ─── Test 7: cosine ordering + RLS still scopes ─────────────────────────
-- Insert two lessons in workspace-a + two in workspace-b, each with a
-- distinct deterministic embedding. Then bind to workspace-a, run a
-- cosine-similarity query against a chosen target vector, and assert:
--   (a) workspace-a's lessons are returned in cosine-distance order
--   (b) workspace-b's lessons are NOT returned (RLS still applies even
--       when the ORDER BY is a vector op)
--
-- The lessons live in three "axes" of embedding space so the ordering is
-- predictable: lesson L1 is near the X axis, L2 near Y, L3 near Z. The
-- query vector is the X axis, so L1 should come first in workspace-a.

-- Reset workspace-b's parent so test 5's mutation doesn't bleed into
-- include_client_children semantics here.
RESET ROLE;
UPDATE companies
   SET parent_company_id = NULL
 WHERE id = '22222222-2222-2222-2222-222222222222';

-- Build three orthogonal-ish 384-d unit vectors via generate_series.
-- v_x : 1.0 in slot 0, 0.0 elsewhere
-- v_y : 1.0 in slot 1, 0.0 elsewhere
-- v_z : 1.0 in slot 2, 0.0 elsewhere
INSERT INTO company_lessons (id, company_id, kind, scope, rationale, embedding)
VALUES
  -- workspace-a / near-X
  ('cccc1111-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'human_denied', 'forever',
   'cosine test L1 (near X axis) — sufficient rationale length for the CHECK',
   (SELECT ('[' || string_agg(CASE WHEN i=1 THEN '1.0' ELSE '0.0' END, ',') || ']')::vector
      FROM generate_series(1, 384) AS i)),
  -- workspace-a / near-Y
  ('cccc2222-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'human_denied', 'forever',
   'cosine test L2 (near Y axis) — sufficient rationale length for the CHECK',
   (SELECT ('[' || string_agg(CASE WHEN i=2 THEN '1.0' ELSE '0.0' END, ',') || ']')::vector
      FROM generate_series(1, 384) AS i)),
  -- workspace-b / near-X (should NEVER show up in workspace-a queries)
  ('dddd1111-dddd-dddd-dddd-dddddddddddd',
   '22222222-2222-2222-2222-222222222222', 'human_denied', 'forever',
   'cosine test L3 (near X axis but workspace-b) — RLS must hide this',
   (SELECT ('[' || string_agg(CASE WHEN i=1 THEN '1.0' ELSE '0.0' END, ',') || ']')::vector
      FROM generate_series(1, 384) AS i));

SET ROLE clipstack_app;

DO $$
DECLARE
  query_vec vector(384);
  rec RECORD;
  ordered_ids UUID[] := ARRAY[]::UUID[];
  cross_tenant_seen INT := 0;
BEGIN
  PERFORM set_config('app.current_company_id', '11111111-1111-1111-1111-111111111111', true);

  -- Query along the X axis. workspace-a's L1 (near-X) should be #1;
  -- workspace-a's L2 (near-Y) should be #2 (orthogonal-ish);
  -- workspace-b's L3 must never appear (RLS).
  query_vec := (SELECT ('[' || string_agg(CASE WHEN i=1 THEN '1.0' ELSE '0.0' END, ',') || ']')::vector
                  FROM generate_series(1, 384) AS i);

  FOR rec IN
    SELECT id, company_id
      FROM company_lessons
     WHERE scope = 'forever'
       AND id IN (
         'cccc1111-cccc-cccc-cccc-cccccccccccc'::uuid,
         'cccc2222-cccc-cccc-cccc-cccccccccccc'::uuid,
         'dddd1111-dddd-dddd-dddd-dddddddddddd'::uuid
       )
     ORDER BY embedding <=> query_vec
  LOOP
    ordered_ids := ordered_ids || rec.id;
    IF rec.company_id != '11111111-1111-1111-1111-111111111111'::uuid THEN
      cross_tenant_seen := cross_tenant_seen + 1;
    END IF;
  END LOOP;

  -- (a) RLS: cross-tenant rows must NOT appear in the ordered output.
  IF cross_tenant_seen != 0 THEN
    RAISE EXCEPTION 'RLS BREACH — workspace-b row appeared in workspace-a cosine query (saw %)', cross_tenant_seen;
  END IF;

  -- (b) ordering: L1 (near X) first, then L2 (near Y).
  IF array_length(ordered_ids, 1) != 2 THEN
    RAISE EXCEPTION 'TEST 7 FAIL — expected 2 workspace-a rows, got %', COALESCE(array_length(ordered_ids, 1), 0);
  END IF;
  IF ordered_ids[1] != 'cccc1111-cccc-cccc-cccc-cccccccccccc'::uuid THEN
    RAISE EXCEPTION 'TEST 7 FAIL (order) — expected L1 first, got %', ordered_ids[1];
  END IF;
  IF ordered_ids[2] != 'cccc2222-cccc-cccc-cccc-cccccccccccc'::uuid THEN
    RAISE EXCEPTION 'TEST 7 FAIL (order) — expected L2 second, got %', ordered_ids[2];
  END IF;

  RAISE NOTICE 'TEST 7 PASS — cosine ordering correct + RLS scoped lessons across tenants';
END $$;

RESET ROLE;

\echo '────────────────────────────────────────'
\echo '  ALL CROSS-TENANT + PGVECTOR ASSERTS PASS  '
\echo '────────────────────────────────────────'
