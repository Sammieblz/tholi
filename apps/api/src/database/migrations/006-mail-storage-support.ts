export const mailStorageSupport = `
ALTER TABLE tholi.requests ADD CONSTRAINT requests_actor_key UNIQUE(workspace_id,id,account_id);
ALTER TABLE tholi.jobs ADD CONSTRAINT jobs_actor_key UNIQUE(workspace_id,id,account_id);
-- Contact comes only from a verified issuer/subject projection, never form data.
CREATE TABLE tholi.identity_delivery_contacts (
  identity_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  email text CHECK (email IS NULL OR (length(email) BETWEEN 3 AND 254 AND email !~ '[[:cntrl:]]' AND email LIKE '%@%')),
  provider_issued_at timestamptz NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE(account_id,identity_id),
  FOREIGN KEY (account_id,identity_id) REFERENCES tholi.identity_links(account_id,id)
);
ALTER TABLE tholi.identity_delivery_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_self ON tholi.identity_delivery_contacts
  USING (account_id=tholi.actor_account_id()) WITH CHECK (account_id=tholi.actor_account_id());

CREATE TABLE tholi.support_requests (
  workspace_id uuid NOT NULL,
  request_id uuid NOT NULL,
  account_id uuid NOT NULL,
  name text CHECK (length(name)<=80 AND name !~ '[[:cntrl:]]'),
  email text CHECK (length(email) BETWEEN 3 AND 254 AND email !~ '[[:cntrl:]]'),
  topic text NOT NULL CHECK (topic IN ('Support','Feedback','Partnerships','Something else')),
  subject text CHECK (length(subject) BETWEEN 1 AND 120 AND subject !~ '[[:cntrl:]]'),
  message text CHECK (length(message) BETWEEN 1 AND 3000),
  operator_job_id uuid NOT NULL,
  receipt_job_id uuid,
  receipt_identity_id uuid,
  receipt_contact_revision bigint,
  expires_at timestamptz NOT NULL,
  purged_at timestamptz,
  PRIMARY KEY(workspace_id,request_id),
  FOREIGN KEY(workspace_id,request_id,account_id) REFERENCES tholi.requests(workspace_id,id,account_id),
  FOREIGN KEY(workspace_id,account_id) REFERENCES tholi.memberships(workspace_id,account_id),
  FOREIGN KEY(account_id,receipt_identity_id) REFERENCES tholi.identity_delivery_contacts(account_id,identity_id),
  FOREIGN KEY(workspace_id,operator_job_id,account_id) REFERENCES tholi.jobs(workspace_id,id,account_id),
  FOREIGN KEY(workspace_id,receipt_job_id,account_id) REFERENCES tholi.jobs(workspace_id,id,account_id),
  CHECK ((receipt_job_id IS NULL)=(receipt_identity_id IS NULL)),
  CHECK ((receipt_job_id IS NULL)=(receipt_contact_revision IS NULL)),
  CHECK ((purged_at IS NULL AND email IS NOT NULL AND subject IS NOT NULL AND message IS NOT NULL)
    OR (purged_at IS NOT NULL AND name IS NULL AND email IS NULL AND subject IS NULL AND message IS NULL))
);
CREATE INDEX support_expiry_idx ON tholi.support_requests(expires_at,workspace_id,request_id) WHERE purged_at IS NULL;
ALTER TABLE tholi.support_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_actor ON tholi.support_requests
  USING (workspace_id=tholi.actor_workspace_id() AND account_id=tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL)
  WITH CHECK (workspace_id=tholi.actor_workspace_id() AND account_id=tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL);

CREATE FUNCTION tholi.valid_diagnostic_snapshot(value jsonb) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
  DECLARE entry record;
  BEGIN
    IF value IS NULL OR jsonb_typeof(value)<>'object' OR octet_length(value::text)>131072
      OR NOT value ?& ARRAY['schemaVersion','version','profile','accountStatus','workspaceKind','role','jobs']
      OR value - ARRAY['schemaVersion','version','profile','accountStatus','workspaceKind','role','jobs']<>'{}'::jsonb
      OR value->'schemaVersion'<>'1'::jsonb OR COALESCE(value->>'profile','')<>'service'
      OR COALESCE(value->>'accountStatus','')<>'active' OR COALESCE(value->>'workspaceKind','')<>'personal' OR COALESCE(value->>'role','')<>'owner'
      OR COALESCE(value->>'version','') !~ '^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$'
      OR jsonb_typeof(value->'jobs')<>'object'
      OR NOT (value->'jobs') ?& ARRAY['queued','running','succeeded','failed','dead','cancelled','uncertain']
      OR (value->'jobs') - ARRAY['queued','running','succeeded','failed','dead','cancelled','uncertain']<>'{}'::jsonb THEN RETURN false; END IF;
    FOR entry IN SELECT item.key,item.value AS count FROM jsonb_each(value->'jobs') AS item LOOP
      IF jsonb_typeof(entry.count)<>'number' OR entry.count::text !~ '^[0-9]+$' OR entry.count::text::numeric>9007199254740991 THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  END $$;

-- The only stored export body is a frozen, strictly typed content-free snapshot.
CREATE TABLE tholi.private_files (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  request_id uuid NOT NULL,
  account_id uuid NOT NULL,
  object_key text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK(content_type='application/json'),
  bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 131072),
  checksum bytea NOT NULL CHECK(octet_length(checksum)=32),
  snapshot jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','deleting','deleted')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz,
  cleanup_generation bigint NOT NULL DEFAULT 0 CHECK(cleanup_generation>=0),
  last_reaped_at timestamptz,
  next_reconcile_at timestamptz,
  PRIMARY KEY(workspace_id,id),
  UNIQUE(workspace_id,request_id),
  FOREIGN KEY(workspace_id,request_id,account_id) REFERENCES tholi.requests(workspace_id,id,account_id),
  FOREIGN KEY(workspace_id,account_id) REFERENCES tholi.memberships(workspace_id,account_id),
  CHECK(object_key='exports/' || workspace_id::text || '/' || id::text || '.json'),
  CHECK ((status='deleted')=(deleted_at IS NOT NULL)),
  CHECK((status='deleted')=(snapshot IS NULL)),
  CHECK(snapshot IS NULL OR tholi.valid_diagnostic_snapshot(snapshot))
);
CREATE INDEX private_file_expiry_idx ON tholi.private_files(expires_at,workspace_id,id) WHERE status<>'deleted';
ALTER TABLE tholi.private_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY file_actor ON tholi.private_files
  USING (workspace_id=tholi.actor_workspace_id() AND account_id=tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL)
  WITH CHECK (workspace_id=tholi.actor_workspace_id() AND account_id=tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL);

-- One logical effect per existing job. No recipient, body, URL or object data.
CREATE TABLE tholi.external_effects (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  command_hash bytea NOT NULL CHECK(octet_length(command_hash)=32),
  PRIMARY KEY(workspace_id,id),
  UNIQUE(workspace_id,job_id),
  FOREIGN KEY(workspace_id,job_id) REFERENCES tholi.jobs(workspace_id,id)
);
CREATE TABLE tholi.external_attempts (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  effect_id uuid NOT NULL,
  claim_token uuid NOT NULL,
  state text NOT NULL CHECK(state IN ('started','committed','retryable','uncertain','failed')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Initial provider calls are capped at 15 s. This conservative 45 s window
  -- includes transport quiescence; it cannot prove an external abort succeeded.
  quiescent_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '45 seconds',
  finished_at timestamptz,
  PRIMARY KEY(workspace_id,id),
  UNIQUE(workspace_id,effect_id,claim_token),
  FOREIGN KEY(workspace_id,effect_id) REFERENCES tholi.external_effects(workspace_id,id),
  CHECK((state='started')=(finished_at IS NULL))
);
ALTER TABLE tholi.external_effects ENABLE ROW LEVEL SECURITY;
CREATE POLICY effect_actor ON tholi.external_effects USING (workspace_id=tholi.actor_workspace_id()
  AND EXISTS(SELECT FROM tholi.jobs j WHERE j.workspace_id=external_effects.workspace_id AND j.id=external_effects.job_id
    AND j.account_id=tholi.actor_account_id())) WITH CHECK(workspace_id=tholi.actor_workspace_id()
  AND EXISTS(SELECT FROM tholi.jobs j WHERE j.workspace_id=external_effects.workspace_id AND j.id=external_effects.job_id
    AND j.account_id=tholi.actor_account_id()));
ALTER TABLE tholi.external_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY attempt_actor ON tholi.external_attempts USING (workspace_id=tholi.actor_workspace_id()
  AND EXISTS(SELECT FROM tholi.external_effects e WHERE e.workspace_id=external_attempts.workspace_id AND e.id=external_attempts.effect_id))
  WITH CHECK(workspace_id=tholi.actor_workspace_id()
  AND EXISTS(SELECT FROM tholi.external_effects e WHERE e.workspace_id=external_attempts.workspace_id AND e.id=external_attempts.effect_id));

-- Retention jobs use the original scope IDs, not an invented system tenant.
CREATE FUNCTION tholi.enqueue_file_expiry(target_workspace uuid,target_file uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
  DECLARE f tholi.private_files; changed integer; generation bigint;
  BEGIN
    PERFORM 1 FROM tholi.workspaces WHERE id=target_workspace FOR UPDATE;
    SELECT * INTO f FROM tholi.private_files WHERE workspace_id=target_workspace AND id=target_file
      AND (expires_at<=clock_timestamp() OR status='deleting')
      AND (status<>'deleted' OR next_reconcile_at<=clock_timestamp()) FOR UPDATE;
    IF f.id IS NULL THEN RETURN false; END IF;
    IF EXISTS(SELECT FROM tholi.jobs j WHERE j.workspace_id=f.workspace_id AND j.request_id=f.request_id
      AND j.kind='file.expire' AND j.status IN ('queued','running')) OR EXISTS(
      SELECT FROM tholi.external_attempts a JOIN tholi.external_effects e ON e.workspace_id=a.workspace_id AND e.id=a.effect_id
      JOIN tholi.jobs j ON j.workspace_id=e.workspace_id AND j.id=e.job_id WHERE j.workspace_id=f.workspace_id
        AND j.request_id=f.request_id AND j.kind='file.diagnostic' AND a.state<>'committed' AND a.quiescent_at>clock_timestamp()) THEN RETURN false; END IF;
    UPDATE tholi.private_files SET cleanup_generation=cleanup_generation+1 WHERE workspace_id=f.workspace_id AND id=f.id
      RETURNING cleanup_generation INTO generation;
    INSERT INTO tholi.jobs(workspace_id,id,account_id,request_id,kind,version,idempotency_key,record_references,replay_safe)
      VALUES(f.workspace_id,gen_random_uuid(),f.account_id,f.request_id,'file.expire',1,'file-expire:'||f.id::text||':'||generation::text,
        jsonb_build_object('requestId',f.request_id),true) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed>0;
  END $$;

CREATE FUNCTION tholi.schedule_file_expiry(batch integer) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
  DECLARE f record; scheduled integer:=0;
  BEGIN
    IF batch IS NULL OR batch NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid cleanup budget.' USING ERRCODE='22023'; END IF;
    UPDATE tholi.support_requests SET name=NULL,email=NULL,subject=NULL,message=NULL,purged_at=clock_timestamp()
      WHERE (workspace_id,request_id) IN (SELECT workspace_id,request_id FROM tholi.support_requests
        WHERE purged_at IS NULL AND expires_at<=clock_timestamp() ORDER BY expires_at,workspace_id,request_id LIMIT batch);
    FOR f IN SELECT workspace_id,id FROM tholi.private_files WHERE (expires_at<=clock_timestamp() OR status='deleting')
      AND (status<>'deleted' OR next_reconcile_at<=clock_timestamp()) ORDER BY expires_at,workspace_id,id LIMIT batch
    LOOP
      IF tholi.enqueue_file_expiry(f.workspace_id,f.id) THEN scheduled:=scheduled+1; END IF;
    END LOOP;
    RETURN scheduled;
  END $$;

-- The only unscoped prepare capability returns due generated-object metadata.
CREATE FUNCTION tholi.prepare_file_cleanup(workspace uuid,job uuid,fence uuid)
  RETURNS TABLE(attempt_id uuid,effect_id uuid,command_hash text,file_id uuid,object_key text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
  DECLARE j tholi.jobs; f tholi.private_files; effect uuid; attempt uuid; digest bytea;
  BEGIN
    PERFORM 1 FROM tholi.workspaces WHERE id=workspace FOR UPDATE;
    SELECT * INTO j FROM tholi.jobs WHERE workspace_id=workspace AND id=job AND claim_token=fence
      AND status='running' AND kind='file.expire' AND version=1 AND lease_expires_at>clock_timestamp() FOR UPDATE;
    IF j.id IS NULL OR j.record_references<>jsonb_build_object('requestId',j.request_id) THEN RETURN; END IF;
    SELECT * INTO f FROM tholi.private_files WHERE workspace_id=workspace AND request_id=j.request_id
      AND account_id=j.account_id AND (expires_at<=clock_timestamp() OR status='deleting') FOR UPDATE;
    IF f.id IS NULL THEN RETURN; END IF;
    IF EXISTS(SELECT FROM tholi.external_attempts a JOIN tholi.external_effects e ON e.workspace_id=a.workspace_id AND e.id=a.effect_id
      JOIN tholi.jobs p ON p.workspace_id=e.workspace_id AND p.id=e.job_id WHERE p.workspace_id=workspace
        AND p.request_id=f.request_id AND p.kind='file.diagnostic' AND a.state<>'committed' AND a.quiescent_at>clock_timestamp()) THEN RETURN; END IF;
    digest:=sha256(convert_to(f.object_key,'UTF8'));
    INSERT INTO tholi.external_effects(workspace_id,id,job_id,command_hash) VALUES(workspace,gen_random_uuid(),job,digest)
      ON CONFLICT(workspace_id,job_id) DO NOTHING;
    SELECT e.id INTO effect FROM tholi.external_effects e WHERE e.workspace_id=workspace AND e.job_id=job AND e.command_hash=digest;
    IF effect IS NULL THEN RAISE EXCEPTION 'The effect has changed.' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT FROM tholi.external_attempts a WHERE a.workspace_id=workspace AND a.effect_id=effect AND a.claim_token=fence) THEN RETURN; END IF;
    attempt:=gen_random_uuid();
    INSERT INTO tholi.external_attempts(workspace_id,id,effect_id,claim_token,state) VALUES(workspace,attempt,effect,fence,'started');
    UPDATE tholi.private_files SET status='deleting',revision=revision+1 WHERE workspace_id=workspace AND id=f.id AND status IN ('pending','ready');
    RETURN QUERY SELECT attempt,effect,encode(digest,'hex'),f.id,f.object_key;
  END $$;

-- Outcome bookkeeping is allowed after revocation. It can only finish an exact
-- started attempt under a live lease, never authorize another external effect.
CREATE FUNCTION tholi.finish_external_effect(workspace uuid,job uuid,fence uuid,attempt uuid,outcome text,error_code text,backoff_ms integer)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
  DECLARE j tholi.jobs; changed integer; visible boolean; f tholi.private_files;
  BEGIN
    IF outcome IS NULL OR outcome NOT IN ('committed','retryable','uncertain','failed')
      OR backoff_ms IS NULL OR backoff_ms NOT BETWEEN 0 AND 60000
      OR (outcome='retryable' AND backoff_ms<1000) THEN
      RAISE EXCEPTION 'Invalid external outcome.' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM tholi.workspaces WHERE id=workspace FOR UPDATE;
    SELECT * INTO j FROM tholi.jobs WHERE workspace_id=workspace AND id=job AND claim_token=fence
      AND status='running' AND version=1 AND kind IN ('support.operator','support.received','file.diagnostic','file.expire')
      AND lease_expires_at>clock_timestamp() FOR UPDATE;
    IF j.id IS NULL THEN
      -- A stale worker may record a factual late PUT outcome, but cannot publish
      -- a file or acknowledge its job. Reaping must not trust the earlier DELETE.
      SELECT p.* INTO j FROM tholi.jobs p JOIN tholi.external_effects e ON e.workspace_id=p.workspace_id AND e.job_id=p.id
        JOIN tholi.external_attempts a ON a.workspace_id=e.workspace_id AND a.effect_id=e.id
        WHERE p.workspace_id=workspace AND p.id=job AND p.kind='file.diagnostic' AND p.version=1
          AND a.id=attempt AND a.claim_token=fence;
      IF j.id IS NULL THEN RETURN false; END IF;
      UPDATE tholi.external_attempts SET state=CASE WHEN outcome='committed' THEN 'committed' ELSE 'uncertain' END,
        finished_at=clock_timestamp() WHERE workspace_id=workspace AND id=attempt AND state<>'committed'
          AND (outcome='committed' OR state<>'uncertain');
      GET DIAGNOSTICS changed=ROW_COUNT; IF changed=0 THEN RETURN false; END IF;
      UPDATE tholi.private_files SET status=CASE WHEN status='deleted' THEN status ELSE 'deleting' END,
        next_reconcile_at=clock_timestamp(),revision=revision+1 WHERE workspace_id=workspace AND request_id=j.request_id
        AND account_id=j.account_id AND (expires_at<=clock_timestamp() OR status IN ('deleting','deleted') OR NOT EXISTS(
          SELECT FROM tholi.accounts a JOIN tholi.memberships m ON m.account_id=a.id AND m.workspace_id=workspace
          WHERE a.id=j.account_id AND a.status='active' AND m.status='active')) RETURNING * INTO f;
      IF f.id IS NOT NULL THEN PERFORM tholi.enqueue_file_expiry(workspace,f.id); END IF;
      RETURN false;
    END IF;
    UPDATE tholi.external_attempts a SET state=outcome,finished_at=clock_timestamp()
      FROM tholi.external_effects e WHERE a.workspace_id=workspace AND a.id=attempt AND a.claim_token=fence AND a.state='started'
        AND e.workspace_id=a.workspace_id AND e.id=a.effect_id AND e.job_id=job;
    GET DIAGNOSTICS changed=ROW_COUNT; IF changed=0 THEN RETURN false; END IF;
    IF outcome<>'committed' THEN
      RETURN tholi.fail_job(workspace,job,fence,CASE WHEN outcome='retryable' THEN 'retryable' WHEN outcome='uncertain' THEN 'uncertain' ELSE 'failed' END,
        COALESCE(error_code,'UNAVAILABLE'),backoff_ms);
    END IF;
    IF j.kind IN ('file.diagnostic','file.expire') THEN
      SELECT * INTO f FROM tholi.private_files WHERE workspace_id=workspace AND request_id=j.request_id AND account_id=j.account_id FOR UPDATE;
      IF f.id IS NULL THEN RAISE EXCEPTION 'The file is unavailable.' USING ERRCODE='23514'; END IF;
      IF j.kind='file.expire' THEN
        UPDATE tholi.private_files SET status='deleted',snapshot=NULL,deleted_at=clock_timestamp(),last_reaped_at=clock_timestamp(),
          next_reconcile_at=CASE WHEN EXISTS(SELECT FROM tholi.external_attempts a
            JOIN tholi.external_effects e ON e.workspace_id=a.workspace_id AND e.id=a.effect_id
            JOIN tholi.jobs p ON p.workspace_id=e.workspace_id AND p.id=e.job_id WHERE p.workspace_id=workspace
              AND p.request_id=f.request_id AND p.kind='file.diagnostic' AND a.state<>'committed')
            THEN clock_timestamp()+interval '1 hour' ELSE NULL END,
          revision=revision+1 WHERE workspace_id=workspace AND id=f.id;
      ELSE
        SELECT EXISTS(SELECT FROM tholi.accounts a JOIN tholi.memberships m ON m.account_id=a.id AND m.workspace_id=workspace
          WHERE a.id=j.account_id AND a.status='active' AND m.status='active') AND f.expires_at>clock_timestamp()
          AND j.cancel_requested_at IS NULL AND f.status IN ('pending','ready') INTO visible;
        UPDATE tholi.private_files SET status=CASE WHEN status='deleted' THEN status WHEN visible THEN 'ready' ELSE 'deleting' END,
          next_reconcile_at=CASE WHEN visible THEN next_reconcile_at ELSE clock_timestamp() END,revision=revision+1
          WHERE workspace_id=workspace AND id=f.id;
        IF NOT visible THEN PERFORM tholi.enqueue_file_expiry(workspace,f.id); END IF;
      END IF;
    END IF;
    UPDATE tholi.jobs SET status='succeeded',result_count=1,last_error_code=NULL,claim_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
      revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=workspace AND id=job;
    INSERT INTO tholi.outbox(workspace_id,id,job_id,event_kind,idempotency_key,status,published_at)
      VALUES(workspace,gen_random_uuid(),job,'job.completed','job:'||job::text||':completed','published',clock_timestamp()) ON CONFLICT DO NOTHING;
    RETURN true;
  END $$;

-- Retention is mandatory, including when the initiating actor later leaves.
CREATE FUNCTION tholi.guard_retention_job_cancel() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
  BEGIN
    IF OLD.kind='file.expire' AND (NEW.cancel_requested_at IS DISTINCT FROM OLD.cancel_requested_at OR NEW.status='cancelled') THEN
      RAISE EXCEPTION 'Retention work cannot be cancelled.' USING ERRCODE='42501'; END IF;
    IF OLD.status='dead' AND NEW.status='queued' AND OLD.kind IN ('support.operator','support.received')
      AND EXISTS(SELECT FROM tholi.external_effects e JOIN tholi.external_attempts a ON a.workspace_id=e.workspace_id AND a.effect_id=e.id
        WHERE e.workspace_id=OLD.workspace_id AND e.job_id=OLD.id AND a.state IN ('started','uncertain','committed')) THEN
      RAISE EXCEPTION 'The external outcome requires review.' USING ERRCODE='42501'; END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER retention_job_cancel BEFORE UPDATE ON tholi.jobs FOR EACH ROW EXECUTE FUNCTION tholi.guard_retention_job_cancel();

REVOKE ALL ON FUNCTION tholi.enqueue_file_expiry(uuid,uuid),tholi.schedule_file_expiry(integer),
  tholi.prepare_file_cleanup(uuid,uuid,uuid),tholi.finish_external_effect(uuid,uuid,uuid,uuid,text,text,integer),
  tholi.guard_retention_job_cancel(),tholi.valid_diagnostic_snapshot(jsonb) FROM PUBLIC;
`;
