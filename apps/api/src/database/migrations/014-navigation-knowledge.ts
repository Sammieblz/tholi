import { savedData, extendFileFunctions } from "./010-saved-data";
import { accountLifecycle } from "./011-account-lifecycle";
import { portableObservability } from "./007-observability";

/** Version 1 views stay strict. Graphs use new IDs and a separate persisted format. */
export const navigationKnowledge = `
CREATE TABLE tholi.navigation_knowledge_sites (
  workspace_id uuid NOT NULL REFERENCES tholi.workspaces(id),
  account_id uuid NOT NULL REFERENCES tholi.accounts(id),
  origin text NOT NULL CHECK(length(origin) BETWEEN 1 AND 300 AND origin ~ '^https?://[^/?#@]+$'),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  collect boolean NOT NULL DEFAULT false,
  use_knowledge boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_activity_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,account_id,origin)
);
ALTER TABLE tholi.navigation_knowledge_sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY navigation_knowledge_site_actor ON tholi.navigation_knowledge_sites
  USING(workspace_id=tholi.actor_workspace_id() AND account_id=tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL)
  WITH CHECK(workspace_id=tholi.actor_workspace_id() AND account_id=tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL);
CREATE FUNCTION tholi.clear_deleted_navigation_knowledge_sites() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.status IN ('deletion_pending','deleted') THEN
    DELETE FROM tholi.navigation_knowledge_sites WHERE account_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clear_deleted_navigation_knowledge_sites AFTER UPDATE OF status ON tholi.accounts
  FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION tholi.clear_deleted_navigation_knowledge_sites();
REVOKE ALL ON FUNCTION tholi.clear_deleted_navigation_knowledge_sites() FROM PUBLIC;
ALTER TABLE tholi.saved_artifacts DROP CONSTRAINT saved_artifacts_format_version_check;
ALTER TABLE tholi.saved_artifacts ADD CONSTRAINT saved_artifacts_format_version_check
  CHECK(format_version IN (1,2,3));
ALTER TABLE tholi.saved_artifacts ADD COLUMN knowledge_expires_at timestamptz;
CREATE INDEX saved_artifacts_knowledge_expiry_idx ON tholi.saved_artifacts(knowledge_expires_at,owner_account_id,workspace_id,id)
  WHERE format_version=3 AND deleted_at IS NULL;
CREATE INDEX navigation_knowledge_site_expiry_idx ON tholi.navigation_knowledge_sites(last_activity_at,account_id,workspace_id);
CREATE FUNCTION tholi.navigation_knowledge_expiry(body jsonb,received_at timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT LEAST(received_at,COALESCE(min((entry->>'observedAt')::timestamptz),received_at))+interval '2160 hours'
  FROM jsonb_array_elements((body->'states')||(body->'edges')) AS entries(entry)
$$;
ALTER TABLE tholi.saved_artifacts DROP CONSTRAINT saved_artifact_format;
ALTER TABLE tholi.saved_artifacts ADD CONSTRAINT saved_artifact_format CHECK(COALESCE(
  (format_version=1 AND kind='saved_route' AND metadata IS NULL) OR
  (format_version IN (2,3) AND jsonb_typeof(metadata)='object'
    AND (format_version=2 OR kind='site_knowledge')
    AND metadata ?& ARRAY['label','folder','tags']
    AND metadata-ARRAY['label','folder','tags']='{}'::jsonb
    AND tholi.valid_saved_text(metadata->'label',120)
    AND (metadata->'folder'='null'::jsonb OR tholi.valid_saved_text(metadata->'folder',80))
    AND jsonb_typeof(metadata->'tags')='array' AND jsonb_array_length(metadata->'tags')<=10)
  ,false));
CREATE INDEX saved_artifacts_knowledge_origin_idx
  ON tholi.saved_artifacts(workspace_id,owner_account_id,(content->>'origin'),updated_at DESC,id)
  WHERE format_version=3 AND kind='site_knowledge' AND deleted_at IS NULL;
CREATE INDEX saved_artifacts_graph_sync_idx
  ON tholi.saved_artifacts(workspace_id,owner_account_id,sync_revision)
  WHERE format_version=3;

CREATE FUNCTION tholi.valid_navigation_knowledge(body jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item jsonb; key jsonb;
BEGIN
  IF COALESCE(jsonb_typeof(body)<>'object'
    OR NOT(body ?& ARRAY['normalizationVersion','origin','controls','states','edges'])
    OR body-ARRAY['normalizationVersion','origin','controls','states','edges']<>'{}'::jsonb
    OR body->'normalizationVersion'<>'1'::jsonb
    OR NOT tholi.valid_saved_text(body->'origin',300) OR body->>'origin' !~ '^https?://[^/?#@]+$'
    OR jsonb_typeof(body->'controls')<>'array' OR jsonb_array_length(body->'controls')>48
    OR jsonb_typeof(body->'states')<>'array' OR jsonb_array_length(body->'states')>8
    OR jsonb_typeof(body->'edges')<>'array' OR jsonb_array_length(body->'edges')>16
    OR octet_length(body::text)>16384,true) THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(body->'controls') LOOP
    IF COALESCE(jsonb_typeof(item)<>'object' OR NOT(item ?& ARRAY['key','role','label','kind'])
      OR item-ARRAY['key','role','label','kind']<>'{}'::jsonb
      OR jsonb_typeof(item->'key')<>'string' OR item->>'key' !~ '^[a-f0-9]{64}$'
      OR item->>'role' NOT IN ('button','link','menuitem','menuitemcheckbox','menuitemradio','tab',
        'checkbox','radio','option','combobox','textbox','searchbox','switch','treeitem','summary',
        'region','navigation','heading','listbox','listitem','section','select','details')
      OR NOT tholi.valid_saved_text(item->'label',160)
      OR item->>'kind' NOT IN ('control','navigation'),true) THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT count(*)<>count(DISTINCT value->>'key') FROM jsonb_array_elements(body->'controls'))
    OR (SELECT count(*)<>count(DISTINCT value->>'key') FROM jsonb_array_elements(body->'states'))
    THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(body->'states') LOOP
    IF COALESCE(jsonb_typeof(item)<>'object' OR NOT(item ?& ARRAY['key','controls','observedAt'])
      OR item-ARRAY['key','controls','observedAt']<>'{}'::jsonb
      OR jsonb_typeof(item->'key')<>'string' OR item->>'key' !~ '^[a-f0-9]{64}$'
      OR NOT tholi.valid_saved_text(item->'observedAt',50)
      OR jsonb_typeof(item->'controls')<>'array' OR jsonb_array_length(item->'controls')>48,true) THEN RETURN false; END IF;
    PERFORM (item->>'observedAt')::timestamptz;
    IF (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(item->'controls')) THEN RETURN false; END IF;
    FOR key IN SELECT value FROM jsonb_array_elements(item->'controls') LOOP
      IF NOT EXISTS(SELECT FROM jsonb_array_elements(body->'controls') AS c(value) WHERE c.value->'key'=key)
        THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(body->'edges') LOOP
    IF COALESCE(jsonb_typeof(item)<>'object'
      OR NOT(item ?& ARRAY['from','to','control','operation','observedAt','successes','failures'])
      OR item-ARRAY['from','to','control','operation','observedAt','successes','failures']<>'{}'::jsonb
      OR item->>'operation' NOT IN ('reveal','choose','navigate','locate')
      OR NOT tholi.valid_saved_text(item->'observedAt',50)
      OR jsonb_typeof(item->'successes')<>'number' OR (item->>'successes')::numeric NOT BETWEEN 1 AND 1000000
      OR (item->>'successes')::numeric<>trunc((item->>'successes')::numeric)
      OR jsonb_typeof(item->'failures')<>'number' OR (item->>'failures')::numeric NOT BETWEEN 0 AND 1000000
      OR (item->>'failures')::numeric<>trunc((item->>'failures')::numeric),true) THEN RETURN false; END IF;
    PERFORM (item->>'observedAt')::timestamptz;
    IF NOT EXISTS(SELECT FROM jsonb_array_elements(body->'states') AS s(value)
        WHERE s.value->'key'=item->'from' AND (s.value->'controls') @> jsonb_build_array(item->'control'))
      OR NOT EXISTS(SELECT FROM jsonb_array_elements(body->'states') AS s(value) WHERE s.value->'key'=item->'to')
      THEN RETURN false; END IF;
  END LOOP;
  RETURN NOT EXISTS(SELECT FROM jsonb_array_elements(body->'edges') AS e(value)
    GROUP BY value->'from',value->'to',value->'control',value->'operation' HAVING count(*)>1);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION tholi.valid_public_saved_data(format integer,kind text,body jsonb,labels jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT CASE WHEN format=2 THEN tholi.valid_saved_data(kind,body,labels)
    WHEN format=3 THEN kind='site_knowledge' AND tholi.valid_navigation_knowledge(body)
      AND tholi.valid_saved_data('site_knowledge',jsonb_build_object('origin',body->'origin','controls','[]'::jsonb),labels)
    ELSE false END
$$;
ALTER TABLE tholi.saved_artifacts DROP CONSTRAINT saved_data_body;
ALTER TABLE tholi.saved_artifacts ADD CONSTRAINT saved_data_body CHECK(COALESCE(format_version=1 OR
  (deleted_at IS NULL AND tholi.valid_public_saved_data(format_version,kind,content,metadata)) OR
  (deleted_at IS NOT NULL AND content IS NULL AND metadata='{"label":"Deleted item","folder":null,"tags":[]}'::jsonb),false));

${extendFileFunctions(
  savedData,
  ["guard_saved_data"],
  [
    [
      "(OLD.format_version=2 AND NEW.format_version<>2)",
      "(OLD.format_version IN (2,3) AND NEW.format_version<>OLD.format_version)",
    ],
    [
      "NEW.format_version=2 AND NEW.deleted_at IS NULL",
      "NEW.format_version IN (2,3) AND NEW.deleted_at IS NULL",
    ],
    [
      "  RETURN NEW;",
      "  IF NEW.format_version=3 AND NEW.deleted_at IS NULL THEN\n    PERFORM 1 FROM tholi.navigation_knowledge_sites WHERE workspace_id=NEW.workspace_id AND account_id=NEW.owner_account_id AND origin=NEW.content->>'origin' AND collect AND last_activity_at>clock_timestamp()-interval '2160 hours' FOR SHARE;\n    IF NOT FOUND THEN RAISE EXCEPTION 'Current site collection approval is required.' USING ERRCODE='42501'; END IF;\n    NEW.knowledge_expires_at:=tholi.navigation_knowledge_expiry(NEW.content,clock_timestamp());\n    UPDATE tholi.navigation_knowledge_sites SET last_activity_at=clock_timestamp() WHERE workspace_id=NEW.workspace_id AND account_id=NEW.owner_account_id AND origin=NEW.content->>'origin';\n  ELSE NEW.knowledge_expires_at:=NULL;\n  END IF;\n  IF TG_OP='UPDATE' AND NEW.format_version=3 AND NEW.deleted_at IS NOT NULL THEN\n    NEW.metadata:='{\"label\":\"Deleted item\",\"folder\":null,\"tags\":[]}'::jsonb;\n  END IF;\n  RETURN NEW;",
    ],
  ],
)}
${extendFileFunctions(savedData, ["saved_artifact_bytes"], [["format=2", "format IN (2,3)"]])}
${extendFileFunctions(
  savedData,
  ["valid_saved_receipt"],
  [
    [
      "value->'schemaVersion'<>'1'::jsonb",
      "value->'schemaVersion' NOT IN ('1'::jsonb,'2'::jsonb)",
    ],
    [
      "jsonb_array_length(value->'ids') NOT BETWEEN 1 AND 20",
      "jsonb_array_length(value->'ids') NOT BETWEEN (CASE WHEN value->'schemaVersion'='2'::jsonb THEN 0 ELSE 1 END) AND 20",
    ],
  ],
)}
DO $$ DECLARE constraint_name text; BEGIN
  SELECT conname INTO STRICT constraint_name FROM pg_constraint WHERE conrelid='tholi.requests'::regclass
    AND contype='c' AND pg_get_constraintdef(oid) LIKE '%valid_saved_receipt%';
  EXECUTE format('ALTER TABLE tholi.requests DROP CONSTRAINT %I',constraint_name);
END $$;
ALTER TABLE tholi.requests ADD CONSTRAINT requests_saved_data_receipt_check CHECK(saved_data_receipt IS NULL OR
  (operation IN ('saved-data.save.v1','saved-data.delete.v1','saved-data.import.v1',
    'saved-data.save.v2','saved-data.delete.v2','saved-data.import.v2','saved-data.forget-site.v2')
    AND status='completed' AND tholi.valid_saved_receipt(saved_data_receipt)
    AND saved_data_receipt->>'schemaVersion'=right(operation,1)
    AND (operation='saved-data.forget-site.v2' OR jsonb_array_length(saved_data_receipt->'ids')>0)));

${extendFileFunctions(
  savedData,
  ["valid_saved_export"],
  [
    [
      "value->'schemaVersion'<>'1'::jsonb",
      "value->'schemaVersion' NOT IN ('1'::jsonb,'2'::jsonb)",
    ],
    [
      "item->'schemaVersion'<>'1'::jsonb",
      "(item->'schemaVersion'<>'1'::jsonb AND NOT(value->'schemaVersion'='2'::jsonb AND item->'schemaVersion'='2'::jsonb))",
    ],
    [
      "tholi.valid_saved_data(item->>'kind',item->'data',item->'metadata')",
      "tholi.valid_public_saved_data(CASE WHEN item->'schemaVersion'='2'::jsonb THEN 3 ELSE 2 END,item->>'kind',item->'data',item->'metadata')",
    ],
  ],
)}
${extendFileFunctions(
  accountLifecycle,
  ["valid_account_export_metadata"],
  [
    [
      "value-fields<>'{}'::jsonb",
      "(CASE WHEN receipt THEN value ELSE value-'savedDataSchemaVersion' END)-fields<>'{}'::jsonb OR (value ? 'savedDataSchemaVersion' AND (receipt OR value->'savedDataSchemaVersion'<>'2'::jsonb))",
    ],
    [
      "'usage','support','product_events')",
      "'usage','support','product_events','site_settings','provider_connections')",
    ],
  ],
)}
${extendFileFunctions(
  accountLifecycle,
  ["valid_account_export"],
  [
    [
      "value->'schemaVersion'<>'1'::jsonb",
      "(value->'schemaVersion'<>'1'::jsonb AND NOT(value->'schemaVersion'='2'::jsonb AND (purpose='account-export-manifest' OR value->>'section' IN ('saved_data','usage','site_settings','provider_connections'))))",
    ],
    [
      "WHEN 'plans' THEN",
      "WHEN 'site_settings' THEN CASE WHEN value->'schemaVersion'='2'::jsonb THEN ARRAY['origin','revision','collect','use','updatedAt'] END WHEN 'provider_connections' THEN CASE WHEN value->'schemaVersion'='2'::jsonb THEN ARRAY['id','provider','model','catalogRevision','routingPolicyVersion','policyDigest','status','revision','createdAt','updatedAt','verifiedAt'] END WHEN 'plans' THEN",
    ],
    [
      "WHEN 'usage' THEN ARRAY['id','requestId','provider','model','inputUnits','outputUnits','providerUsdMicros','chargedCredits','policyVersion','createdAt']",
      "WHEN 'usage' THEN CASE WHEN value->'schemaVersion'='2'::jsonb THEN ARRAY['id','requestId','provider','model','inputUnits','outputUnits','providerUsdMicros','chargedCredits','policyVersion','createdAt','fundingSource','usageVersion','customerUsdMicros','cacheReadInputUnits','cacheWriteInputUnits','reasoningOutputUnits'] ELSE ARRAY['id','requestId','provider','model','inputUnits','outputUnits','providerUsdMicros','chargedCredits','policyVersion','createdAt'] END",
    ],
    [
      "IF value->>'section'='saved_data' AND item->'data'<>'null'::jsonb AND NOT tholi.valid_saved_data(item->>'kind',item->'data',item->'metadata') THEN RETURN false; END IF;",
      "IF value->>'section'='saved_data' THEN\n        IF item->'schemaVersion'<>'1'::jsonb AND NOT(value->'schemaVersion'='2'::jsonb AND item->'schemaVersion'='2'::jsonb) THEN RETURN false; END IF;\n        IF item->'data'<>'null'::jsonb AND NOT tholi.valid_public_saved_data(CASE WHEN item->'schemaVersion'='2'::jsonb THEN 3 ELSE 2 END,item->>'kind',item->'data',item->'metadata') THEN RETURN false; END IF;\n        IF item->'data'='null'::jsonb AND (item->'deletedAt'='null'::jsonb OR item->'metadata'<>'{\"label\":\"Deleted item\",\"folder\":null,\"tags\":[]}'::jsonb) THEN RETURN false; END IF;\n      END IF;",
    ],
  ],
)}
-- Reuse the unconditional worker maintenance tick, including deployments with
-- analytics disabled. Every loop has a fixed budget and follows account/workspace
-- lock order without waiting on a live user transaction.
CREATE FUNCTION tholi.prune_navigation_knowledge(batch integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record; stamp bigint; removed integer:=0; changed integer;
BEGIN
  IF batch IS NULL OR batch NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Invalid retention budget.' USING ERRCODE='22023'; END IF;
  FOR item IN SELECT owner_account_id AS account_id,workspace_id,id FROM tholi.saved_artifacts
    WHERE format_version=3 AND deleted_at IS NULL AND knowledge_expires_at<=clock_timestamp()
    ORDER BY knowledge_expires_at,owner_account_id,workspace_id,id LIMIT batch LOOP
    PERFORM 1 FROM tholi.accounts WHERE id=item.account_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    PERFORM 1 FROM tholi.workspaces WHERE id=item.workspace_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    PERFORM 1 FROM tholi.saved_artifacts WHERE workspace_id=item.workspace_id AND owner_account_id=item.account_id
      AND id=item.id AND format_version=3 AND deleted_at IS NULL AND knowledge_expires_at<=clock_timestamp()
      FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE tholi.workspaces SET sync_revision=sync_revision+1,updated_at=clock_timestamp()
      WHERE id=item.workspace_id RETURNING sync_revision INTO stamp;
    UPDATE tholi.saved_artifacts SET content=NULL,metadata='{"label":"Deleted item","folder":null,"tags":[]}'::jsonb,
      deleted_at=clock_timestamp(),revision=revision+1,sync_revision=stamp,updated_at=clock_timestamp()
      WHERE workspace_id=item.workspace_id AND owner_account_id=item.account_id AND id=item.id AND deleted_at IS NULL;
    GET DIAGNOSTICS changed=ROW_COUNT; removed:=removed+changed;
  END LOOP;
  FOR item IN SELECT account_id,workspace_id,id FROM tholi.private_files
    WHERE expires_at<=clock_timestamp() AND snapshot IS NOT NULL
      AND purpose IN ('saved-data-export','account-export-part','account-export-manifest')
    ORDER BY expires_at,account_id,workspace_id,id LIMIT batch LOOP
    PERFORM 1 FROM tholi.accounts WHERE id=item.account_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    PERFORM 1 FROM tholi.workspaces WHERE id=item.workspace_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE tholi.private_files SET snapshot=NULL,status=CASE WHEN status='deleted' THEN status ELSE 'deleting' END,
      next_reconcile_at=clock_timestamp(),revision=revision+1
      WHERE workspace_id=item.workspace_id AND account_id=item.account_id AND id=item.id
        AND expires_at<=clock_timestamp() AND snapshot IS NOT NULL;
    IF FOUND THEN PERFORM tholi.enqueue_file_expiry(item.workspace_id,item.id); END IF;
  END LOOP;
  FOR item IN SELECT s.account_id,s.workspace_id,s.origin FROM tholi.navigation_knowledge_sites s
    WHERE s.last_activity_at<=clock_timestamp()-interval '2160 hours' AND NOT EXISTS(
      SELECT FROM tholi.saved_artifacts a WHERE a.workspace_id=s.workspace_id AND a.owner_account_id=s.account_id
        AND a.format_version=3 AND a.deleted_at IS NULL AND a.content->>'origin'=s.origin)
    ORDER BY s.last_activity_at,s.account_id,s.workspace_id,s.origin LIMIT batch LOOP
    PERFORM 1 FROM tholi.accounts WHERE id=item.account_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    PERFORM 1 FROM tholi.workspaces WHERE id=item.workspace_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    DELETE FROM tholi.navigation_knowledge_sites s WHERE s.workspace_id=item.workspace_id AND s.account_id=item.account_id
      AND s.origin=item.origin AND s.last_activity_at<=clock_timestamp()-interval '2160 hours' AND NOT EXISTS(
        SELECT FROM tholi.saved_artifacts a WHERE a.workspace_id=s.workspace_id AND a.owner_account_id=s.account_id
          AND a.format_version=3 AND a.deleted_at IS NULL AND a.content->>'origin'=s.origin);
  END LOOP;
  RETURN removed;
END $$;
-- An expired private export can discard its SQL body while its independently
-- fenced object deletion is pending. "deleted" retains its confirmed meaning.
DO $$ DECLARE constraint_name text; BEGIN
  SELECT conname INTO STRICT constraint_name FROM pg_constraint WHERE conrelid='tholi.private_files'::regclass
    AND contype='c' AND pg_get_constraintdef(oid) LIKE '%snapshot IS NULL%'
    AND pg_get_constraintdef(oid) LIKE '%status%';
  EXECUTE format('ALTER TABLE tholi.private_files DROP CONSTRAINT %I',constraint_name);
END $$;
ALTER TABLE tholi.private_files ADD CONSTRAINT private_file_retained_body CHECK(
  ((status='deleted')=(snapshot IS NULL)) OR
  (status='deleting' AND snapshot IS NULL AND purpose IN ('saved-data-export','account-export-part','account-export-manifest')));
${extendFileFunctions(
  portableObservability,
  ["prune_observability"],
  [
    [
      "RETURN QUERY SELECT audit_count,product_count;",
      "PERFORM tholi.prune_navigation_knowledge(batch);\n  RETURN QUERY SELECT audit_count,product_count;",
    ],
  ],
)}
REVOKE ALL ON FUNCTION tholi.valid_navigation_knowledge(jsonb),tholi.valid_public_saved_data(integer,text,jsonb,jsonb),
  tholi.navigation_knowledge_expiry(jsonb,timestamptz),tholi.prune_navigation_knowledge(integer) FROM PUBLIC;
`;
