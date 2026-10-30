export const durableJobs = `
-- No previous milestone executed these rows. Preserve any manually marked run
-- as uncertain rather than inventing a valid lease or replaying it.
UPDATE tholi.jobs SET status='uncertain',lease_owner=NULL,lease_expires_at=NULL WHERE status='running';
ALTER TABLE tholi.jobs
  ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN claim_token uuid,
  ADD COLUMN replay_safe boolean NOT NULL DEFAULT false,
  ADD COLUMN cancel_requested_at timestamptz,
  ADD COLUMN last_error_code text CHECK (last_error_code IN ('HANDLER_FAILED','LEASE_EXPIRED','CANCELLED',
    'AUTHORIZATION_REVOKED','UNSUPPORTED_JOB','RETRY_EXHAUSTED','SHUTDOWN','UNAVAILABLE')),
  ADD COLUMN result_count integer CHECK (result_count BETWEEN 0 AND 100),
  ADD CONSTRAINT jobs_attempt_budget CHECK (max_attempts <= 100),
  ADD CONSTRAINT jobs_claim_fence CHECK ((status = 'running') = (claim_token IS NOT NULL)),
  ADD CONSTRAINT jobs_reference_ids CHECK (
    record_references - ARRAY['accountId','artifactId','requestId'] = '{}'::jsonb
    AND (NOT record_references ? 'accountId' OR (jsonb_typeof(record_references->'accountId') = 'string'
      AND record_references->>'accountId' ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
      AND record_references->>'accountId' = account_id::text))
    AND (NOT record_references ? 'artifactId' OR (jsonb_typeof(record_references->'artifactId') = 'string'
      AND record_references->>'artifactId' ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'))
    AND (NOT record_references ? 'requestId' OR (jsonb_typeof(record_references->'requestId') = 'string'
      AND record_references->>'requestId' ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
      AND (request_id IS NULL OR record_references->>'requestId' = request_id::text)))
  );

-- Private metadata dispatcher. It never installs actor scope or reads content.
-- Only matching immutable kind/version/replay policies can recover or claim work.
CREATE FUNCTION tholi.claim_jobs(worker text, batch integer, lease_ms integer, kinds jsonb)
  RETURNS SETOF tholi.jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
  DECLARE selected record; recovered integer := 0;
  BEGIN
    IF worker IS NULL OR batch IS NULL OR lease_ms IS NULL OR kinds IS NULL
      OR length(worker) NOT BETWEEN 1 AND 100 OR batch NOT BETWEEN 1 AND 10
      OR lease_ms NOT BETWEEN 1000 AND 120000 OR jsonb_typeof(kinds) <> 'array'
      OR jsonb_array_length(kinds) NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'Invalid worker budget.' USING ERRCODE = '22023';
    END IF;
    -- Recover a bounded batch, never every expired job in one transaction.
    FOR selected IN SELECT j.workspace_id,j.id,j.replay_safe,j.attempts,j.max_attempts,j.cancel_requested_at
      FROM tholi.jobs j WHERE j.status='running' AND j.lease_expires_at <= clock_timestamp()
        AND EXISTS (SELECT FROM jsonb_array_elements(kinds) k WHERE k->>'kind'=j.kind
          AND (k->>'version')::integer=j.version AND (k->>'replaySafe')::boolean=j.replay_safe)
      ORDER BY j.lease_expires_at,j.workspace_id,j.id LIMIT batch FOR UPDATE OF j SKIP LOCKED
    LOOP
      UPDATE tholi.jobs SET
        status=CASE WHEN NOT selected.replay_safe THEN 'uncertain'
          WHEN selected.cancel_requested_at IS NOT NULL THEN 'cancelled'
          WHEN selected.attempts >= selected.max_attempts THEN 'dead' ELSE 'queued' END,
        available_at=clock_timestamp() + LEAST(60000,1000 * power(2,LEAST(selected.attempts-1,6))) * interval '1 millisecond',
        last_error_code=CASE WHEN selected.cancel_requested_at IS NOT NULL AND selected.replay_safe THEN 'CANCELLED'
          WHEN selected.replay_safe AND selected.attempts >= selected.max_attempts THEN 'RETRY_EXHAUSTED' ELSE 'LEASE_EXPIRED' END,
        claim_token=NULL,lease_owner=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=clock_timestamp()
      WHERE workspace_id=selected.workspace_id AND id=selected.id;
      recovered := recovered+1;
    END LOOP;
    RETURN QUERY WITH candidates AS (
      SELECT j.workspace_id,j.id FROM tholi.jobs j
      WHERE j.status='queued' AND j.available_at <= clock_timestamp() AND j.attempts < j.max_attempts
        AND j.cancel_requested_at IS NULL
        AND EXISTS (SELECT FROM jsonb_array_elements(kinds) k WHERE k->>'kind'=j.kind
          AND (k->>'version')::integer=j.version AND (k->>'replaySafe')::boolean=j.replay_safe)
      ORDER BY j.available_at,j.workspace_id,j.id LIMIT batch FOR UPDATE OF j SKIP LOCKED
    ) UPDATE tholi.jobs j SET status='running',attempts=j.attempts+1,
      claim_token=gen_random_uuid(),lease_owner=worker,
      lease_expires_at=clock_timestamp()+lease_ms*interval '1 millisecond',
      revision=j.revision+1,updated_at=clock_timestamp()
      FROM candidates c WHERE j.workspace_id=c.workspace_id AND j.id=c.id RETURNING j.*;
  END $$;

CREATE FUNCTION tholi.heartbeat_job(workspace uuid, job uuid, fence uuid, lease_ms integer)
  RETURNS TABLE (alive boolean, cancel_requested boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
  DECLARE row tholi.jobs;
  BEGIN
    IF lease_ms IS NULL OR lease_ms NOT BETWEEN 1000 AND 120000 THEN RAISE EXCEPTION 'Invalid lease budget.' USING ERRCODE='22023'; END IF;
    UPDATE tholi.jobs SET lease_expires_at=clock_timestamp()+lease_ms*interval '1 millisecond'
      WHERE workspace_id=workspace AND id=job AND claim_token=fence AND status='running'
        AND lease_expires_at > clock_timestamp() RETURNING * INTO row;
    RETURN QUERY SELECT row.id IS NOT NULL, row.cancel_requested_at IS NOT NULL;
  END $$;

CREATE FUNCTION tholi.fail_job(workspace uuid, job uuid, fence uuid, classification text, error_code text, backoff_ms integer)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
  DECLARE row tholi.jobs;
  BEGIN
    IF classification IS NULL OR error_code IS NULL OR backoff_ms IS NULL
      OR classification NOT IN ('retryable','failed','uncertain') OR backoff_ms NOT BETWEEN 0 AND 60000
      OR (classification='retryable' AND backoff_ms<1000)
      OR error_code NOT IN ('HANDLER_FAILED','LEASE_EXPIRED','CANCELLED','AUTHORIZATION_REVOKED',
        'UNSUPPORTED_JOB','RETRY_EXHAUSTED','SHUTDOWN','UNAVAILABLE') THEN
      RAISE EXCEPTION 'Invalid job failure.' USING ERRCODE='22023';
    END IF;
    SELECT * INTO row FROM tholi.jobs WHERE workspace_id=workspace AND id=job AND claim_token=fence
      AND status='running' AND lease_expires_at > clock_timestamp() FOR UPDATE;
    IF row.id IS NULL THEN RETURN false; END IF;
    UPDATE tholi.jobs SET status=CASE WHEN classification='uncertain' OR (classification='retryable' AND NOT row.replay_safe) THEN 'uncertain'
        WHEN row.cancel_requested_at IS NOT NULL THEN 'cancelled'
        WHEN classification='failed' THEN 'failed'
        WHEN row.attempts >= row.max_attempts THEN 'dead' ELSE 'queued' END,
      available_at=clock_timestamp()+backoff_ms*interval '1 millisecond',
      last_error_code=CASE WHEN classification <> 'uncertain' AND row.cancel_requested_at IS NOT NULL THEN 'CANCELLED'
        WHEN classification='retryable' AND row.attempts >= row.max_attempts THEN 'RETRY_EXHAUSTED' ELSE error_code END,
      claim_token=NULL,lease_owner=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=clock_timestamp()
      WHERE workspace_id=workspace AND id=job;
    RETURN true;
  END $$;

-- Operator recovery is explicit and preserves logical idempotency and attempts.
-- An uncertain outcome has no generic redelivery operation.
CREATE FUNCTION tholi.retry_dead_job(workspace uuid, job uuid, expected_revision bigint, job_kind text, job_version integer)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
  BEGIN
    UPDATE tholi.jobs SET status='queued',max_attempts=max_attempts+1,
      available_at=clock_timestamp(),last_error_code=NULL,cancel_requested_at=NULL,
      revision=revision+1,updated_at=clock_timestamp()
      WHERE workspace_id=workspace AND id=job AND revision=expected_revision AND status='dead'
        AND replay_safe AND kind=job_kind AND version=job_version AND max_attempts < 100;
    RETURN FOUND;
  END $$;

CREATE FUNCTION tholi.broker_prune_candidates(batch integer, interval_ms integer)
  RETURNS TABLE (account_id uuid,workspace_id uuid,slot timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
  BEGIN
    IF batch IS NULL OR interval_ms IS NULL OR batch NOT BETWEEN 1 AND 100 OR interval_ms NOT BETWEEN 1000 AND 86400000 THEN
      RAISE EXCEPTION 'Invalid scheduler budget.' USING ERRCODE='22023'; END IF;
    RETURN QUERY SELECT DISTINCT b.account_id,b.workspace_id,
      to_timestamp(floor(extract(epoch FROM statement_timestamp())*1000/interval_ms)*interval_ms/1000)
      FROM tholi.identity_brokers b JOIN tholi.memberships m ON m.workspace_id=b.workspace_id AND m.account_id=b.account_id
      JOIN tholi.workspaces w ON w.id=b.workspace_id AND w.kind='personal' AND w.owner_account_id=b.account_id
      JOIN tholi.accounts a ON a.id=b.account_id WHERE b.expires_at <= clock_timestamp()
        AND m.status='active' AND a.status='active'
      ORDER BY b.account_id,b.workspace_id LIMIT batch;
  END $$;

-- Same expiry owner as identity's bounded on-write cleanup, but this entrypoint
-- admits only a currently authorized actor/workspace, never global auth reads.
CREATE FUNCTION tholi.prune_expired_brokers(batch integer) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
  DECLARE removed integer;
  BEGIN
    IF batch IS NULL OR batch NOT BETWEEN 1 AND 100 OR tholi.actor_workspace_id() IS NULL
      OR tholi.current_member_role(tholi.actor_workspace_id()) IS NULL
      OR NOT EXISTS (SELECT FROM tholi.workspaces WHERE id=tholi.actor_workspace_id()
        AND kind='personal' AND owner_account_id=tholi.actor_account_id()) THEN
      RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE='42501'; END IF;
    DELETE FROM tholi.identity_brokers WHERE ctid IN (SELECT ctid FROM tholi.identity_brokers
      WHERE account_id=tholi.actor_account_id() AND workspace_id=tholi.actor_workspace_id()
        AND expires_at <= clock_timestamp() ORDER BY expires_at LIMIT batch);
    GET DIAGNOSTICS removed=ROW_COUNT;
    RETURN removed;
  END $$;

REVOKE ALL ON FUNCTION tholi.claim_jobs(text,integer,integer,jsonb),tholi.heartbeat_job(uuid,uuid,uuid,integer),
  tholi.fail_job(uuid,uuid,uuid,text,text,integer),tholi.retry_dead_job(uuid,uuid,bigint,text,integer),
  tholi.broker_prune_candidates(integer,integer),tholi.prune_expired_brokers(integer) FROM PUBLIC;
`;
