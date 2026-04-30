-- 0003_rbac_seed.sql — default roles + permission matrix.
--
-- Idempotent — re-applies safely on existing tenants. Inserts the four
-- default roles per tenant when a new company row is created (via trigger),
-- plus the matching permission matrix.
--
-- Defaults (workspace-clonable):
--   owner        — all actions on all resources within the workspace
--   admin        — all except billing, member management, org delete
--   member       — create/edit drafts; approve where channel-permitted; read everything
--   client_guest — read-only on one client's drafts/approvals; can comment, not edit
--
-- The seeding trigger fires on INSERT INTO companies. To re-seed an existing
-- company, set context_json.reseed_roles = true and run UPDATE; the trigger
-- handles the rest.
--
-- Apply after 0002_enable_rls.sql.

CREATE OR REPLACE FUNCTION seed_default_roles(p_company_id UUID) RETURNS VOID
  LANGUAGE plpgsql AS $$
DECLARE
  owner_id UUID;
  admin_id UUID;
  member_id UUID;
  client_guest_id UUID;
  resource_name TEXT;
  action_name permission_action;
BEGIN
  -- Idempotent: skip if owner already exists for this tenant.
  IF EXISTS (SELECT 1 FROM roles WHERE company_id = p_company_id AND slug = 'owner') THEN
    RETURN;
  END IF;

  INSERT INTO roles (company_id, slug, display_name, description, is_default)
    VALUES (p_company_id, 'owner', 'Owner',
            'Full control of the workspace including billing and member management.', true)
    RETURNING id INTO owner_id;

  INSERT INTO roles (company_id, slug, display_name, description, is_default)
    VALUES (p_company_id, 'admin', 'Admin',
            'Manage agents, content, integrations, and approvals. No billing or org delete.', true)
    RETURNING id INTO admin_id;

  INSERT INTO roles (company_id, slug, display_name, description, is_default)
    VALUES (p_company_id, 'member', 'Member',
            'Create and edit drafts; approve content where channel-permitted; read everything.', true)
    RETURNING id INTO member_id;

  INSERT INTO roles (company_id, slug, display_name, description, is_default)
    VALUES (p_company_id, 'client_guest', 'Client Guest',
            'Read-only on one client''s drafts and approvals; comment but not edit.', true)
    RETURNING id INTO client_guest_id;

  -- ─── Owner: blanket allow on every resource × action ────────────────────
  FOR resource_name IN SELECT unnest(ARRAY[
    'company', 'user', 'membership', 'role', 'permission',
    'agent', 'lesson', 'draft', 'approval', 'audit_log',
    'meter_event', 'billing', 'integration', 'brand_kit',
    'campaign', 'channel'
  ]) LOOP
    FOREACH action_name IN ARRAY ARRAY[
      'read', 'create', 'update', 'delete', 'approve', 'deny',
      'publish', 'invite', 'revoke', 'export', 'admin'
    ]::permission_action[] LOOP
      INSERT INTO permissions (company_id, role_id, resource, action, allow)
        VALUES (p_company_id, owner_id, resource_name, action_name, true)
        ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- ─── Admin: same as owner, MINUS billing + role/permission/membership admin ─
  FOR resource_name IN SELECT unnest(ARRAY[
    'company', 'agent', 'lesson', 'draft', 'approval', 'audit_log',
    'meter_event', 'integration', 'brand_kit', 'campaign', 'channel'
  ]) LOOP
    FOREACH action_name IN ARRAY ARRAY[
      'read', 'create', 'update', 'delete', 'approve', 'deny',
      'publish', 'export'
    ]::permission_action[] LOOP
      INSERT INTO permissions (company_id, role_id, resource, action, allow)
        VALUES (p_company_id, admin_id, resource_name, action_name, true)
        ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
  -- Admin can read billing + members + roles, but cannot mutate.
  FOR resource_name IN SELECT unnest(ARRAY[
    'billing', 'membership', 'role', 'permission', 'user'
  ]) LOOP
    INSERT INTO permissions (company_id, role_id, resource, action, allow)
      VALUES (p_company_id, admin_id, resource_name, 'read', true)
      ON CONFLICT DO NOTHING;
  END LOOP;
  -- Admin cannot delete the company itself.
  INSERT INTO permissions (company_id, role_id, resource, action, allow)
    VALUES (p_company_id, admin_id, 'company', 'delete', false)
    ON CONFLICT DO NOTHING;

  -- ─── Member: create/edit drafts; approve (per channel-toggle); read all ─
  FOR resource_name IN SELECT unnest(ARRAY[
    'company', 'agent', 'lesson', 'draft', 'approval', 'audit_log',
    'meter_event', 'integration', 'brand_kit', 'campaign', 'channel',
    'membership', 'role', 'permission', 'user'
  ]) LOOP
    INSERT INTO permissions (company_id, role_id, resource, action, allow)
      VALUES (p_company_id, member_id, resource_name, 'read', true)
      ON CONFLICT DO NOTHING;
  END LOOP;
  -- Member can create/update drafts, lessons, brand kits.
  FOR resource_name IN SELECT unnest(ARRAY['draft', 'lesson', 'brand_kit', 'campaign']) LOOP
    FOREACH action_name IN ARRAY ARRAY['create', 'update']::permission_action[] LOOP
      INSERT INTO permissions (company_id, role_id, resource, action, allow)
        VALUES (p_company_id, member_id, resource_name, action_name, true)
        ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
  -- Member can approve / deny on resources where channel grants it. Default: approve allowed.
  INSERT INTO permissions (company_id, role_id, resource, action, allow)
    VALUES (p_company_id, member_id, 'approval', 'approve', true),
           (p_company_id, member_id, 'approval', 'deny', true)
    ON CONFLICT DO NOTHING;

  -- ─── Client guest: read-only on draft + approval; comment is a custom action ─
  -- (Comment as a permission lands when the comments table ships.)
  FOR resource_name IN SELECT unnest(ARRAY['draft', 'approval', 'campaign', 'channel']) LOOP
    INSERT INTO permissions (company_id, role_id, resource, action, allow)
      VALUES (p_company_id, client_guest_id, resource_name, 'read', true)
      ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

-- Trigger: seed defaults on every new company.
CREATE OR REPLACE FUNCTION trg_seed_company_roles() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seed_default_roles(NEW.id);
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER seed_roles_on_company_insert
    AFTER INSERT ON companies
    FOR EACH ROW EXECUTE FUNCTION trg_seed_company_roles();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Optional: manual re-seed via context_json.reseed_roles.
CREATE OR REPLACE FUNCTION trg_reseed_company_roles_on_request() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.context_json ? 'reseed_roles' AND
      (NEW.context_json->>'reseed_roles')::BOOLEAN = true) THEN
    -- Wipe defaults (keep custom roles).
    DELETE FROM permissions
      WHERE company_id = NEW.id
        AND role_id IN (SELECT id FROM roles WHERE company_id = NEW.id AND is_default = true);
    DELETE FROM roles WHERE company_id = NEW.id AND is_default = true;
    PERFORM seed_default_roles(NEW.id);
    NEW.context_json := NEW.context_json - 'reseed_roles';
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER reseed_on_request
    BEFORE UPDATE ON companies
    FOR EACH ROW
    WHEN (NEW.context_json IS DISTINCT FROM OLD.context_json)
    EXECUTE FUNCTION trg_reseed_company_roles_on_request();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Backfill: seed defaults for any existing company missing them ────────
DO $$
DECLARE c_id UUID;
BEGIN
  FOR c_id IN SELECT id FROM companies WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE company_id = companies.id AND slug = 'owner'
  ) LOOP
    PERFORM seed_default_roles(c_id);
  END LOOP;
END$$;
