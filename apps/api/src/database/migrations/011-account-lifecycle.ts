import { savedData, extendFileFunctions } from "./010-saved-data";

export const accountLifecycle = `
-- Account-scoped quota telemetry exposes quantities only. It does not transfer
-- access to a former workspace or expose another member's saved content.
CREATE FUNCTION tholi.read_saved_data_storage() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  IF NOT EXISTS(SELECT FROM tholi.accounts a JOIN tholi.memberships m ON m.account_id=a.id
    WHERE a.id=tholi.actor_account_id() AND a.status='active'
      AND m.workspace_id=tholi.actor_workspace_id() AND m.status='active') THEN
    RAISE EXCEPTION 'The account storage is unavailable.' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('scope','account','artifacts',count(*)::text,
    'bytes',COALESCE(sum(tholi.saved_artifact_bytes(format_version,content,metadata)),0)::text)
    INTO result FROM tholi.saved_artifacts WHERE owner_account_id=tholi.actor_account_id() AND deleted_at IS NULL;
  RETURN result;
END $$;

-- Progress and receipts contain bounded identifiers/cursors only. All exported
-- user content remains in the existing expiring private_files snapshots.
CREATE FUNCTION tholi.valid_account_export_metadata(value jsonb,receipt boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE fields text[]; item jsonb;
BEGIN
  fields:=CASE WHEN receipt THEN ARRAY['requestId','jobId','fileId','generation','preparation','delivery','continuation','expiresAt']
    ELSE ARRAY['version','generation','revision','stage','section','workspaceId','workspaceAfter','cursor','cutoff','startedAt','sessionId','latest','omissions'] END;
  IF COALESCE(jsonb_typeof(value)<>'object' OR NOT(value ?& fields) OR value-fields<>'{}'::jsonb
    OR octet_length(value::text)>32768 OR value->>'generation' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',true) THEN RETURN false; END IF;
  IF receipt THEN RETURN COALESCE(value->>'preparation' IN ('partial','complete') AND value->>'delivery' IN ('pending','ready','failed','expired')
    AND tholi.valid_saved_text(value->'expiresAt',50) AND value->>'requestId' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    AND value->>'jobId' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    AND value->>'fileId' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    AND (value->'continuation'='null'::jsonb OR (tholi.valid_saved_text(value->'continuation',512) AND value->>'continuation' ~ '^[A-Za-z0-9_-]+$')),false); END IF;
  IF COALESCE(jsonb_typeof(value->'omissions')<>'array' OR jsonb_array_length(value->'omissions')>100,true) THEN RETURN false; END IF;
  FOR item IN SELECT element FROM jsonb_array_elements(value->'omissions') AS elements(element) LOOP
    IF COALESCE(jsonb_typeof(item)<>'object' OR NOT(item ?& ARRAY['workspaceId','section','reason'])
      OR item-ARRAY['workspaceId','section','reason']<>'{}'::jsonb
      OR NOT(item->'workspaceId'='null'::jsonb OR item->>'workspaceId' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
      OR item->>'section' NOT IN ('profile','contacts','sessions','memberships','consents','saved_data','plans','credits','credit_history','usage','support','product_events')
      OR item->>'reason' NOT IN ('workspace-access-revoked','changed-during-collection','not-exportable'),true) THEN RETURN false; END IF;
  END LOOP;
  RETURN COALESCE(value->'version'='1'::jsonb AND jsonb_typeof(value->'revision')='number' AND (value->>'revision')::bigint>0
    AND value->>'stage' IN ('global','workspace','done') AND jsonb_typeof(value->'section')='number'
    AND (value->>'section')::integer BETWEEN 0 AND 12 AND tholi.valid_saved_text(value->'cutoff',50)
    AND tholi.valid_saved_text(value->'startedAt',50) AND value->>'sessionId' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    AND (value->'workspaceId'='null'::jsonb OR value->>'workspaceId' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
    AND (value->'workspaceAfter'='null'::jsonb OR value->>'workspaceAfter' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
    AND (value->'cursor'='null'::jsonb OR tholi.valid_saved_text(value->'cursor',512))
    AND (value->'latest'='null'::jsonb OR tholi.valid_account_export_metadata(value->'latest',true))
    AND jsonb_typeof(value->'omissions')='array' AND jsonb_array_length(value->'omissions')<=100,false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE tholi.requests ADD COLUMN account_export_state jsonb CHECK(account_export_state IS NULL OR
  (operation='account.export.v1' AND account_export_state->>'generation'=id::text AND tholi.valid_account_export_metadata(account_export_state,false)));
ALTER TABLE tholi.requests ADD COLUMN account_export_receipt jsonb CHECK(account_export_receipt IS NULL OR
  (operation IN ('account.export.v1','account.export.continue.v1') AND account_export_receipt->>'requestId'=id::text
    AND tholi.valid_account_export_metadata(account_export_receipt,true)));
ALTER TABLE tholi.requests ADD COLUMN account_deletion_receipt jsonb CHECK(account_deletion_receipt IS NULL OR COALESCE(
  (operation='account.delete.v1' AND jsonb_typeof(account_deletion_receipt)='object'
    AND account_deletion_receipt ?& ARRAY['requestId','jobId','status','signedOut','retained']
    AND account_deletion_receipt-ARRAY['requestId','jobId','status','signedOut','retained']='{}'::jsonb
    AND account_deletion_receipt->>'requestId'=id::text
    AND account_deletion_receipt->>'jobId' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    AND account_deletion_receipt->>'status'='deletion_pending' AND account_deletion_receipt->'signedOut'='true'::jsonb
    AND account_deletion_receipt->'retained'='["identity-and-abuse-prevention","financial-liabilities","security-audit","deletion-tombstones"]'::jsonb),false));
CREATE FUNCTION tholi.guard_account_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF (OLD.account_export_receipt IS NOT NULL AND NEW.account_export_receipt IS DISTINCT FROM OLD.account_export_receipt)
    OR (OLD.account_deletion_receipt IS NOT NULL AND NEW.account_deletion_receipt IS DISTINCT FROM OLD.account_deletion_receipt) THEN
    RAISE EXCEPTION 'Account receipts are immutable.' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_receipt_immutable BEFORE UPDATE ON tholi.requests FOR EACH ROW EXECUTE FUNCTION tholi.guard_account_receipt();

CREATE FUNCTION tholi.valid_account_export(value jsonb,purpose text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE fields text[]; item jsonb; allowed text[];
BEGIN
  fields:=CASE WHEN purpose='account-export-part' THEN ARRAY['schemaVersion','kind','generation','accountId','workspaceId','cutoff','section','items']
    ELSE ARRAY['schemaVersion','kind','generation','accountId','startedAt','completedAt','cutoff','consistency','scope','parts','previousManifestFileId','continuation','complete','omissions'] END;
  IF COALESCE(purpose NOT IN ('account-export-part','account-export-manifest') OR jsonb_typeof(value)<>'object'
    OR NOT(value ?& fields) OR value-fields<>'{}'::jsonb OR value->'schemaVersion'<>'1'::jsonb OR value->>'kind'<>purpose
    OR value->>'generation' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    OR value->>'accountId' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    OR NOT tholi.valid_saved_text(value->'cutoff',50),true) THEN RETURN false; END IF;
  IF purpose='account-export-part' THEN
    IF COALESCE(jsonb_typeof(value->'items')<>'array' OR jsonb_array_length(value->'items')>100
      OR NOT(value->'workspaceId'='null'::jsonb OR value->>'workspaceId' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'),true) THEN RETURN false; END IF;
    allowed:=CASE value->>'section'
      WHEN 'profile' THEN ARRAY['accountId','revision','createdAt','updatedAt'] WHEN 'contacts' THEN ARRAY['identityId','verifiedEmail']
      WHEN 'sessions' THEN ARRAY['id','clientId','clientKind','expiresAt','createdAt','lastUsedAt','current']
      WHEN 'memberships' THEN ARRAY['workspaceId','kind','role','status','revision']
      WHEN 'consents' THEN ARRAY['id','purpose','policyVersion','granted','revision']
      WHEN 'saved_data' THEN ARRAY['id','schemaVersion','kind','data','metadata','revision','syncRevision','createdAt','updatedAt','deletedAt']
      WHEN 'plans' THEN ARRAY['kind','value'] WHEN 'credits' THEN ARRAY['balance','policy']
      WHEN 'credit_history' THEN ARRAY['id','kind','amount','createdAt','source','periodStart','periodEnd','expiresAt','policyVersion']
      WHEN 'usage' THEN ARRAY['id','requestId','provider','model','inputUnits','outputUnits','providerUsdMicros','chargedCredits','policyVersion','createdAt']
      WHEN 'support' THEN ARRAY['requestId','name','email','topic','subject','message','createdAt','purgedAt','expiresAt']
      WHEN 'product_events' THEN ARRAY['schemaVersion','eventId','event','recordedAt'] ELSE NULL END;
    IF allowed IS NULL THEN RETURN false; END IF;
    FOR item IN SELECT element FROM jsonb_array_elements(value->'items') AS elements(element) LOOP
      IF COALESCE(jsonb_typeof(item)<>'object' OR NOT(item ?& allowed) OR item-allowed<>'{}'::jsonb,true) THEN RETURN false; END IF;
      IF value->>'section'='saved_data' AND item->'data'<>'null'::jsonb AND NOT tholi.valid_saved_data(item->>'kind',item->'data',item->'metadata') THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  END IF;
  RETURN COALESCE(value->>'consistency'='collected-over-interval' AND jsonb_typeof(value->'parts')='array'
    AND jsonb_array_length(value->'parts')<=64 AND jsonb_typeof(value->'complete')='boolean'
    AND jsonb_typeof(value->'scope')='object' AND value->'scope' ?& ARRAY['workspaces','workspaceIds']
    AND (value->'scope')-ARRAY['workspaces','workspaceIds']='{}'::jsonb
    AND value->'scope'->>'workspaces'='current-memberships' AND jsonb_typeof(value->'scope'->'workspaceIds')='array'
    AND jsonb_array_length(value->'scope'->'workspaceIds')<=100 AND jsonb_typeof(value->'omissions')='array'
    AND jsonb_array_length(value->'omissions')<=100,false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE tholi.private_files DROP CONSTRAINT private_files_purpose_check;
ALTER TABLE tholi.private_files ADD CONSTRAINT private_files_purpose_check
  CHECK(purpose IN ('diagnostic','saved-data-export','account-export-part','account-export-manifest'));
ALTER TABLE tholi.private_files ADD COLUMN account_export_generation uuid;
ALTER TABLE tholi.private_files ADD CONSTRAINT account_export_generation_owner
  FOREIGN KEY(workspace_id,account_export_generation,account_id) REFERENCES tholi.requests(workspace_id,id,account_id);
ALTER TABLE tholi.private_files ADD CONSTRAINT account_export_generation_kind
  CHECK((purpose IN ('account-export-part','account-export-manifest'))=(account_export_generation IS NOT NULL));
CREATE INDEX private_files_account_generation_idx ON tholi.private_files(workspace_id,account_id,account_export_generation)
  WHERE account_export_generation IS NOT NULL;
ALTER TABLE tholi.private_files DROP CONSTRAINT private_export_purpose;
ALTER TABLE tholi.private_files ADD CONSTRAINT private_export_purpose CHECK(snapshot IS NULL OR
  (purpose='diagnostic' AND tholi.valid_diagnostic_snapshot(snapshot)) OR
  (purpose='saved-data-export' AND tholi.valid_saved_export(snapshot)) OR
  (purpose IN ('account-export-part','account-export-manifest') AND snapshot->>'accountId'=account_id::text AND tholi.valid_account_export(snapshot,purpose)));

CREATE FUNCTION tholi.account_export_sources_allowed(actor uuid,value jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE workspace text;
BEGIN
  IF actor IS NULL OR value IS NULL OR value->>'accountId' IS DISTINCT FROM actor::text OR NOT EXISTS(
    SELECT FROM tholi.accounts WHERE id=actor AND status='active') THEN RETURN false; END IF;
  IF value->>'kind'='account-export-part' THEN
    IF value->'workspaceId'='null'::jsonb THEN RETURN true; END IF;
    RETURN EXISTS(SELECT FROM tholi.memberships WHERE account_id=actor AND workspace_id=(value->>'workspaceId')::uuid AND status='active');
  END IF;
  IF value->>'kind'<>'account-export-manifest' THEN RETURN false; END IF;
  FOR workspace IN SELECT jsonb_array_elements_text(value->'scope'->'workspaceIds') LOOP
    IF NOT EXISTS(SELECT FROM tholi.memberships WHERE account_id=actor AND workspace_id=workspace::uuid AND status='active') THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION tholi.current_account_export_allowed(value jsonb) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT tholi.account_export_sources_allowed(tholi.actor_account_id(),value) $$;
CREATE FUNCTION tholi.authorize_account_export(workspace uuid,job uuid,fence uuid,attempt uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT FROM tholi.jobs j JOIN tholi.external_effects e ON e.workspace_id=j.workspace_id AND e.job_id=j.id
    JOIN tholi.external_attempts x ON x.workspace_id=e.workspace_id AND x.effect_id=e.id
    JOIN tholi.private_files f ON f.workspace_id=j.workspace_id AND f.request_id=j.request_id AND f.account_id=j.account_id
    WHERE j.workspace_id=workspace AND j.id=job AND j.kind IN ('file.account-export-part','file.account-export-manifest') AND j.version=1
      AND j.status='running' AND j.claim_token=fence AND j.cancel_requested_at IS NULL AND j.lease_expires_at>clock_timestamp()
      AND j.record_references=jsonb_build_object('requestId',j.request_id) AND x.id=attempt AND x.claim_token=fence AND x.state='started'
      AND f.purpose=substring(j.kind FROM 6) AND f.status='pending' AND f.expires_at>clock_timestamp()
      AND tholi.account_export_sources_allowed(j.account_id,f.snapshot))
$$;

${extendFileFunctions(
  savedData,
  [
    "require_live_external_lease",
    "enqueue_file_expiry",
    "prepare_file_cleanup",
    "finish_external_effect",
    "guard_retention_job_cancel",
  ],
  [
    [
      "'file.saved-data-export'",
      "'file.saved-data-export','file.account-export-part','file.account-export-manifest'",
    ],
    [
      "AND j.cancel_requested_at IS NULL AND f.status IN ('pending','ready') INTO visible;",
      "AND j.cancel_requested_at IS NULL AND f.status IN ('pending','ready') AND (f.purpose NOT IN ('account-export-part','account-export-manifest') OR tholi.account_export_sources_allowed(j.account_id,f.snapshot)) INTO visible;",
    ],
    [
      "WHERE a.id=j.account_id AND a.status='active' AND m.status='active')) RETURNING * INTO f;",
      "WHERE a.id=j.account_id AND a.status='active' AND m.status='active') OR (purpose IN ('account-export-part','account-export-manifest') AND NOT tholi.account_export_sources_allowed(j.account_id,snapshot))) RETURNING * INTO f;",
    ],
  ],
)}
${extendFileFunctions(
  savedData,
  ["job_health"],
  [
    [
      "'file.saved-data-export'",
      "'file.saved-data-export','file.account-export-part','file.account-export-manifest','account.delete'",
    ],
  ],
)}

-- The existing all-session logout and account deletion use one grant fence.
CREATE FUNCTION tholi.revoke_current_account_grants(at_time timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=tholi.actor_account_id();
BEGIN
  IF actor IS NULL OR at_time IS NULL THEN RAISE EXCEPTION 'The account is unavailable.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM tholi.accounts WHERE id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The account is unavailable.' USING ERRCODE='42501'; END IF;
  UPDATE tholi.accounts SET revision=revision+1,updated_at=at_time,auth_grants_revoked_at=GREATEST(auth_grants_revoked_at,
    date_trunc('second',at_time)+interval '5 seconds') WHERE id=actor;
  UPDATE tholi.sessions SET status='revoked',revoked_at=at_time WHERE account_id=actor AND status='active';
  DELETE FROM tholi.identity_brokers WHERE account_id=actor;
END $$;

CREATE FUNCTION tholi.request_account_deletion(target_request uuid,target_job uuid,expected bigint,current_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=tholi.actor_account_id(); workspace uuid:=tholi.actor_workspace_id(); receipt jsonb;
BEGIN
  PERFORM 1 FROM tholi.accounts WHERE id=actor AND status='active' AND revision=expected FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The account has changed.' USING ERRCODE='P4403'; END IF;
  PERFORM 1 FROM tholi.workspaces w JOIN tholi.memberships m ON m.workspace_id=w.id AND m.account_id=actor
    WHERE w.id=workspace AND w.kind='personal' AND w.owner_account_id=actor AND m.role='owner' AND m.status='active' FOR UPDATE OF w;
  IF NOT FOUND OR NOT EXISTS(SELECT FROM tholi.sessions s JOIN tholi.memberships m ON m.workspace_id=s.workspace_id AND m.account_id=s.account_id
    WHERE s.id=current_session AND s.account_id=actor AND s.status='active' AND s.access_expires_at>clock_timestamp()
      AND s.expires_at>clock_timestamp() AND m.status='active') THEN
    RAISE EXCEPTION 'A current account proof is required.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM tholi.workspaces WHERE owner_account_id=actor ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT FROM tholi.workspaces w JOIN tholi.memberships m ON m.workspace_id=w.id AND m.account_id<>actor AND m.status='active'
    WHERE w.kind='organization' AND w.owner_account_id=actor) THEN
    RAISE EXCEPTION 'Transfer organization ownership before deleting this account.' USING ERRCODE='P4403'; END IF;
  IF NOT EXISTS(SELECT FROM tholi.requests r JOIN tholi.jobs j ON j.workspace_id=r.workspace_id AND j.request_id=r.id AND j.account_id=r.account_id
    WHERE r.workspace_id=workspace AND r.id=target_request AND r.account_id=actor AND r.operation='account.delete.v1'
      AND j.id=target_job AND j.kind='account.delete' AND j.version=1 AND j.status='queued'
      AND j.record_references=jsonb_build_object('accountId',actor,'requestId',target_request)) THEN
    RAISE EXCEPTION 'The account deletion request is unavailable.' USING ERRCODE='42501'; END IF;
  PERFORM tholi.revoke_current_account_grants(clock_timestamp());
  INSERT INTO tholi.security_audit(account_id,kind,details) VALUES(actor,'sessions.revoked_all','{}'::jsonb);
  UPDATE tholi.accounts SET status='deletion_pending',updated_at=clock_timestamp() WHERE id=actor;
  UPDATE tholi.memberships SET status='revoked',revision=revision+1,updated_at=clock_timestamp() WHERE account_id=actor AND status='active';
  UPDATE tholi.entitlements SET status='ended',revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=workspace AND status<>'ended';
  UPDATE tholi.jobs SET cancel_requested_at=clock_timestamp(),status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,
    revision=revision+1,updated_at=clock_timestamp() WHERE account_id=actor AND status IN ('queued','running')
      AND kind NOT IN ('account.delete','file.expire','inference.reconcile');
  receipt:=jsonb_build_object('requestId',target_request,'jobId',target_job,'status','deletion_pending','signedOut',true,
    'retained',jsonb_build_array('identity-and-abuse-prevention','financial-liabilities','security-audit','deletion-tombstones'));
  UPDATE tholi.requests SET account_deletion_receipt=receipt WHERE workspace_id=workspace AND id=target_request AND account_id=actor;
  RETURN receipt;
END $$;

CREATE FUNCTION tholi.cleanup_account_deletion(workspace uuid,actor uuid,target_job uuid,fence uuid,batch integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE task tholi.jobs; row record; stamp bigint; processed integer:=0; changed integer; remaining boolean; following uuid;
BEGIN
  IF batch IS NULL OR batch NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid deletion budget.' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM tholi.accounts WHERE id=actor AND status='deletion_pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO task FROM tholi.jobs WHERE workspace_id=workspace AND account_id=actor AND id=target_job
    AND kind='account.delete' AND version=1 AND status='running' AND claim_token=fence AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF task.id IS NULL OR task.record_references<>jsonb_build_object('accountId',actor,'requestId',task.request_id)
    OR NOT EXISTS(SELECT FROM tholi.workspaces WHERE id=workspace AND owner_account_id=actor AND kind='personal')
    OR NOT EXISTS(SELECT FROM tholi.requests WHERE workspace_id=workspace AND id=task.request_id AND account_id=actor AND operation='account.delete.v1') THEN
    RAISE EXCEPTION 'The deletion lease is unavailable.' USING ERRCODE='42501'; END IF;
  FOR row IN SELECT workspace_id,id,format_version FROM tholi.saved_artifacts WHERE owner_account_id=actor AND deleted_at IS NULL
    ORDER BY workspace_id,id LIMIT batch LOOP
    UPDATE tholi.workspaces SET sync_revision=sync_revision+1,updated_at=clock_timestamp() WHERE id=row.workspace_id RETURNING sync_revision INTO stamp;
    UPDATE tholi.saved_artifacts SET content=NULL,deleted_at=clock_timestamp(),revision=revision+1,sync_revision=stamp,updated_at=clock_timestamp(),
      metadata=CASE WHEN format_version=2 THEN '{"label":"Deleted item","folder":null,"tags":[]}'::jsonb ELSE NULL END
      WHERE workspace_id=row.workspace_id AND id=row.id AND owner_account_id=actor AND deleted_at IS NULL;
    processed:=processed+1;
  END LOOP;
  IF processed<batch THEN
    WITH due AS (SELECT workspace_id,event_id FROM tholi.product_events WHERE account_id=actor ORDER BY workspace_id,event_id LIMIT batch-processed)
      DELETE FROM tholi.product_events e USING due WHERE e.workspace_id=due.workspace_id AND e.event_id=due.event_id AND e.account_id=actor;
    GET DIAGNOSTICS changed=ROW_COUNT; processed:=processed+changed;
  END IF;
  IF processed<batch THEN
    WITH due AS (SELECT workspace_id,request_id FROM tholi.support_requests WHERE account_id=actor AND purged_at IS NULL ORDER BY workspace_id,request_id LIMIT batch-processed)
      UPDATE tholi.support_requests s SET name=NULL,email=NULL,subject=NULL,message=NULL,purged_at=clock_timestamp()
      FROM due WHERE s.workspace_id=due.workspace_id AND s.request_id=due.request_id AND s.account_id=actor;
    GET DIAGNOSTICS changed=ROW_COUNT; processed:=processed+changed;
  END IF;
  IF processed<batch THEN
    WITH due AS (SELECT identity_id FROM tholi.identity_delivery_contacts WHERE account_id=actor AND email IS NOT NULL ORDER BY identity_id LIMIT batch-processed)
      UPDATE tholi.identity_delivery_contacts c SET email=NULL,revision=revision+1 FROM due WHERE c.identity_id=due.identity_id AND c.account_id=actor;
    GET DIAGNOSTICS changed=ROW_COUNT; processed:=processed+changed;
  END IF;
  IF processed<batch THEN
    FOR row IN SELECT workspace_id,id FROM tholi.private_files WHERE account_id=actor AND status IN ('pending','ready') ORDER BY workspace_id,id LIMIT batch-processed LOOP
      UPDATE tholi.private_files SET status='deleting',expires_at=LEAST(expires_at,clock_timestamp()),revision=revision+1 WHERE workspace_id=row.workspace_id AND id=row.id;
      PERFORM tholi.enqueue_file_expiry(row.workspace_id,row.id); processed:=processed+1;
    END LOOP;
  END IF;
  remaining:=EXISTS(SELECT FROM tholi.saved_artifacts WHERE owner_account_id=actor AND deleted_at IS NULL)
    OR EXISTS(SELECT FROM tholi.product_events WHERE account_id=actor)
    OR EXISTS(SELECT FROM tholi.support_requests WHERE account_id=actor AND purged_at IS NULL)
    OR EXISTS(SELECT FROM tholi.identity_delivery_contacts WHERE account_id=actor AND email IS NOT NULL)
    OR EXISTS(SELECT FROM tholi.private_files WHERE account_id=actor AND (status<>'deleted' OR next_reconcile_at<=clock_timestamp()))
    OR EXISTS(SELECT FROM tholi.external_attempts x JOIN tholi.external_effects e ON e.workspace_id=x.workspace_id AND e.id=x.effect_id
      JOIN tholi.jobs j ON j.workspace_id=e.workspace_id AND j.id=e.job_id
      JOIN tholi.private_files f ON f.workspace_id=j.workspace_id AND f.request_id=j.request_id AND f.account_id=j.account_id
      WHERE j.account_id=actor AND j.kind IN ('file.diagnostic','file.saved-data-export','file.account-export-part','file.account-export-manifest')
        AND x.state<>'committed' AND (x.quiescent_at>clock_timestamp() OR f.last_reaped_at IS NULL OR f.last_reaped_at<x.quiescent_at));
  IF NOT remaining THEN
    -- Versioned consent, identity links, grant claims, financial liabilities and
    -- stable tombstones survive; usable session credentials do not.
    UPDATE tholi.consents SET granted=false,revision=revision+1,updated_at=clock_timestamp() WHERE account_id=actor AND granted;
    DELETE FROM tholi.session_refresh_tokens WHERE session_id IN (SELECT id FROM tholi.sessions WHERE account_id=actor);
    DELETE FROM tholi.sessions WHERE account_id=actor;
    UPDATE tholi.accounts SET status='deleted',revision=revision+1,updated_at=clock_timestamp() WHERE id=actor AND status='deletion_pending';
  ELSE
    following:=gen_random_uuid();
    INSERT INTO tholi.jobs(workspace_id,id,account_id,request_id,kind,version,idempotency_key,record_references,replay_safe,available_at)
      VALUES(workspace,following,actor,task.request_id,'account.delete',1,'account-delete-next:'||target_job::text,
        jsonb_build_object('accountId',actor,'requestId',task.request_id),true,clock_timestamp()+CASE WHEN processed=0 THEN interval '30 seconds' ELSE interval '1 second' END)
      ON CONFLICT DO NOTHING;
  END IF;
  UPDATE tholi.jobs SET status='succeeded',result_count=processed,claim_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
    revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=workspace AND id=target_job AND claim_token=fence AND lease_expires_at>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'The deletion lease expired.' USING ERRCODE='40001'; END IF;
  INSERT INTO tholi.outbox(workspace_id,id,job_id,event_kind,idempotency_key,status,published_at)
    VALUES(workspace,gen_random_uuid(),target_job,'job.completed','job:'||target_job::text||':completed','published',clock_timestamp()) ON CONFLICT DO NOTHING;
END $$;

CREATE FUNCTION tholi.guard_account_deletion_job() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.kind='account.delete' AND (NEW.cancel_requested_at IS DISTINCT FROM OLD.cancel_requested_at OR NEW.status='cancelled') THEN
    RAISE EXCEPTION 'Account deletion cannot be cancelled.' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_deletion_mandatory BEFORE UPDATE ON tholi.jobs FOR EACH ROW EXECUTE FUNCTION tholi.guard_account_deletion_job();

REVOKE ALL ON FUNCTION tholi.read_saved_data_storage(),tholi.valid_account_export_metadata(jsonb,boolean),
  tholi.guard_account_receipt(),tholi.valid_account_export(jsonb,text),tholi.account_export_sources_allowed(uuid,jsonb),
  tholi.current_account_export_allowed(jsonb),tholi.authorize_account_export(uuid,uuid,uuid,uuid),
  tholi.revoke_current_account_grants(timestamptz),tholi.request_account_deletion(uuid,uuid,bigint,uuid),
  tholi.cleanup_account_deletion(uuid,uuid,uuid,uuid,integer),tholi.guard_account_deletion_job() FROM PUBLIC;
`;
