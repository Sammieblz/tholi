export const tenantAuthorization = `
-- Runtime never owns these tables. Definer helpers retain owner access, while
-- RLS applies to ordinary runtime statements. FORCE would break that boundary.
CREATE FUNCTION tholi.actor_account_id() RETURNS uuid
  LANGUAGE sql STABLE SET search_path = pg_catalog
  AS $$ SELECT NULLIF(current_setting('tholi.account_id', true), '')::uuid $$;
CREATE FUNCTION tholi.actor_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE SET search_path = pg_catalog
  AS $$ SELECT NULLIF(current_setting('tholi.workspace_id', true), '')::uuid $$;

-- The sole membership lookup used by policies does not recurse through RLS.
CREATE FUNCTION tholi.current_member_role(target_workspace uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $$ SELECT m.role FROM tholi.memberships m JOIN tholi.accounts a ON a.id = m.account_id
    WHERE m.workspace_id = target_workspace AND m.account_id = tholi.actor_account_id()
      AND m.status = 'active' AND a.status = 'active' $$;

-- First login and explicit local fixture provisioning share this narrow owner.
-- No provider proof, tokens, session rotation or auth flow moves into SQL.
CREATE FUNCTION tholi.provision_personal_account(actor uuid, workspace uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
  BEGIN
    INSERT INTO tholi.accounts (id) VALUES (actor) ON CONFLICT DO NOTHING;
    INSERT INTO tholi.workspaces (id, kind, owner_account_id)
      VALUES (workspace, 'personal', actor) ON CONFLICT DO NOTHING;
    IF NOT EXISTS (SELECT FROM tholi.workspaces w JOIN tholi.accounts a ON a.id = actor
        WHERE w.id = workspace AND w.owner_account_id = actor AND w.kind = 'personal'
          AND a.status = 'active') THEN
      RAISE EXCEPTION 'The personal workspace is unavailable.' USING ERRCODE = '23514';
    END IF;
    INSERT INTO tholi.memberships (workspace_id, account_id, role)
      VALUES (workspace, actor, 'owner') ON CONFLICT DO NOTHING;
    IF NOT EXISTS (SELECT FROM tholi.memberships WHERE workspace_id = workspace
        AND account_id = actor AND role = 'owner' AND status = 'active') THEN
      RAISE EXCEPTION 'The personal workspace is unavailable.' USING ERRCODE = '23514';
    END IF;
  END $$;

CREATE FUNCTION tholi.guard_membership_owner() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
  DECLARE workspace_kind text; canonical_owner uuid;
  BEGIN
    SELECT kind, owner_account_id INTO workspace_kind, canonical_owner
      FROM tholi.workspaces WHERE id = NEW.workspace_id;
    IF workspace_kind IS NULL THEN RETURN NEW; END IF;
    IF (NEW.role = 'owner') IS DISTINCT FROM (NEW.account_id = canonical_owner)
      OR (workspace_kind = 'personal' AND NEW.account_id <> canonical_owner) THEN
      RAISE EXCEPTION 'Membership must preserve canonical workspace ownership.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END $$;
DO $$ BEGIN
  IF EXISTS (SELECT FROM tholi.memberships m JOIN tholi.workspaces w ON w.id = m.workspace_id
      WHERE (m.role = 'owner') IS DISTINCT FROM (m.account_id = w.owner_account_id)
        OR (w.kind = 'personal' AND m.account_id <> w.owner_account_id)) THEN
    RAISE EXCEPTION 'Existing memberships require explicit ownership repair.' USING ERRCODE = '23514';
  END IF;
END $$;
CREATE TRIGGER membership_canonical_owner BEFORE INSERT OR UPDATE ON tholi.memberships
  FOR EACH ROW EXECUTE FUNCTION tholi.guard_membership_owner();
CREATE UNIQUE INDEX memberships_single_owner_idx ON tholi.memberships (workspace_id) WHERE role = 'owner';
CREATE FUNCTION tholi.guard_workspace_owner() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
  BEGIN
    IF EXISTS (SELECT FROM tholi.memberships m WHERE m.workspace_id = NEW.id
        AND ((m.role = 'owner') IS DISTINCT FROM (m.account_id = NEW.owner_account_id)
          OR (NEW.kind = 'personal' AND m.account_id <> NEW.owner_account_id))) THEN
      RAISE EXCEPTION 'Workspace changes must preserve canonical membership.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER workspace_canonical_owner BEFORE UPDATE OF owner_account_id,kind ON tholi.workspaces
  FOR EACH ROW EXECUTE FUNCTION tholi.guard_workspace_owner();

ALTER TABLE tholi.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_self ON tholi.accounts USING (id = tholi.actor_account_id())
  WITH CHECK (id = tholi.actor_account_id());
ALTER TABLE tholi.workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_read ON tholi.workspaces FOR SELECT
  USING (tholi.current_member_role(id) IS NOT NULL);
CREATE POLICY workspace_update ON tholi.workspaces FOR UPDATE
  USING (id = tholi.actor_workspace_id() AND tholi.current_member_role(id) IS NOT NULL)
  WITH CHECK (id = tholi.actor_workspace_id() AND tholi.current_member_role(id) IS NOT NULL);
ALTER TABLE tholi.memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON tholi.memberships FOR SELECT
  USING (tholi.current_member_role(workspace_id) IS NOT NULL AND
    (account_id = tholi.actor_account_id() OR (workspace_id = tholi.actor_workspace_id()
      AND tholi.current_member_role(workspace_id) IN ('owner','admin'))));
CREATE POLICY membership_insert ON tholi.memberships FOR INSERT
  WITH CHECK (workspace_id = tholi.actor_workspace_id()
    AND tholi.current_member_role(workspace_id) = 'owner'
    AND account_id <> tholi.actor_account_id() AND role IN ('admin','member'));
CREATE POLICY membership_update ON tholi.memberships FOR UPDATE
  USING (workspace_id = tholi.actor_workspace_id()
    AND tholi.current_member_role(workspace_id) = 'owner'
    AND account_id <> tholi.actor_account_id() AND role <> 'owner')
  WITH CHECK (workspace_id = tholi.actor_workspace_id()
    AND tholi.current_member_role(workspace_id) = 'owner'
    AND account_id <> tholi.actor_account_id() AND role IN ('admin','member'));

ALTER TABLE tholi.consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_actor ON tholi.consents
  USING (workspace_id = tholi.actor_workspace_id() AND account_id = tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL)
  WITH CHECK (workspace_id = tholi.actor_workspace_id() AND account_id = tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL);
ALTER TABLE tholi.requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_actor ON tholi.requests
  USING (workspace_id = tholi.actor_workspace_id() AND account_id = tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL)
  WITH CHECK (workspace_id = tholi.actor_workspace_id() AND account_id = tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL);
ALTER TABLE tholi.saved_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY artifact_actor ON tholi.saved_artifacts
  USING (workspace_id = tholi.actor_workspace_id() AND owner_account_id = tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL)
  WITH CHECK (workspace_id = tholi.actor_workspace_id() AND owner_account_id = tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL);

ALTER TABLE tholi.entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY entitlement_read ON tholi.entitlements FOR SELECT
  USING (workspace_id = tholi.actor_workspace_id() AND tholi.current_member_role(workspace_id) IS NOT NULL);
CREATE POLICY entitlement_write ON tholi.entitlements FOR ALL
  USING (workspace_id = tholi.actor_workspace_id() AND tholi.current_member_role(workspace_id) = 'owner')
  WITH CHECK (workspace_id = tholi.actor_workspace_id() AND tholi.current_member_role(workspace_id) = 'owner');
ALTER TABLE tholi.credit_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY grant_read ON tholi.credit_grants FOR SELECT
  USING (workspace_id = tholi.actor_workspace_id() AND tholi.current_member_role(workspace_id) IS NOT NULL);
CREATE POLICY grant_write ON tholi.credit_grants FOR INSERT
  WITH CHECK (workspace_id = tholi.actor_workspace_id() AND tholi.current_member_role(workspace_id) = 'owner');
ALTER TABLE tholi.credit_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY reservation_actor ON tholi.credit_reservations
  USING (workspace_id = tholi.actor_workspace_id() AND tholi.current_member_role(workspace_id) IS NOT NULL
    AND EXISTS (SELECT FROM tholi.requests q WHERE q.workspace_id = credit_reservations.workspace_id
      AND q.id = credit_reservations.request_id AND q.account_id = tholi.actor_account_id()))
  WITH CHECK (workspace_id = tholi.actor_workspace_id() AND tholi.current_member_role(workspace_id) IS NOT NULL
    AND EXISTS (SELECT FROM tholi.requests q WHERE q.workspace_id = credit_reservations.workspace_id
      AND q.id = credit_reservations.request_id AND q.account_id = tholi.actor_account_id()));
ALTER TABLE tholi.credit_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY settlement_actor ON tholi.credit_settlements
  USING (workspace_id = tholi.actor_workspace_id() AND EXISTS (
    SELECT FROM tholi.credit_reservations r WHERE r.workspace_id = credit_settlements.workspace_id
      AND r.id = credit_settlements.reservation_id))
  WITH CHECK (workspace_id = tholi.actor_workspace_id() AND EXISTS (
    SELECT FROM tholi.credit_reservations r WHERE r.workspace_id = credit_settlements.workspace_id
      AND r.id = credit_settlements.reservation_id));
ALTER TABLE tholi.usage_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_actor ON tholi.usage_records
  USING (workspace_id = tholi.actor_workspace_id() AND EXISTS (
    SELECT FROM tholi.requests q WHERE q.workspace_id = usage_records.workspace_id
      AND q.id = usage_records.request_id AND q.account_id = tholi.actor_account_id()))
  WITH CHECK (workspace_id = tholi.actor_workspace_id() AND EXISTS (
    SELECT FROM tholi.requests q WHERE q.workspace_id = usage_records.workspace_id
      AND q.id = usage_records.request_id AND q.account_id = tholi.actor_account_id()));
ALTER TABLE tholi.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_actor ON tholi.jobs
  USING (workspace_id = tholi.actor_workspace_id() AND account_id = tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL)
  WITH CHECK (workspace_id = tholi.actor_workspace_id() AND account_id = tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL);
ALTER TABLE tholi.outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbox_actor ON tholi.outbox
  USING (workspace_id = tholi.actor_workspace_id() AND EXISTS (
    SELECT FROM tholi.jobs j WHERE j.workspace_id = outbox.workspace_id AND j.id = outbox.job_id
      AND j.account_id = tholi.actor_account_id()))
  WITH CHECK (workspace_id = tholi.actor_workspace_id() AND EXISTS (
    SELECT FROM tholi.jobs j WHERE j.workspace_id = outbox.workspace_id AND j.id = outbox.job_id
      AND j.account_id = tholi.actor_account_id()));

-- Row-private holds/settlements must not hide another member's spending from
-- admission. Only authorized workspace totals leave this helper, never IDs.
CREATE FUNCTION tholi.workspace_credit_totals(target_workspace uuid)
  RETURNS TABLE (granted text, spent text, reserved text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  BEGIN
    IF target_workspace IS DISTINCT FROM tholi.actor_workspace_id()
      OR tholi.current_member_role(target_workspace) IS NULL THEN
      RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT
      (SELECT COALESCE(sum(g.amount),0)::text FROM tholi.credit_grants g
        WHERE g.workspace_id = target_workspace AND (g.expires_at IS NULL OR g.expires_at > now())),
      (SELECT COALESCE(sum(s.amount),0)::text FROM tholi.credit_settlements s WHERE s.workspace_id = target_workspace),
      (SELECT COALESCE(sum(r.amount),0)::text FROM tholi.credit_reservations r
        WHERE r.workspace_id = target_workspace AND r.status IN ('active','uncertain'));
  END $$;

REVOKE ALL ON FUNCTION tholi.actor_account_id(), tholi.actor_workspace_id(),
  tholi.current_member_role(uuid), tholi.provision_personal_account(uuid,uuid),
  tholi.guard_membership_owner(), tholi.guard_workspace_owner(), tholi.workspace_credit_totals(uuid) FROM PUBLIC;
`;
