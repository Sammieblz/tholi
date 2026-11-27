import { extendFileFunctions } from "./010-saved-data";
import { navigationKnowledge } from "./014-navigation-knowledge";

/** Additive pilot storage. Existing actor-private artifacts and graph DTOs are unchanged. */
export const organizationPilot = `
-- Preserve every historical audit kind and its strict shape predicate. New
-- content-free kinds use the existing subject-id/empty-details shape.
DO $$ DECLARE old_name text; old_expression text;
BEGIN
  SELECT c.conname,pg_get_expr(c.conbin,c.conrelid) INTO STRICT old_name,old_expression
    FROM pg_constraint c WHERE c.conrelid='tholi.security_audit'::regclass AND c.contype='c'
      AND pg_get_expr(c.conbin,c.conrelid) LIKE '%membership.changed%'
      AND pg_get_expr(c.conbin,c.conrelid) NOT LIKE '%details%';
  EXECUTE format('ALTER TABLE tholi.security_audit DROP CONSTRAINT %I',old_name);
  EXECUTE format('ALTER TABLE tholi.security_audit ADD CONSTRAINT security_audit_organization_kind CHECK ((%s) OR kind IN (''organization.policy.changed'',''organization.workflow.changed'',''organization.source.changed''))',old_expression);
END $$;
CREATE TABLE tholi.organization_policies (
  workspace_id uuid PRIMARY KEY REFERENCES tholi.workspaces(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision > 0), policy jsonb NOT NULL CHECK (jsonb_typeof(policy)='object' AND octet_length(policy::text)<=8192),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE tholi.organization_policy_versions (
  workspace_id uuid NOT NULL REFERENCES tholi.workspaces(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision>0), actor_id uuid NOT NULL REFERENCES tholi.accounts(id),
  policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object' AND octet_length(policy::text)<=8192), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,revision)
);
CREATE TABLE tholi.organization_workflows (
  workspace_id uuid NOT NULL REFERENCES tholi.workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL, revision bigint NOT NULL CHECK (revision > 0),
  record jsonb NOT NULL CHECK (jsonb_typeof(record)='object' AND octet_length(record::text)<=32768),
  published jsonb CHECK (published IS NULL OR (jsonb_typeof(published)='object' AND octet_length(published::text)<=32768)),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,id)
);
CREATE TABLE tholi.organization_workflow_versions (
  workspace_id uuid NOT NULL, id uuid NOT NULL, revision bigint NOT NULL,
  actor_id uuid NOT NULL REFERENCES tholi.accounts(id),
  action text NOT NULL CHECK (action IN ('draft','submit','approve','publish','retire','restore')),
  record jsonb NOT NULL CHECK (jsonb_typeof(record)='object' AND octet_length(record::text)<=32768),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,id,revision),
  FOREIGN KEY (workspace_id,id) REFERENCES tholi.organization_workflows(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE tholi.organization_knowledge_sources (
  workspace_id uuid NOT NULL REFERENCES tholi.workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL, revision bigint NOT NULL CHECK (revision > 0),
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata)='object'),
  chunks jsonb NOT NULL CHECK (jsonb_typeof(chunks)='array' AND jsonb_array_length(chunks)<=500),
  deleted_at timestamptz, expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days',
  PRIMARY KEY (workspace_id,id)
);
CREATE FUNCTION tholi.guard_organization_source() RETURNS trigger
  LANGUAGE plpgsql SET search_path=pg_catalog AS $$
  DECLARE chunk text; total_bytes integer:=0;
  BEGIN
    IF jsonb_typeof(NEW.chunks)<>'array' OR jsonb_array_length(NEW.chunks)>500
      OR NEW.metadata->>'id' IS DISTINCT FROM NEW.id::text
      OR NEW.metadata->>'revision' IS DISTINCT FROM NEW.revision::text
      OR NEW.metadata->>'origin' IS NULL OR NEW.metadata->>'title' IS NULL
      OR NEW.metadata->>'sha256' IS NULL
      OR NEW.expires_at>transaction_timestamp()+interval '90 days' THEN
      RAISE EXCEPTION 'Invalid organization source' USING ERRCODE='23514';
    END IF;
    FOR chunk IN SELECT jsonb_array_elements_text(NEW.chunks) LOOP
      total_bytes:=total_bytes+octet_length(chunk);
      IF octet_length(chunk)>4096 OR total_bytes>1048576 THEN
        RAISE EXCEPTION 'Organization source exceeds its size limit' USING ERRCODE='23514';
      END IF;
    END LOOP;
    RETURN NEW;
  END $$;
CREATE TRIGGER organization_source_guard BEFORE INSERT OR UPDATE ON tholi.organization_knowledge_sources FOR EACH ROW EXECUTE FUNCTION tholi.guard_organization_source();
REVOKE ALL ON FUNCTION tholi.guard_organization_source() FROM PUBLIC;
CREATE INDEX organization_sources_origin ON tholi.organization_knowledge_sources(workspace_id,(metadata->>'origin'),expires_at) WHERE deleted_at IS NULL;
CREATE INDEX organization_workflow_history_expiry ON tholi.organization_workflow_versions(created_at);
CREATE INDEX organization_policy_history_expiry ON tholi.organization_policy_versions(created_at);

-- Scope and active canonical ownership are checked for every current read or write.
CREATE FUNCTION tholi.organization_access(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
    SELECT target=tholi.actor_workspace_id() AND tholi.current_member_role(target) IS NOT NULL
      AND EXISTS (SELECT FROM tholi.workspaces w JOIN tholi.accounts a ON a.id=w.owner_account_id
        WHERE w.id=target AND w.kind='organization' AND a.status='active')
  $$;
REVOKE ALL ON FUNCTION tholi.organization_access(uuid) FROM PUBLIC;
ALTER TABLE tholi.organization_policy_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_policy_version_read ON tholi.organization_policy_versions FOR SELECT USING (tholi.organization_access(workspace_id));
CREATE POLICY organization_policy_version_insert ON tholi.organization_policy_versions FOR INSERT WITH CHECK (tholi.organization_access(workspace_id) AND tholi.current_member_role(workspace_id)='owner' AND actor_id=tholi.actor_account_id());
ALTER TABLE tholi.organization_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_policy_read ON tholi.organization_policies FOR SELECT USING (tholi.organization_access(workspace_id));
CREATE POLICY organization_policy_insert ON tholi.organization_policies FOR INSERT WITH CHECK (tholi.organization_access(workspace_id) AND tholi.current_member_role(workspace_id)='owner');
CREATE POLICY organization_policy_update ON tholi.organization_policies FOR UPDATE USING (tholi.organization_access(workspace_id) AND tholi.current_member_role(workspace_id)='owner') WITH CHECK (tholi.organization_access(workspace_id) AND tholi.current_member_role(workspace_id)='owner');
ALTER TABLE tholi.organization_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_workflow_scope ON tholi.organization_workflows USING (tholi.organization_access(workspace_id)) WITH CHECK (tholi.organization_access(workspace_id));
ALTER TABLE tholi.organization_workflow_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_version_read ON tholi.organization_workflow_versions FOR SELECT USING (tholi.organization_access(workspace_id));
CREATE POLICY organization_version_insert ON tholi.organization_workflow_versions FOR INSERT WITH CHECK (tholi.organization_access(workspace_id) AND actor_id=tholi.actor_account_id());
ALTER TABLE tholi.organization_knowledge_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_source_read ON tholi.organization_knowledge_sources FOR SELECT USING (tholi.organization_access(workspace_id));
CREATE POLICY organization_source_insert ON tholi.organization_knowledge_sources FOR INSERT WITH CHECK (tholi.organization_access(workspace_id) AND tholi.current_member_role(workspace_id) IN ('owner','admin'));
CREATE POLICY organization_source_update ON tholi.organization_knowledge_sources FOR UPDATE USING (tholi.organization_access(workspace_id) AND tholi.current_member_role(workspace_id) IN ('owner','admin')) WITH CHECK (tholi.organization_access(workspace_id) AND tholi.current_member_role(workspace_id) IN ('owner','admin'));

-- Publication can only follow independent review of the same immutable content.
CREATE FUNCTION tholi.guard_organization_workflow() RETURNS trigger
  LANGUAGE plpgsql SET search_path=pg_catalog AS $$
  DECLARE actor uuid:=tholi.actor_account_id(); privileged boolean;
  BEGIN
    privileged:=tholi.current_member_role(NEW.workspace_id) IN ('owner','admin');
    IF NEW.record->>'revision' IS DISTINCT FROM NEW.revision::text
      OR NEW.record->>'id' IS DISTINCT FROM NEW.id::text
      OR NEW.record->>'status' NOT IN ('draft','review','approved','published','retired')
      OR NEW.record->>'status' IS NULL THEN
      RAISE EXCEPTION 'Invalid workflow record' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' THEN
      IF NEW.revision<>1 OR NEW.record->>'status' IS DISTINCT FROM 'draft'
        OR NEW.record->>'authorId' IS DISTINCT FROM actor::text
        OR NEW.record->>'reviewerId' IS NOT NULL OR NEW.published IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid workflow draft' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Stale workflow' USING ERRCODE='23514'; END IF;
    IF NEW.record->>'status'='draft' THEN
      IF NOT privileged AND OLD.record->>'authorId' IS DISTINCT FROM actor::text THEN RAISE EXCEPTION 'Forbidden draft' USING ERRCODE='42501'; END IF;
      IF NEW.record->>'authorId' IS DISTINCT FROM actor::text OR NEW.record->>'reviewerId' IS NOT NULL OR NEW.published IS DISTINCT FROM OLD.published THEN RAISE EXCEPTION 'Invalid draft' USING ERRCODE='23514'; END IF;
    ELSE
      IF NEW.record->'guide' IS DISTINCT FROM OLD.record->'guide' OR NEW.record->>'origin' IS DISTINCT FROM OLD.record->>'origin'
        OR NEW.record->>'contentHash' IS DISTINCT FROM OLD.record->>'contentHash' OR NEW.record->>'authorId' IS DISTINCT FROM OLD.record->>'authorId' THEN
        RAISE EXCEPTION 'Content changed during review' USING ERRCODE='23514';
      END IF;
      CASE NEW.record->>'status'
      WHEN 'review' THEN
        IF OLD.record->>'status' IS DISTINCT FROM 'draft' OR OLD.record->>'authorId' IS DISTINCT FROM actor::text OR NEW.published IS DISTINCT FROM OLD.published THEN RAISE EXCEPTION 'Invalid submission' USING ERRCODE='23514'; END IF;
      WHEN 'approved' THEN
        IF NOT privileged OR OLD.record->>'status' IS DISTINCT FROM 'review' OR OLD.record->>'authorId' IS NOT DISTINCT FROM actor::text
          OR NEW.record->>'reviewerId' IS DISTINCT FROM actor::text OR NEW.published IS DISTINCT FROM OLD.published THEN RAISE EXCEPTION 'Independent approval required' USING ERRCODE='23514'; END IF;
      WHEN 'published' THEN
        IF NOT privileged OR OLD.record->>'status' IS DISTINCT FROM 'approved' OR OLD.record->>'reviewerId' IS NULL
          OR NEW.record->>'reviewerId' IS DISTINCT FROM OLD.record->>'reviewerId' OR NEW.published IS DISTINCT FROM NEW.record THEN RAISE EXCEPTION 'Invalid publication' USING ERRCODE='23514'; END IF;
      WHEN 'retired' THEN
        IF NOT privileged OR NEW.published IS NOT NULL THEN RAISE EXCEPTION 'Invalid retirement' USING ERRCODE='23514'; END IF;
      END CASE;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER organization_workflow_guard BEFORE INSERT OR UPDATE ON tholi.organization_workflows FOR EACH ROW EXECUTE FUNCTION tholi.guard_organization_workflow();
REVOKE ALL ON FUNCTION tholi.guard_organization_workflow() FROM PUBLIC;

-- Reuse mandatory worker maintenance; private content is not retained indefinitely
-- merely because nobody opens the organization after its owner requests deletion.
CREATE FUNCTION tholi.prune_organization_content(batch integer) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
  DECLARE item record;
  BEGIN
    IF batch IS NULL OR batch NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid organization cleanup budget' USING ERRCODE='22023'; END IF;
    batch:=LEAST(batch,100);
    FOR item IN SELECT s.workspace_id,s.id,w.owner_account_id FROM tholi.organization_knowledge_sources s
      JOIN tholi.workspaces w ON w.id=s.workspace_id JOIN tholi.accounts a ON a.id=w.owner_account_id
      WHERE s.expires_at<=clock_timestamp() OR s.deleted_at IS NOT NULL OR a.status IN ('deletion_pending','deleted')
      ORDER BY s.workspace_id,s.id LIMIT batch LOOP
      PERFORM 1 FROM tholi.accounts WHERE id=item.owner_account_id FOR UPDATE SKIP LOCKED; IF NOT FOUND THEN CONTINUE; END IF;
      PERFORM 1 FROM tholi.workspaces WHERE id=item.workspace_id FOR UPDATE SKIP LOCKED; IF NOT FOUND THEN CONTINUE; END IF;
      DELETE FROM tholi.organization_knowledge_sources WHERE workspace_id=item.workspace_id AND id=item.id;
    END LOOP;
    WITH due AS (SELECT v.workspace_id,v.id,v.revision FROM tholi.organization_workflow_versions v
      JOIN tholi.workspaces w ON w.id=v.workspace_id JOIN tholi.accounts a ON a.id=w.owner_account_id
      WHERE v.created_at<clock_timestamp()-interval '90 days' OR a.status IN ('deletion_pending','deleted')
      ORDER BY v.created_at LIMIT batch FOR UPDATE OF v SKIP LOCKED)
      DELETE FROM tholi.organization_workflow_versions v USING due d WHERE (v.workspace_id,v.id,v.revision)=(d.workspace_id,d.id,d.revision);
    WITH due AS (SELECT v.workspace_id,v.revision FROM tholi.organization_policy_versions v
      JOIN tholi.workspaces w ON w.id=v.workspace_id JOIN tholi.accounts a ON a.id=w.owner_account_id
      WHERE v.created_at<clock_timestamp()-interval '90 days' OR a.status IN ('deletion_pending','deleted')
      ORDER BY v.created_at LIMIT batch FOR UPDATE OF v SKIP LOCKED)
      DELETE FROM tholi.organization_policy_versions v USING due d WHERE (v.workspace_id,v.revision)=(d.workspace_id,d.revision);
    WITH due AS (SELECT f.workspace_id,f.id FROM tholi.organization_workflows f JOIN tholi.workspaces w ON w.id=f.workspace_id JOIN tholi.accounts a ON a.id=w.owner_account_id
      WHERE a.status IN ('deletion_pending','deleted') AND NOT EXISTS(SELECT FROM tholi.organization_workflow_versions v WHERE v.workspace_id=f.workspace_id AND v.id=f.id)
      ORDER BY f.workspace_id,f.id LIMIT batch FOR UPDATE OF f SKIP LOCKED)
      DELETE FROM tholi.organization_workflows f USING due d WHERE (f.workspace_id,f.id)=(d.workspace_id,d.id);
    WITH due AS (SELECT p.workspace_id FROM tholi.organization_policies p JOIN tholi.workspaces w ON w.id=p.workspace_id JOIN tholi.accounts a ON a.id=w.owner_account_id
      WHERE a.status IN ('deletion_pending','deleted') ORDER BY p.workspace_id LIMIT batch FOR UPDATE OF p SKIP LOCKED)
      DELETE FROM tholi.organization_policies p USING due d WHERE p.workspace_id=d.workspace_id;
  END $$;
REVOKE ALL ON FUNCTION tholi.prune_organization_content(integer) FROM PUBLIC;
${extendFileFunctions(navigationKnowledge, ["prune_observability"], [["RETURN QUERY SELECT audit_count,product_count;", "PERFORM tholi.prune_organization_content(batch);\n  RETURN QUERY SELECT audit_count,product_count;"]])}
`;
