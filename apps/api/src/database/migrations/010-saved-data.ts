import { mailStorageSupport } from "./006-mail-storage-support";
import { portableObservability } from "./007-observability";

/** Extend the frozen existing pipeline rather than maintain another copy of it. */
function extendFileFunctions(source: string, names: readonly string[]) {
  return names
    .map((name) => {
      const start = source.indexOf(`CREATE FUNCTION tholi.${name}(`);
      const body = source.indexOf("$$", start);
      const end = source.indexOf("$$;", body + 2);
      if (start < 0 || body < 0 || end < 0)
        throw new Error(
          "The historical private-file migration is unavailable.",
        );
      return source
        .slice(start, end + 3)
        .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
        .replaceAll(
          "'file.diagnostic',",
          "'file.diagnostic','file.saved-data-export',",
        )
        .replaceAll(
          "'file.diagnostic')",
          "'file.diagnostic','file.saved-data-export')",
        )
        .replaceAll(
          "kind='file.diagnostic'",
          "kind IN ('file.diagnostic','file.saved-data-export')",
        );
    })
    .join("\n");
}

export const savedData = `
-- Legacy SavedTask rows retain their format and stored identifiers. New public
-- saved-data APIs admit only format 2, whose content is an explicitly approved DTO.
ALTER TABLE tholi.saved_artifacts ADD COLUMN format_version integer NOT NULL DEFAULT 1
  CHECK(format_version IN (1,2));
ALTER TABLE tholi.saved_artifacts ADD COLUMN metadata jsonb;
ALTER TABLE tholi.saved_artifacts DROP CONSTRAINT saved_artifacts_kind_check;
ALTER TABLE tholi.saved_artifacts ADD CONSTRAINT saved_artifacts_kind_check
  CHECK(kind IN ('saved_route','site_knowledge','conversation_excerpt','preferences'));
ALTER TABLE tholi.saved_artifacts ADD CONSTRAINT saved_artifact_format CHECK(COALESCE((
  (format_version=1 AND kind='saved_route' AND metadata IS NULL) OR
  (format_version=2 AND jsonb_typeof(metadata)='object'
    AND metadata ?& ARRAY['label','folder','tags']
    AND metadata-ARRAY['label','folder','tags']='{}'::jsonb
    AND jsonb_typeof(metadata->'label')='string'
    AND length(metadata->>'label') BETWEEN 1 AND 120
    AND (metadata->'folder'='null'::jsonb OR
      (jsonb_typeof(metadata->'folder')='string' AND length(metadata->>'folder') BETWEEN 1 AND 80))
    AND jsonb_typeof(metadata->'tags')='array' AND jsonb_array_length(metadata->'tags')<=10)),false));
CREATE INDEX saved_artifacts_public_owner_idx ON tholi.saved_artifacts(workspace_id,owner_account_id,sync_revision)
  WHERE format_version=2;

CREATE FUNCTION tholi.valid_saved_text(value jsonb,maximum integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT COALESCE(jsonb_typeof(value)='string' AND length(value#>>'{}') BETWEEN 1 AND maximum,false)
$$;
CREATE FUNCTION tholi.valid_saved_data(kind text,body jsonb,labels jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item jsonb; known text[];
BEGIN
  IF COALESCE(kind IS NULL OR body IS NULL OR jsonb_typeof(body)<>'object' OR labels IS NULL OR jsonb_typeof(labels)<>'object'
    OR NOT(labels ?& ARRAY['label','folder','tags']) OR labels-ARRAY['label','folder','tags']<>'{}'::jsonb
    OR NOT tholi.valid_saved_text(labels->'label',120)
    OR NOT(labels->'folder'='null'::jsonb OR tholi.valid_saved_text(labels->'folder',80))
    OR jsonb_typeof(labels->'tags')<>'array' OR jsonb_array_length(labels->'tags')>10,true) THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(labels->'tags') LOOP
    IF NOT tholi.valid_saved_text(item,40) THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(labels->'tags')) THEN RETURN false; END IF;
  CASE kind
  WHEN 'saved_route' THEN
    known:=ARRAY['origin','goal','steps','historyCompleted'];
    IF COALESCE(NOT(body ?& known) OR body-known<>'{}'::jsonb OR NOT tholi.valid_saved_text(body->'goal',1000)
      OR jsonb_typeof(body->'historyCompleted')<>'boolean' OR jsonb_typeof(body->'steps')<>'array'
      OR jsonb_array_length(body->'steps')>30,true) THEN RETURN false; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(body->'steps') LOOP
      IF COALESCE(jsonb_typeof(item)<>'object' OR NOT(item ?& ARRAY['kind','label']) OR item-ARRAY['kind','label']<>'{}'::jsonb
        OR jsonb_typeof(item->'kind')<>'string' OR item->>'kind' NOT IN ('control','navigation')
        OR NOT tholi.valid_saved_text(item->'label',160),true) THEN RETURN false; END IF;
    END LOOP;
  WHEN 'site_knowledge' THEN
    known:=ARRAY['origin','controls'];
    IF COALESCE(NOT(body ?& known) OR body-known<>'{}'::jsonb OR jsonb_typeof(body->'controls')<>'array'
      OR jsonb_array_length(body->'controls')>48,true) THEN RETURN false; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(body->'controls') LOOP
      IF COALESCE(jsonb_typeof(item)<>'object' OR NOT(item ?& ARRAY['role','label','kind']) OR item-ARRAY['role','label','kind']<>'{}'::jsonb
        OR jsonb_typeof(item->'kind')<>'string' OR item->>'kind' NOT IN ('control','navigation')
        OR NOT tholi.valid_saved_text(item->'role',40)
        OR NOT tholi.valid_saved_text(item->'label',160),true) THEN RETURN false; END IF;
    END LOOP;
  WHEN 'conversation_excerpt' THEN
    IF COALESCE(NOT(body ? 'messages') OR body-'messages'<>'{}'::jsonb OR jsonb_typeof(body->'messages')<>'array'
      OR jsonb_array_length(body->'messages') NOT BETWEEN 1 AND 12,true) THEN RETURN false; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(body->'messages') LOOP
      IF COALESCE(jsonb_typeof(item)<>'object' OR NOT(item ?& ARRAY['role','text']) OR item-ARRAY['role','text']<>'{}'::jsonb
        OR jsonb_typeof(item->'role')<>'string' OR item->>'role' NOT IN ('user','assistant')
        OR NOT tholi.valid_saved_text(item->'text',1000),true) THEN RETURN false; END IF;
    END LOOP;
  WHEN 'preferences' THEN
    IF COALESCE(NOT(body ? 'websiteAppearance') OR body-'websiteAppearance'<>'{}'::jsonb
      OR jsonb_typeof(body->'websiteAppearance')<>'string'
      OR body->>'websiteAppearance' NOT IN ('light','dark'),true) THEN RETURN false; END IF;
  ELSE RETURN false;
  END CASE;
  IF COALESCE(kind IN ('saved_route','site_knowledge') AND (NOT tholi.valid_saved_text(body->'origin',300)
    OR body->>'origin' !~ '^https?://[^/?#@]+$'),true) THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE tholi.saved_artifacts ADD CONSTRAINT saved_data_body CHECK(COALESCE(format_version=1 OR
  (deleted_at IS NULL AND tholi.valid_saved_data(kind,content,metadata)) OR
  (deleted_at IS NOT NULL AND content IS NULL AND metadata='{"label":"Deleted item","folder":null,"tags":[]}'::jsonb),false));

-- Request receipts contain only stable identifiers. Payloads remain exclusively
-- in saved_artifacts and expire with any separately requested private export.
CREATE FUNCTION tholi.valid_saved_receipt(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item jsonb;
BEGIN
  IF COALESCE(value IS NULL OR jsonb_typeof(value)<>'object' OR NOT(value ?& ARRAY['schemaVersion','ids'])
    OR value-ARRAY['schemaVersion','ids']<>'{}'::jsonb OR value->'schemaVersion'<>'1'::jsonb
    OR jsonb_typeof(value->'ids')<>'array' OR jsonb_array_length(value->'ids') NOT BETWEEN 1 AND 20,true) THEN RETURN false; END IF;
  FOR item IN SELECT element FROM jsonb_array_elements(value->'ids') AS elements(element) LOOP
    IF COALESCE(jsonb_typeof(item)<>'string' OR item#>>'{}' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',true) THEN RETURN false; END IF;
  END LOOP;
  RETURN (SELECT count(*)=count(DISTINCT element) FROM jsonb_array_elements(value->'ids') AS elements(element));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE tholi.requests ADD COLUMN saved_data_receipt jsonb
  CHECK(saved_data_receipt IS NULL OR (operation IN ('saved-data.save.v1','saved-data.delete.v1','saved-data.import.v1')
    AND status='completed' AND tholi.valid_saved_receipt(saved_data_receipt)));
CREATE FUNCTION tholi.guard_saved_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.saved_data_receipt IS NOT NULL AND (NEW.saved_data_receipt IS DISTINCT FROM OLD.saved_data_receipt
    OR ROW(NEW.workspace_id,NEW.id,NEW.account_id,NEW.operation,NEW.idempotency_key,NEW.payload_hash)
      IS DISTINCT FROM ROW(OLD.workspace_id,OLD.id,OLD.account_id,OLD.operation,OLD.idempotency_key,OLD.payload_hash)) THEN
    RAISE EXCEPTION 'The saved-data receipt is immutable.' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER saved_receipt_immutable BEFORE UPDATE ON tholi.requests FOR EACH ROW EXECUTE FUNCTION tholi.guard_saved_receipt();

-- This capability locks only the established actor and current purpose. It
-- cannot select another account, grant consent, or expose its records.
CREATE FUNCTION tholi.lock_saved_data_consent() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM 1 FROM tholi.accounts a JOIN tholi.memberships m ON m.account_id=a.id
    WHERE a.id=tholi.actor_account_id() AND m.workspace_id=tholi.actor_workspace_id()
      AND a.status='active' AND m.status='active' FOR SHARE OF a,m;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM tholi.consents c WHERE c.workspace_id=tholi.actor_workspace_id()
    AND c.account_id=tholi.actor_account_id() AND c.purpose='cloud_saved_routes'
    AND c.policy_version='2' AND c.granted FOR UPDATE OF c;
  RETURN FOUND;
END $$;

CREATE FUNCTION tholi.guard_saved_data() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' AND (OLD.deleted_at IS NOT NULL OR (OLD.format_version=2 AND NEW.format_version<>2)) THEN
    RAISE EXCEPTION 'Deleted saved data cannot be restored.' USING ERRCODE='P4403'; END IF;
  IF NEW.format_version=2 AND NEW.deleted_at IS NULL AND NOT tholi.lock_saved_data_consent() THEN
    RAISE EXCEPTION 'Current saved-data consent is required.' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approved_saved_data BEFORE INSERT OR UPDATE ON tholi.saved_artifacts
  FOR EACH ROW EXECUTE FUNCTION tholi.guard_saved_data();

-- Actual persisted content and metadata share the existing product storage
-- budget. Legacy byte accounting remains unchanged; no second counter exists.
CREATE FUNCTION tholi.saved_artifact_bytes(format integer,body jsonb,labels jsonb) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT COALESCE(octet_length(body::text),0)::bigint+
    CASE WHEN format=2 AND body IS NOT NULL THEN COALESCE(octet_length(labels::text),0)::bigint ELSE 0 END
$$;
CREATE OR REPLACE FUNCTION tholi.check_product_storage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE effective jsonb; caps jsonb; old_bytes bigint:=0; new_bytes bigint; stored_bytes bigint; stored_count bigint;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.content IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN old_bytes:=tholi.saved_artifact_bytes(OLD.format_version,OLD.content,OLD.metadata); END IF;
  new_bytes:=tholi.saved_artifact_bytes(NEW.format_version,NEW.content,NEW.metadata);
  IF TG_OP='UPDATE' AND new_bytes<=old_bytes THEN RETURN NEW; END IF;
  PERFORM 1 FROM tholi.accounts WHERE id=NEW.owner_account_id FOR UPDATE;
  effective:=tholi.effective_product_plan_internal(NEW.owner_account_id,NEW.workspace_id);
  IF effective IS NULL AND NEW.format_version=1 THEN RETURN NEW; END IF;
  IF effective IS NULL OR effective->>'status'<>'active' THEN
    RAISE EXCEPTION 'The product plan does not permit storage growth.' USING ERRCODE='P4401'; END IF;
  caps:=effective->'caps';
  SELECT count(*),COALESCE(sum(tholi.saved_artifact_bytes(a.format_version,a.content,a.metadata)),0)
    INTO stored_count,stored_bytes FROM tholi.saved_artifacts a
    WHERE a.owner_account_id=NEW.owner_account_id AND a.deleted_at IS NULL;
  IF stored_count+(CASE WHEN TG_OP='INSERT' THEN 1 ELSE 0 END)>(caps->>'maxSavedArtifacts')::bigint
    OR new_bytes>(caps->>'maxSavedArtifactBytes')::bigint
    OR stored_bytes-old_bytes+new_bytes>(caps->>'maxStoredBytes')::bigint THEN
    RAISE EXCEPTION 'The product storage allowance is exhausted.' USING ERRCODE='P4401'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER product_saved_artifact_limits ON tholi.saved_artifacts;
CREATE TRIGGER product_saved_artifact_limits BEFORE INSERT OR UPDATE OF content,metadata,format_version ON tholi.saved_artifacts
  FOR EACH ROW EXECUTE FUNCTION tholi.check_product_storage();

CREATE FUNCTION tholi.valid_saved_export(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item jsonb; fields text[]:=ARRAY['id','schemaVersion','kind','data','metadata','revision','syncRevision','createdAt','updatedAt','deletedAt'];
BEGIN
  IF COALESCE(value IS NULL OR jsonb_typeof(value)<>'object' OR NOT(value ?& ARRAY['schemaVersion','kind','createdAt','items'])
    OR value-ARRAY['schemaVersion','kind','createdAt','items']<>'{}'::jsonb OR value->'schemaVersion'<>'1'::jsonb
    OR jsonb_typeof(value->'kind')<>'string' OR value->>'kind'<>'saved-data-export' OR NOT tholi.valid_saved_text(value->'createdAt',50)
    OR jsonb_typeof(value->'items')<>'array' OR jsonb_array_length(value->'items') NOT BETWEEN 1 AND 20,true) THEN RETURN false; END IF;
  FOR item IN SELECT element FROM jsonb_array_elements(value->'items') AS elements(element) LOOP
    IF COALESCE(jsonb_typeof(item)<>'object' OR NOT(item ?& fields) OR item-fields<>'{}'::jsonb
      OR item->'schemaVersion'<>'1'::jsonb OR jsonb_typeof(item->'id')<>'string'
      OR item->>'id' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
      OR jsonb_typeof(item->'revision')<>'string' OR jsonb_typeof(item->'syncRevision')<>'string'
      OR item->>'revision' !~ '^[1-9][0-9]*$' OR item->>'syncRevision' !~ '^[1-9][0-9]*$'
      OR item->'deletedAt'<>'null'::jsonb OR NOT tholi.valid_saved_text(item->'createdAt',50)
      OR NOT tholi.valid_saved_text(item->'updatedAt',50)
      OR NOT tholi.valid_saved_data(item->>'kind',item->'data',item->'metadata'),true) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE tholi.private_files ADD COLUMN purpose text NOT NULL DEFAULT 'diagnostic'
  CHECK(purpose IN ('diagnostic','saved-data-export'));
DO $$ DECLARE constraint_name text; BEGIN
  SELECT conname INTO STRICT constraint_name FROM pg_constraint WHERE conrelid='tholi.private_files'::regclass
    AND contype='c' AND pg_get_constraintdef(oid) LIKE '%valid_diagnostic_snapshot%';
  EXECUTE format('ALTER TABLE tholi.private_files DROP CONSTRAINT %I',constraint_name);
END $$;
ALTER TABLE tholi.private_files ADD CONSTRAINT private_export_purpose CHECK(snapshot IS NULL OR
  (purpose='diagnostic' AND tholi.valid_diagnostic_snapshot(snapshot)) OR
  (purpose='saved-data-export' AND tholi.valid_saved_export(snapshot)));

-- File IDs do not grant access. Resolve only one file owned by the authenticated
-- account, with current membership in its actual workspace, before scoped reads.
CREATE FUNCTION tholi.resolve_owned_file_workspace(file uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE workspaces uuid[];
BEGIN
  SELECT array_agg(f.workspace_id) INTO workspaces FROM tholi.private_files f
    JOIN tholi.accounts a ON a.id=f.account_id AND a.status='active'
    JOIN tholi.memberships m ON m.workspace_id=f.workspace_id AND m.account_id=f.account_id AND m.status='active'
    WHERE f.id=file AND f.account_id=tholi.actor_account_id();
  IF cardinality(workspaces)<>1 THEN RETURN NULL; END IF;
  RETURN workspaces[1];
END $$;

-- A final short, read-only authority fence precedes the saved-data PUT. A
-- revocation after network dispatch cannot unsend it; late finish and expiry
-- keep that object private and remove it through the existing cleanup owner.
CREATE FUNCTION tholi.authorize_saved_export(workspace uuid,job uuid,fence uuid,attempt uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT FROM tholi.jobs j
    JOIN tholi.external_effects e ON e.workspace_id=j.workspace_id AND e.job_id=j.id
    JOIN tholi.external_attempts x ON x.workspace_id=e.workspace_id AND x.effect_id=e.id
    JOIN tholi.private_files f ON f.workspace_id=j.workspace_id AND f.request_id=j.request_id AND f.account_id=j.account_id
    JOIN tholi.accounts a ON a.id=j.account_id AND a.status='active'
    JOIN tholi.memberships m ON m.workspace_id=j.workspace_id AND m.account_id=j.account_id AND m.status='active'
    WHERE j.workspace_id=workspace AND j.id=job AND j.kind='file.saved-data-export' AND j.version=1
      AND j.status='running' AND j.claim_token=fence AND j.cancel_requested_at IS NULL AND j.lease_expires_at>clock_timestamp()
      AND x.id=attempt AND x.claim_token=fence AND x.state='started'
      AND f.purpose='saved-data-export' AND f.status='pending' AND f.snapshot IS NOT NULL AND f.expires_at>clock_timestamp())
$$;

${extendFileFunctions(mailStorageSupport, [
  "require_live_external_lease",
  "enqueue_file_expiry",
  "prepare_file_cleanup",
  "finish_external_effect",
  "guard_retention_job_cancel",
])}
${extendFileFunctions(portableObservability, ["job_health"])}

REVOKE ALL ON FUNCTION tholi.lock_saved_data_consent(),tholi.saved_artifact_bytes(integer,jsonb,jsonb),
  tholi.valid_saved_text(jsonb,integer),tholi.valid_saved_data(text,jsonb,jsonb),tholi.valid_saved_receipt(jsonb),
  tholi.guard_saved_data(),tholi.guard_saved_receipt(),tholi.valid_saved_export(jsonb),
  tholi.resolve_owned_file_workspace(uuid),tholi.authorize_saved_export(uuid,uuid,uuid,uuid) FROM PUBLIC;
`;
