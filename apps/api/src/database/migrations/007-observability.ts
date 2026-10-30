export const portableObservability = `
-- Audit metadata is a separate immutable security record, not an OTLP payload,
-- delivery receipt, financial ledger or general-purpose JSON event store.
CREATE TABLE tholi.security_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES tholi.accounts(id),
  workspace_id uuid REFERENCES tholi.workspaces(id),
  subject_id uuid,
  kind text NOT NULL CHECK (kind IN ('membership.changed','consent.changed','session.created',
    'session.rotated','session.revoked','session.refresh_replay','sessions.revoked_all','sessions.provider_revoked')),
  details jsonb NOT NULL CHECK (jsonb_typeof(details)='object'),
  request_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '90 days',
  CHECK (expires_at>occurred_at AND expires_at<=occurred_at+interval '90 days 1 second'),
  CHECK (COALESCE(CASE kind
    WHEN 'membership.changed' THEN subject_id IS NOT NULL
      AND details ?& ARRAY['role','status','revision'] AND details-ARRAY['role','status','revision']='{}'::jsonb
      AND jsonb_typeof(details->'role')='string' AND jsonb_typeof(details->'status')='string' AND jsonb_typeof(details->'revision')='string'
      AND details->>'role' IN ('admin','member') AND details->>'status' IN ('active','revoked')
      AND details->>'revision' ~ '^[1-9][0-9]{0,18}$'
    WHEN 'consent.changed' THEN subject_id IS NOT NULL
      AND details ?& ARRAY['purpose','policyVersion','granted','revision']
      AND details-ARRAY['purpose','policyVersion','granted','revision']='{}'::jsonb
      AND jsonb_typeof(details->'purpose')='string' AND jsonb_typeof(details->'policyVersion')='string' AND jsonb_typeof(details->'revision')='string'
      AND details->>'purpose' ~ '^[a-z][a-z0-9_-]{0,99}$'
      AND details->>'policyVersion' ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
      AND jsonb_typeof(details->'granted')='boolean' AND details->>'revision' ~ '^[1-9][0-9]{0,18}$'
    WHEN 'sessions.revoked_all' THEN subject_id IS NULL AND details='{}'::jsonb
    WHEN 'sessions.provider_revoked' THEN subject_id IS NULL AND details='{}'::jsonb
    ELSE subject_id IS NOT NULL AND details='{}'::jsonb END,false))
);
CREATE INDEX security_audit_account_idx ON tholi.security_audit(account_id,occurred_at,id);
CREATE INDEX security_audit_workspace_idx ON tholi.security_audit(workspace_id,occurred_at,id);
CREATE INDEX security_audit_expiry_idx ON tholi.security_audit(expires_at,id);
ALTER TABLE tholi.security_audit ENABLE ROW LEVEL SECURITY;
-- This check does not require active membership: revocation itself must remain
-- auditable. Identity establishes only the subject's account in its existing tx.
CREATE POLICY audit_append ON tholi.security_audit FOR INSERT WITH CHECK (
  account_id=tholi.actor_account_id() AND (workspace_id IS NULL OR workspace_id=tholi.actor_workspace_id()));

CREATE FUNCTION tholi.valid_product_event(event jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path=pg_catalog AS $$ SELECT COALESCE(jsonb_typeof(event)='object' AND CASE event->>'name'
    WHEN 'page_view' THEN event ?& ARRAY['name','page'] AND event-ARRAY['name','page']='{}'::jsonb
      AND event->>'page' IN ('home','about','download','support','contact','onboarding','docs','privacy','terms','cookies','account')
    WHEN 'store_listing_opened' THEN event ?& ARRAY['name','browser'] AND event-ARRAY['name','browser']='{}'::jsonb
      AND event->>'browser' IN ('chromium','firefox')
    WHEN 'practice_start' THEN event ?& ARRAY['name','practice'] AND event-ARRAY['name','practice']='{}'::jsonb
      AND event->>'practice' IN ('account-settings','language-preference')
    WHEN 'practice_complete' THEN event ?& ARRAY['name','practice'] AND event-ARRAY['name','practice']='{}'::jsonb
      AND event->>'practice' IN ('account-settings','language-preference')
    WHEN 'download_click' THEN event='{"name":"download_click"}'::jsonb
    WHEN 'onboarding_complete' THEN event='{"name":"onboarding_complete"}'::jsonb
    ELSE false END,false) $$;
CREATE TABLE tholi.product_events (
  workspace_id uuid NOT NULL,
  account_id uuid NOT NULL,
  event_id uuid NOT NULL,
  schema_version integer NOT NULL CHECK(schema_version=1),
  event jsonb NOT NULL CHECK(tholi.valid_product_event(event)),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 days',
  PRIMARY KEY(workspace_id,account_id,event_id),
  FOREIGN KEY(workspace_id,account_id) REFERENCES tholi.memberships(workspace_id,account_id),
  CHECK(expires_at>recorded_at AND expires_at<=recorded_at+interval '30 days 1 second')
);
CREATE INDEX product_events_expiry_idx ON tholi.product_events(expires_at,workspace_id,account_id,event_id);
CREATE INDEX product_events_daily_idx ON tholi.product_events(workspace_id,account_id,recorded_at);
ALTER TABLE tholi.product_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_read ON tholi.product_events FOR SELECT USING (
  workspace_id=tholi.actor_workspace_id() AND account_id=tholi.actor_account_id()
  AND tholi.current_member_role(workspace_id) IS NOT NULL);
CREATE POLICY product_append ON tholi.product_events FOR INSERT WITH CHECK (
  workspace_id=tholi.actor_workspace_id() AND account_id=tholi.actor_account_id()
  AND tholi.current_member_role(workspace_id) IS NOT NULL AND EXISTS (
    SELECT FROM tholi.consents c WHERE c.workspace_id=product_events.workspace_id
      AND c.account_id=product_events.account_id AND c.purpose='product_analytics' AND c.policy_version='1' AND c.granted));
CREATE POLICY product_delete ON tholi.product_events FOR DELETE USING (
  workspace_id=tholi.actor_workspace_id() AND account_id=tholi.actor_account_id()
  AND tholi.current_member_role(workspace_id) IS NOT NULL);
CREATE FUNCTION tholi.purge_product_on_withdrawal() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
  BEGIN IF NEW.purpose='product_analytics' AND NOT NEW.granted THEN
    DELETE FROM tholi.product_events WHERE workspace_id=NEW.workspace_id AND account_id=NEW.account_id;
  END IF; RETURN NEW; END $$;
CREATE TRIGGER product_consent_withdrawal AFTER INSERT OR UPDATE ON tholi.consents
  FOR EACH ROW EXECUTE FUNCTION tholi.purge_product_on_withdrawal();

CREATE FUNCTION tholi.valid_job_correlation(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path=pg_catalog AS $$ SELECT value IS NULL OR COALESCE(jsonb_typeof(value)='object'
    AND value ?& ARRAY['requestId','traceId','spanId'] AND value-ARRAY['requestId','traceId','spanId','jobId']='{}'::jsonb
    AND jsonb_typeof(value->'requestId')='string' AND jsonb_typeof(value->'traceId')='string' AND jsonb_typeof(value->'spanId')='string'
    AND value->>'requestId' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    AND value->>'traceId' ~ '^[a-f0-9]{32}$' AND value->>'traceId'<>'00000000000000000000000000000000'
    AND value->>'spanId' ~ '^[a-f0-9]{16}$' AND value->>'spanId'<>'0000000000000000'
    AND (NOT value ? 'jobId' OR (jsonb_typeof(value->'jobId')='string' AND value->>'jobId' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$')),false) $$;
ALTER TABLE tholi.jobs ADD COLUMN origin_correlation jsonb CHECK(tholi.valid_job_correlation(origin_correlation));
CREATE FUNCTION tholi.guard_job_correlation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
  BEGIN IF NEW.origin_correlation IS DISTINCT FROM OLD.origin_correlation THEN
    RAISE EXCEPTION 'Job origin is immutable.' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER job_correlation_immutable BEFORE UPDATE OF origin_correlation ON tholi.jobs
  FOR EACH ROW EXECUTE FUNCTION tholi.guard_job_correlation();

-- Only this bounded expiry capability bypasses actor RLS; it cannot choose an
-- account, a cutoff, change records or remove unexpired audit/product metadata.
CREATE FUNCTION tholi.prune_observability(batch integer) RETURNS TABLE(audit_deleted integer,product_deleted integer)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
  DECLARE audit_count integer; product_count integer;
  BEGIN
    IF batch IS NULL OR batch NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid retention budget.' USING ERRCODE='22023'; END IF;
    WITH due AS (SELECT id FROM tholi.security_audit WHERE expires_at<=clock_timestamp()
      ORDER BY expires_at,id LIMIT batch FOR UPDATE SKIP LOCKED)
      DELETE FROM tholi.security_audit a USING due WHERE a.id=due.id;
    GET DIAGNOSTICS audit_count=ROW_COUNT;
    WITH due AS (SELECT workspace_id,account_id,event_id FROM tholi.product_events WHERE expires_at<=clock_timestamp()
      ORDER BY expires_at,workspace_id,account_id,event_id LIMIT batch FOR UPDATE SKIP LOCKED)
      DELETE FROM tholi.product_events e USING due WHERE (e.workspace_id,e.account_id,e.event_id)=(due.workspace_id,due.account_id,due.event_id);
    GET DIAGNOSTICS product_count=ROW_COUNT;
    RETURN QUERY SELECT audit_count,product_count;
  END $$;
CREATE FUNCTION tholi.job_health() RETURNS TABLE(kind text,status text,count bigint,oldest_age_ms double precision)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT j.kind,j.status,count(*),GREATEST(0,EXTRACT(epoch FROM now()-min(j.available_at))*1000)::double precision
    FROM tholi.jobs j WHERE j.kind IN ('identity.prune-expired-brokers','support.operator','support.received','file.diagnostic','file.expire')
    GROUP BY j.kind,j.status ORDER BY j.kind,j.status LIMIT 100 $$;
REVOKE ALL ON FUNCTION tholi.prune_observability(integer),tholi.job_health(),tholi.valid_product_event(jsonb),
  tholi.valid_job_correlation(jsonb),tholi.guard_job_correlation(),tholi.purge_product_on_withdrawal() FROM PUBLIC;
`;
