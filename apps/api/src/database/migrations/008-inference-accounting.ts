export const inferenceAccounting = `
-- New accounting events record their actual statement time after lock waits.
-- Historical timestamps remain untouched and are reviewed during backfill.
ALTER TABLE tholi.credit_grants ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE tholi.credit_reservations ALTER COLUMN created_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN updated_at SET DEFAULT clock_timestamp();
ALTER TABLE tholi.credit_settlements ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE tholi.usage_records ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE tholi.credit_grants
  ADD COLUMN source text NOT NULL DEFAULT 'development' CHECK (length(source) BETWEEN 1 AND 100),
  ADD COLUMN period_start timestamptz,
  ADD COLUMN period_end timestamptz,
  ADD COLUMN policy_version text CHECK (length(policy_version) BETWEEN 1 AND 100),
  ADD CHECK ((period_start IS NULL AND period_end IS NULL) OR
    (period_start IS NOT NULL AND period_end IS NOT NULL AND period_end > period_start)),
  ADD CHECK(source NOT IN('free','subscription') OR
    (period_start IS NOT NULL AND period_end IS NOT NULL AND policy_version IS NOT NULL));
CREATE UNIQUE INDEX credit_grants_recurring_period_idx
  ON tholi.credit_grants(workspace_id,source,period_start,period_end)
  WHERE source IN('free','subscription') AND period_start IS NOT NULL AND period_end IS NOT NULL
    AND policy_version IS NOT NULL;

CREATE TABLE tholi.credit_allocations (
  workspace_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  amount bigint NOT NULL CHECK (amount > 0),
  PRIMARY KEY (workspace_id,reservation_id,grant_id),
  UNIQUE (workspace_id,reservation_id,position),
  FOREIGN KEY (workspace_id,reservation_id) REFERENCES tholi.credit_reservations(workspace_id,id),
  FOREIGN KEY (workspace_id,grant_id) REFERENCES tholi.credit_grants(workspace_id,id)
);
CREATE INDEX credit_allocations_grant_idx ON tholi.credit_allocations(workspace_id,grant_id);
CREATE TABLE tholi.credit_refunds (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  settlement_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  amount bigint NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,idempotency_key),
  FOREIGN KEY (workspace_id,settlement_id) REFERENCES tholi.credit_settlements(workspace_id,id)
);
CREATE INDEX credit_refunds_settlement_idx ON tholi.credit_refunds(workspace_id,settlement_id);

-- Allocation is provenance, not another balance. A partial settlement consumes
-- the earliest-expiring allocated lots; refunds restore the same original lots.
CREATE VIEW tholi.credit_allocation_state WITH (security_invoker=true) AS
SELECT a.workspace_id,a.reservation_id,a.grant_id,a.position,a.amount,
  CASE WHEN r.status IN ('active','uncertain') THEN a.amount ELSE 0 END AS held,
  GREATEST(0,LEAST(a.amount,
    COALESCE(s.amount,0)-COALESCE(f.amount,0)-COALESCE(sum(a.amount) OVER
      (PARTITION BY a.workspace_id,a.reservation_id ORDER BY a.position
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)))::bigint AS consumed
FROM tholi.credit_allocations a JOIN tholi.credit_reservations r
  ON r.workspace_id=a.workspace_id AND r.id=a.reservation_id
LEFT JOIN tholi.credit_settlements s ON s.workspace_id=r.workspace_id AND s.reservation_id=r.id
LEFT JOIN (SELECT workspace_id,settlement_id,sum(amount) AS amount FROM tholi.credit_refunds
  GROUP BY workspace_id,settlement_id) f ON f.workspace_id=s.workspace_id AND f.settlement_id=s.id;

CREATE FUNCTION tholi.allocate_credit_lots_internal(target_workspace uuid,target_reservation uuid,historical boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE held tholi.credit_reservations%ROWTYPE; lot record; remaining bigint; taken bigint; ordinal integer:=0;
  observed_at timestamptz;
BEGIN
  SELECT * INTO STRICT held FROM tholi.credit_reservations
    WHERE workspace_id=target_workspace AND id=target_reservation;
  IF EXISTS(SELECT FROM tholi.credit_allocations WHERE workspace_id=target_workspace
      AND reservation_id=target_reservation) THEN RETURN; END IF;
  observed_at:=CASE WHEN historical THEN held.created_at ELSE clock_timestamp() END;
  IF historical AND EXISTS(SELECT FROM tholi.credit_reservations r
    LEFT JOIN tholi.credit_settlements s ON s.workspace_id=r.workspace_id AND s.reservation_id=r.id
    WHERE r.workspace_id=target_workspace AND r.id<>target_reservation AND r.created_at<=observed_at
      AND (r.created_at=observed_at OR s.created_at=observed_at OR (r.status='released' AND r.updated_at=observed_at))) THEN
    RAISE EXCEPTION 'Legacy credit chronology is ambiguous; review original lots before migrating.' USING ERRCODE='P4403';
  END IF;
  remaining:=held.amount;
  FOR lot IN WITH evidence AS (
    SELECT a.grant_id,a.amount,r.status,r.updated_at,s.amount AS settled,s.created_at AS settled_at,
      COALESCE((SELECT sum(f.amount) FROM tholi.credit_refunds f WHERE f.workspace_id=s.workspace_id
        AND f.settlement_id=s.id AND (NOT historical OR f.created_at<observed_at)),0) AS refunded,
      COALESCE(sum(a.amount) OVER(PARTITION BY a.workspace_id,a.reservation_id ORDER BY a.position
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS earlier
    FROM tholi.credit_allocations a JOIN tholi.credit_reservations r
      ON r.workspace_id=a.workspace_id AND r.id=a.reservation_id
    LEFT JOIN tholi.credit_settlements s ON s.workspace_id=r.workspace_id AND s.reservation_id=r.id
    WHERE a.workspace_id=target_workspace AND r.created_at<=observed_at
  ), occupancy AS (
    SELECT grant_id,CASE WHEN status IN('active','uncertain') OR
      (historical AND ((status='released' AND updated_at>=observed_at) OR (status='settled' AND settled_at>=observed_at)))
      THEN amount WHEN status='settled' THEN GREATEST(0,LEAST(amount,settled-refunded-earlier)) ELSE 0 END AS amount
    FROM evidence
  ) SELECT g.id,GREATEST(0,g.amount-COALESCE(sum(a.amount),0))::bigint AS available
    FROM tholi.credit_grants g LEFT JOIN occupancy a ON a.grant_id=g.id
    WHERE g.workspace_id=target_workspace AND g.created_at<=observed_at
      AND (g.expires_at IS NULL OR g.expires_at>observed_at)
    GROUP BY g.id,g.amount,g.expires_at,g.created_at
    ORDER BY g.expires_at NULLS LAST,g.created_at,g.id
  LOOP
    taken:=LEAST(remaining,lot.available);
    IF taken>0 THEN
      ordinal:=ordinal+1;
      INSERT INTO tholi.credit_allocations(workspace_id,reservation_id,grant_id,position,amount)
        VALUES(target_workspace,target_reservation,lot.id,ordinal,taken);
      remaining:=remaining-taken;
    END IF;
    EXIT WHEN remaining=0;
  END LOOP;
  IF remaining<>0 THEN
    RAISE EXCEPTION 'Existing credit provenance cannot be allocated safely.' USING ERRCODE='P4402';
  END IF;
END $$;

-- Preserve historical grant identity. Never assign an old charge to a grant
-- created later, mint replacement funds or silently discard uncertain holds.
DO $$ DECLARE held record; BEGIN
  FOR held IN SELECT workspace_id,id FROM tholi.credit_reservations
      ORDER BY created_at,workspace_id,id LOOP
    PERFORM tholi.allocate_credit_lots_internal(held.workspace_id,held.id,true);
  END LOOP;
END $$;

CREATE FUNCTION tholi.allocate_credit_lots(target_workspace uuid,target_reservation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF target_workspace IS DISTINCT FROM tholi.actor_workspace_id()
    OR tholi.current_member_role(target_workspace) IS NULL
    OR NOT EXISTS(SELECT FROM tholi.credit_reservations r JOIN tholi.requests q
      ON q.workspace_id=r.workspace_id AND q.id=r.request_id
      WHERE r.workspace_id=target_workspace AND r.id=target_reservation
        AND q.account_id=tholi.actor_account_id()) THEN
    RAISE EXCEPTION 'The credit reservation is unavailable.' USING ERRCODE='42501';
  END IF;
  PERFORM tholi.allocate_credit_lots_internal(target_workspace,target_reservation);
END $$;

DROP FUNCTION tholi.workspace_credit_totals(uuid);
CREATE FUNCTION tholi.workspace_credit_totals(target_workspace uuid)
RETURNS TABLE(granted text,spent text,reserved text,expired text,refunded text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE observed_at timestamptz:=clock_timestamp();
BEGIN
  IF target_workspace IS DISTINCT FROM tholi.actor_workspace_id()
    OR tholi.current_member_role(target_workspace) IS NULL THEN
    RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT
    (SELECT COALESCE(sum(g.amount),0)::text FROM tholi.credit_grants g WHERE g.workspace_id=target_workspace),
    (SELECT COALESCE(sum(s.amount),0)::text FROM tholi.credit_settlements s WHERE s.workspace_id=target_workspace),
    (SELECT COALESCE(sum(r.amount),0)::text FROM tholi.credit_reservations r
      WHERE r.workspace_id=target_workspace AND r.status IN ('active','uncertain')),
    (SELECT COALESCE(sum(l.remaining),0)::text FROM
      (SELECT GREATEST(0,g.amount-COALESCE(sum(a.held+a.consumed),0)) AS remaining
       FROM tholi.credit_grants g LEFT JOIN tholi.credit_allocation_state a
         ON a.workspace_id=g.workspace_id AND a.grant_id=g.id
       WHERE g.workspace_id=target_workspace AND g.expires_at<=observed_at GROUP BY g.id,g.amount) l),
    (SELECT COALESCE(sum(f.amount),0)::text FROM tholi.credit_refunds f WHERE f.workspace_id=target_workspace);
END $$;

DROP VIEW tholi.credit_ledger;
CREATE VIEW tholi.credit_ledger WITH(security_invoker=true) AS
  SELECT workspace_id,id,'grant'::text AS kind,amount,created_at FROM tholi.credit_grants
  UNION ALL SELECT workspace_id,id,'settlement'::text,-amount,created_at FROM tholi.credit_settlements
  UNION ALL SELECT workspace_id,id,'refund'::text,amount,created_at FROM tholi.credit_refunds;

CREATE TABLE tholi.inference_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  period_seconds integer NOT NULL DEFAULT 86400 CHECK(period_seconds BETWEEN 60 AND 2678400),
  global_requests bigint NOT NULL DEFAULT 1000 CHECK(global_requests>0),
  global_provider_usd_micros bigint NOT NULL DEFAULT 0 CHECK(global_provider_usd_micros>=0)
);
INSERT INTO tholi.inference_control(singleton) VALUES(true);
CREATE TABLE tholi.inference_policy_versions (
  version text PRIMARY KEY CHECK(length(version) BETWEEN 1 AND 100),
  provider text NOT NULL CHECK(provider IN('fake','vertex')),
  model text NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
  price_revision text NOT NULL CHECK(length(price_revision) BETWEEN 1 AND 100),
  max_credits bigint NOT NULL CHECK(max_credits>0),
  max_provider_usd_micros bigint NOT NULL CHECK(max_provider_usd_micros>=0),
  max_input_units integer NOT NULL CHECK(max_input_units BETWEEN 1 AND 32768),
  max_output_units integer NOT NULL CHECK(max_output_units BETWEEN 1 AND 2048),
  max_images integer NOT NULL CHECK(max_images BETWEEN 0 AND 1),
  max_retries integer NOT NULL CHECK(max_retries=0),
  max_journey_requests integer NOT NULL CHECK(max_journey_requests BETWEEN 1 AND 8),
  period_seconds integer NOT NULL CHECK(period_seconds BETWEEN 60 AND 2678400),
  account_requests integer NOT NULL CHECK(account_requests>0),
  workspace_requests integer NOT NULL CHECK(workspace_requests>0),
  account_provider_usd_micros bigint NOT NULL CHECK(account_provider_usd_micros>=0),
  workspace_provider_usd_micros bigint NOT NULL CHECK(workspace_provider_usd_micros>=0),
  journey_provider_usd_micros bigint NOT NULL CHECK(journey_provider_usd_micros>=0)
);
-- This is a non-production development conversion, not a tier or a real price.
-- No entitlement, balance or recurring free grant is provisioned here.
INSERT INTO tholi.inference_policy_versions VALUES
  ('fake-development-v1','fake','tholi-deterministic-v1','fake-development-v1',
   1,0,32768,2048,1,0,8,86400,20,100,0,0,0);

CREATE TABLE tholi.inference_reservations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_id uuid NOT NULL,
  journey_id uuid NOT NULL,
  policy_version text NOT NULL REFERENCES tholi.inference_policy_versions(version),
  claim_token uuid NOT NULL UNIQUE,
  credit_reservation_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'reserved' CHECK(state IN('reserved','dispatched','uncertain','settled','released')),
  resolution text CHECK(resolution IN('not-sent','reported','unknown')),
  outcome text CHECK(outcome IN('completed','failed','cancelled','uncertain')),
  max_credits bigint NOT NULL CHECK(max_credits>0),
  max_provider_usd_micros bigint NOT NULL CHECK(max_provider_usd_micros>=0),
  provider_usd_micros bigint CHECK(provider_usd_micros>=0),
  charged_credits bigint CHECK(charged_credits>=0),
  input_units bigint CHECK(input_units>=0),
  output_units bigint CHECK(output_units>=0),
  provider_request_id text CHECK(length(provider_request_id) BETWEEN 1 AND 200),
  dispatched_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,request_id),
  FOREIGN KEY(workspace_id,request_id) REFERENCES tholi.requests(workspace_id,id),
  FOREIGN KEY(workspace_id,account_id) REFERENCES tholi.memberships(workspace_id,account_id),
  FOREIGN KEY(workspace_id,credit_reservation_id) REFERENCES tholi.credit_reservations(workspace_id,id)
);
CREATE UNIQUE INDEX inference_foreground_account_idx ON tholi.inference_reservations(account_id)
  WHERE state IN('reserved','dispatched','uncertain');
CREATE INDEX inference_workspace_period_idx ON tholi.inference_reservations(workspace_id,created_at,id);
CREATE INDEX inference_account_period_idx ON tholi.inference_reservations(account_id,created_at,id);
CREATE INDEX inference_global_period_idx ON tholi.inference_reservations(created_at,id);
CREATE INDEX inference_journey_idx ON tholi.inference_reservations(workspace_id,account_id,journey_id,created_at,id);
CREATE INDEX inference_credit_idx ON tholi.inference_reservations(workspace_id,credit_reservation_id);
CREATE INDEX inference_policy_idx ON tholi.inference_reservations(policy_version);

ALTER TABLE tholi.usage_records
  ADD COLUMN provider_usd_micros bigint CHECK(provider_usd_micros>=0),
  ADD COLUMN charged_credits bigint CHECK(charged_credits>=0),
  ADD COLUMN policy_version text REFERENCES tholi.inference_policy_versions(version);
CREATE INDEX usage_policy_idx ON tholi.usage_records(policy_version);

ALTER TABLE tholi.credit_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY allocation_actor ON tholi.credit_allocations USING(
  workspace_id=tholi.actor_workspace_id() AND EXISTS(SELECT FROM tholi.credit_reservations r
    WHERE r.workspace_id=credit_allocations.workspace_id AND r.id=credit_allocations.reservation_id));
ALTER TABLE tholi.credit_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY refund_actor ON tholi.credit_refunds USING(
  workspace_id=tholi.actor_workspace_id() AND EXISTS(SELECT FROM tholi.credit_settlements s
    WHERE s.workspace_id=credit_refunds.workspace_id AND s.id=credit_refunds.settlement_id))
  WITH CHECK(workspace_id=tholi.actor_workspace_id() AND tholi.current_member_role(workspace_id)='owner'
    AND EXISTS(SELECT FROM tholi.credit_settlements s
      WHERE s.workspace_id=credit_refunds.workspace_id AND s.id=credit_refunds.settlement_id));
ALTER TABLE tholi.inference_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY inference_actor ON tholi.inference_reservations FOR SELECT USING(
  workspace_id=tholi.actor_workspace_id() AND account_id=tholi.actor_account_id()
    AND tholi.current_member_role(workspace_id) IS NOT NULL);

CREATE TABLE tholi.inference_outcomes (
  reservation_id uuid PRIMARY KEY REFERENCES tholi.inference_reservations(id),
  resolution text NOT NULL CHECK(resolution IN('not-sent','reported')),
  outcome text NOT NULL CHECK(outcome IN('completed','failed','cancelled')),
  input_units bigint NOT NULL CHECK(input_units>=0),
  output_units bigint NOT NULL CHECK(output_units>=0),
  provider_usd_micros bigint NOT NULL CHECK(provider_usd_micros>=0),
  charged_credits bigint NOT NULL CHECK(charged_credits>=0),
  provider_request_id text CHECK(length(provider_request_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION tholi.lock_inference_accounting(target uuid,token uuid)
RETURNS tholi.inference_reservations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE held tholi.inference_reservations%ROWTYPE;
BEGIN
  SELECT * INTO held FROM tholi.inference_reservations r WHERE r.id=target AND r.claim_token=token;
  IF NOT FOUND THEN RAISE EXCEPTION 'The accounting capability is unavailable.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM tholi.inference_control c WHERE c.singleton FOR UPDATE;
  PERFORM 1 FROM tholi.accounts a WHERE a.id=held.account_id FOR UPDATE;
  PERFORM 1 FROM tholi.workspaces w WHERE w.id=held.workspace_id FOR UPDATE;
  SELECT * INTO held FROM tholi.inference_reservations r WHERE r.id=target AND r.claim_token=token FOR UPDATE;
  RETURN held;
END $$;

CREATE FUNCTION tholi.validate_inference_outcome(target uuid,token uuid,finished_resolution text,finished_outcome text,
  input_count bigint,output_count bigint,provider_cost bigint,credit_charge bigint,provider_request text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE held tholi.inference_reservations%ROWTYPE;
BEGIN
  SELECT * INTO held FROM tholi.inference_reservations r WHERE r.id=target AND r.claim_token=token;
  IF NOT FOUND THEN RAISE EXCEPTION 'The accounting capability is unavailable.' USING ERRCODE='42501'; END IF;
  IF finished_resolution IS NULL OR finished_outcome IS NULL
    OR finished_resolution NOT IN('not-sent','reported','unknown') OR finished_outcome NOT IN('completed','failed','cancelled','uncertain')
      OR ((finished_resolution='unknown') IS DISTINCT FROM (finished_outcome='uncertain'))
      OR (provider_request IS NOT NULL AND length(provider_request) NOT BETWEEN 1 AND 200) THEN
    RAISE EXCEPTION 'The accounting outcome is invalid.' USING ERRCODE='22023'; END IF;
  IF finished_resolution='unknown' THEN
    IF input_count IS NOT NULL OR output_count IS NOT NULL OR provider_cost IS NOT NULL OR credit_charge IS NOT NULL THEN
      RAISE EXCEPTION 'Unknown usage cannot claim measured quantities.' USING ERRCODE='22023'; END IF;
  ELSE
    IF input_count IS NULL OR output_count IS NULL OR provider_cost IS NULL OR credit_charge IS NULL
      OR input_count<0 OR output_count<0
      OR provider_cost<0 OR credit_charge<0 OR credit_charge>held.max_credits
      OR (finished_outcome<>'completed' AND credit_charge<>0)
      OR (finished_resolution='not-sent' AND (input_count<>0 OR output_count<>0 OR provider_cost<>0 OR credit_charge<>0)) THEN
      RAISE EXCEPTION 'The measured usage exceeds its original hold.' USING ERRCODE='22023'; END IF;
  END IF;
  -- An explicit server-held capability may record trusted no-send proof after
  -- authorization intent. A lease timeout alone never creates that proof.
END $$;

CREATE FUNCTION tholi.record_inference_outcome(target uuid,token uuid,finished_resolution text,finished_outcome text,
  input_count bigint,output_count bigint,provider_cost bigint,credit_charge bigint,provider_request text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE held tholi.inference_reservations%ROWTYPE; receipt tholi.inference_outcomes%ROWTYPE; inserted integer;
BEGIN
  held:=tholi.lock_inference_accounting(target,token);
  PERFORM tholi.validate_inference_outcome(target,token,finished_resolution,finished_outcome,input_count,output_count,provider_cost,credit_charge,provider_request);
  IF finished_resolution='unknown' THEN
    RAISE EXCEPTION 'An unknown outcome is not a measured receipt.' USING ERRCODE='22023'; END IF;
  INSERT INTO tholi.inference_outcomes(reservation_id,resolution,outcome,input_units,output_units,
      provider_usd_micros,charged_credits,provider_request_id)
    VALUES(target,finished_resolution,finished_outcome,input_count,output_count,provider_cost,credit_charge,provider_request)
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  SELECT * INTO STRICT receipt FROM tholi.inference_outcomes WHERE reservation_id=target;
  IF receipt.resolution IS DISTINCT FROM finished_resolution OR receipt.outcome IS DISTINCT FROM finished_outcome
      OR receipt.input_units IS DISTINCT FROM input_count OR receipt.output_units IS DISTINCT FROM output_count
      OR receipt.provider_usd_micros IS DISTINCT FROM provider_cost OR receipt.charged_credits IS DISTINCT FROM credit_charge
      OR receipt.provider_request_id IS DISTINCT FROM provider_request THEN
    RAISE EXCEPTION 'The trusted outcome receipt changed.' USING ERRCODE='P4404'; END IF;
  IF inserted=1 THEN
    -- Observed usage is evidence even if it breaches a submitted token ceiling
    -- or versioned cost estimate. Freeze inference instead of erasing cost or
    -- charging the user beyond the disclosed credit maximum.
    UPDATE tholi.inference_reservations SET provider_usd_micros=provider_cost
      WHERE id=target AND state IN('reserved','dispatched','uncertain');
    IF provider_cost>held.max_provider_usd_micros OR EXISTS(
      SELECT FROM tholi.inference_policy_versions p WHERE p.version=held.policy_version
        AND (input_count>p.max_input_units OR output_count>p.max_output_units)) THEN
      UPDATE tholi.inference_control SET enabled=false,revision=revision+1 WHERE singleton;
    END IF;
  END IF;
END $$;

CREATE FUNCTION tholi.reserve_inference(target_request uuid,target_journey uuid,policy text,deadline timestamptz)
RETURNS TABLE(id uuid,request_id uuid,claim_token uuid,credit_reservation_id uuid,max_credits text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p tholi.inference_policy_versions%ROWTYPE; existing tholi.inference_reservations%ROWTYPE;
  platform tholi.inference_control%ROWTYPE;
  expired_hold record; actor uuid:=tholi.actor_account_id(); workspace uuid:=tholi.actor_workspace_id();
  period_start timestamptz; global_period_start timestamptz; credits uuid:=gen_random_uuid(); admission uuid:=gen_random_uuid();
  bucket record; cap bigint; cost_cap bigint; granted_credit text; spent_credit text;
  reserved_credit text; expired_credit text; refunded_credit text;
BEGIN
  -- All admission/dispatch/settlement transactions use this order. The global
  -- row serializes only short SQL accounting, never a provider or network call.
  SELECT * INTO platform FROM tholi.inference_control c WHERE c.singleton AND c.enabled FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inference is disabled.' USING ERRCODE='P4405'; END IF;
  SELECT * INTO p FROM tholi.inference_policy_versions v WHERE v.version=policy FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The inference policy is unavailable.' USING ERRCODE='P4403'; END IF;
  PERFORM 1 FROM tholi.accounts a WHERE a.id=actor AND a.status='active' FOR UPDATE;
  IF NOT FOUND OR tholi.current_member_role(workspace) IS NULL THEN
    RAISE EXCEPTION 'The inference account is unavailable.' USING ERRCODE='42501'; END IF;
  -- An expired never-dispatched lease is provably no-send. Unknown/dispatched
  -- work is deliberately retained, including across process restarts.
  FOR expired_hold IN SELECT r.id,r.claim_token FROM tholi.inference_reservations r
    WHERE r.account_id=actor AND r.state='reserved' AND r.expires_at<=clock_timestamp()
      AND r.dispatched_at IS NULL ORDER BY r.workspace_id,r.id LOOP
    PERFORM tholi.finish_inference(expired_hold.id,expired_hold.claim_token,'not-sent','cancelled',0,0,0,0,NULL);
  END LOOP;
  PERFORM 1 FROM tholi.workspaces w WHERE w.id=workspace FOR UPDATE;
  SELECT * INTO existing FROM tholi.inference_reservations r
    WHERE r.workspace_id=workspace AND r.request_id=target_request AND r.account_id=actor;
  IF FOUND THEN
    IF existing.journey_id<>target_journey OR existing.policy_version<>policy
      OR existing.expires_at<>deadline THEN
      RAISE EXCEPTION 'The admission key changed.' USING ERRCODE='P4404'; END IF;
    RETURN QUERY SELECT existing.id,existing.request_id,existing.claim_token,
      existing.credit_reservation_id,existing.max_credits::text,existing.expires_at;
    RETURN;
  END IF;
  IF deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '25 seconds' THEN
    RAISE EXCEPTION 'The original inference deadline is invalid.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT FROM tholi.requests q WHERE q.workspace_id=workspace AND q.account_id=actor
      AND q.id=target_request AND q.status='pending') THEN
    RAISE EXCEPTION 'The pending request is unavailable.' USING ERRCODE='P4403'; END IF;
  IF EXISTS(SELECT FROM tholi.inference_reservations r WHERE r.account_id=actor
      AND r.state IN('reserved','dispatched','uncertain')) THEN
    RAISE EXCEPTION 'A foreground decision is already active.' USING ERRCODE='P4403'; END IF;
  period_start:=to_timestamp(floor(extract(epoch FROM clock_timestamp())/p.period_seconds)*p.period_seconds);
  global_period_start:=to_timestamp(floor(extract(epoch FROM clock_timestamp())/platform.period_seconds)*platform.period_seconds);
  FOR bucket IN SELECT 'global'::text AS kind,NULL::uuid AS target
    UNION ALL SELECT 'account',actor UNION ALL SELECT 'workspace',workspace UNION ALL SELECT 'journey',target_journey LOOP
    cap:=CASE bucket.kind WHEN 'account' THEN p.account_requests WHEN 'workspace' THEN p.workspace_requests
      WHEN 'global' THEN platform.global_requests ELSE p.max_journey_requests END;
    cost_cap:=CASE bucket.kind WHEN 'account' THEN p.account_provider_usd_micros
      WHEN 'workspace' THEN p.workspace_provider_usd_micros WHEN 'global' THEN platform.global_provider_usd_micros
      ELSE p.journey_provider_usd_micros END;
    IF (SELECT count(*)+1>cap OR (p.max_provider_usd_micros>0 AND COALESCE(sum(CASE WHEN r.state IN('reserved','dispatched','uncertain')
          THEN GREATEST(r.max_provider_usd_micros,COALESCE(r.provider_usd_micros,0)) ELSE COALESCE(r.provider_usd_micros,0) END),0)
          +p.max_provider_usd_micros>cost_cap)
        FROM tholi.inference_reservations r WHERE r.state<>'released'
          AND (bucket.kind='journey' OR r.created_at>=CASE WHEN bucket.kind='global' THEN global_period_start ELSE period_start END)
          AND (bucket.kind='global' OR (bucket.kind='account' AND r.account_id=actor)
            OR (bucket.kind='workspace' AND r.workspace_id=workspace)
            OR (bucket.kind='journey' AND r.workspace_id=workspace AND r.account_id=actor AND r.journey_id=target_journey))) THEN
      RAISE EXCEPTION 'The durable inference budget is exhausted.' USING ERRCODE='P4401'; END IF;
  END LOOP;
  SELECT t.granted,t.spent,t.reserved,t.expired,t.refunded INTO
    granted_credit,spent_credit,reserved_credit,expired_credit,refunded_credit
    FROM tholi.workspace_credit_totals(workspace) t;
  IF granted_credit::numeric-spent_credit::numeric-reserved_credit::numeric-expired_credit::numeric
      +refunded_credit::numeric<p.max_credits THEN
    RAISE EXCEPTION 'Available credits do not cover this reservation.' USING ERRCODE='P4402'; END IF;
  INSERT INTO tholi.credit_reservations(workspace_id,id,request_id,amount,expires_at)
    VALUES(workspace,credits,target_request,p.max_credits,deadline);
  PERFORM tholi.allocate_credit_lots_internal(workspace,credits);
  INSERT INTO tholi.inference_reservations(id,workspace_id,account_id,request_id,journey_id,
    policy_version,claim_token,credit_reservation_id,max_credits,max_provider_usd_micros,expires_at)
    VALUES(admission,workspace,actor,target_request,target_journey,policy,gen_random_uuid(),credits,
      p.max_credits,p.max_provider_usd_micros,deadline);
  RETURN QUERY SELECT r.id,r.request_id,r.claim_token,r.credit_reservation_id,r.max_credits::text,r.expires_at
    FROM tholi.inference_reservations r WHERE r.id=admission;
END $$;

CREATE FUNCTION tholi.mark_inference_dispatched(target uuid,token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE held tholi.inference_reservations%ROWTYPE;
BEGIN
  PERFORM 1 FROM tholi.inference_control c WHERE c.singleton AND c.enabled FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inference is disabled.' USING ERRCODE='P4405'; END IF;
  held:=tholi.lock_inference_accounting(target,token);
  IF NOT FOUND OR held.account_id IS DISTINCT FROM tholi.actor_account_id()
      OR held.workspace_id IS DISTINCT FROM tholi.actor_workspace_id() THEN
    RAISE EXCEPTION 'The inference lease is unavailable.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM tholi.accounts a WHERE a.id=held.account_id AND a.status='active';
  IF NOT FOUND OR tholi.current_member_role(held.workspace_id) IS NULL THEN
    RAISE EXCEPTION 'The inference account is unavailable.' USING ERRCODE='42501'; END IF;
  IF held.state<>'reserved' OR held.expires_at<=clock_timestamp()
    OR EXISTS(SELECT FROM tholi.inference_outcomes WHERE reservation_id=held.id)
    OR NOT EXISTS(SELECT FROM tholi.credit_reservations r WHERE r.workspace_id=held.workspace_id
      AND r.id=held.credit_reservation_id AND r.status='active' AND r.amount=held.max_credits) THEN
    RAISE EXCEPTION 'The inference lease changed or expired.' USING ERRCODE='P4403'; END IF;
  UPDATE tholi.inference_reservations SET state='dispatched',dispatched_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=target;
END $$;

CREATE FUNCTION tholi.finish_inference(target uuid,token uuid,finished_resolution text,finished_outcome text,
  input_count bigint,output_count bigint,provider_cost bigint,credit_charge bigint,provider_request text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE held tholi.inference_reservations%ROWTYPE; p tholi.inference_policy_versions%ROWTYPE;
  settlement tholi.credit_settlements%ROWTYPE; existing_usage tholi.usage_records%ROWTYPE;
BEGIN
  -- The unguessable hold capability authorizes only accounting for this recorded
  -- actor/request. Account, consent and membership revocation cannot erase cost.
  held:=tholi.lock_inference_accounting(target,token);
  SELECT * INTO STRICT p FROM tholi.inference_policy_versions v WHERE v.version=held.policy_version;
  PERFORM tholi.validate_inference_outcome(target,token,finished_resolution,finished_outcome,input_count,output_count,provider_cost,credit_charge,provider_request);
  IF finished_resolution<>'unknown' THEN
    PERFORM tholi.record_inference_outcome(target,token,finished_resolution,finished_outcome,input_count,output_count,provider_cost,credit_charge,provider_request);
  END IF;
  IF held.state IN('settled','released') THEN
    IF held.resolution IS DISTINCT FROM finished_resolution OR held.outcome IS DISTINCT FROM finished_outcome
      OR held.input_units IS DISTINCT FROM input_count OR held.output_units IS DISTINCT FROM output_count
      OR held.provider_usd_micros IS DISTINCT FROM provider_cost OR held.charged_credits IS DISTINCT FROM credit_charge
      OR held.provider_request_id IS DISTINCT FROM provider_request THEN
      RAISE EXCEPTION 'The settlement key changed.' USING ERRCODE='P4404'; END IF;
    RETURN;
  END IF;
  IF finished_resolution='unknown' THEN
    UPDATE tholi.credit_reservations SET status='uncertain',updated_at=clock_timestamp()
      WHERE workspace_id=held.workspace_id AND id=held.credit_reservation_id AND status IN('active','uncertain');
  ELSIF finished_resolution='not-sent' THEN
    UPDATE tholi.credit_reservations SET status='released',updated_at=clock_timestamp()
      WHERE workspace_id=held.workspace_id AND id=held.credit_reservation_id AND status IN('active','uncertain');
  ELSE
    SELECT * INTO settlement FROM tholi.credit_settlements s
      WHERE s.workspace_id=held.workspace_id AND s.reservation_id=held.credit_reservation_id;
    IF FOUND AND settlement.amount<>credit_charge THEN
      RAISE EXCEPTION 'The credit settlement changed.' USING ERRCODE='P4404'; END IF;
    INSERT INTO tholi.credit_settlements(workspace_id,id,reservation_id,amount)
      VALUES(held.workspace_id,gen_random_uuid(),held.credit_reservation_id,credit_charge) ON CONFLICT DO NOTHING;
    UPDATE tholi.credit_reservations SET status='settled',updated_at=clock_timestamp()
      WHERE workspace_id=held.workspace_id AND id=held.credit_reservation_id AND status IN('active','uncertain');
  END IF;
  SELECT * INTO existing_usage FROM tholi.usage_records u
    WHERE u.workspace_id=held.workspace_id AND u.request_id=held.request_id;
  IF FOUND AND (existing_usage.provider<>p.provider OR existing_usage.model<>p.model
      OR existing_usage.policy_version IS DISTINCT FROM p.version) THEN
    RAISE EXCEPTION 'The usage identity changed.' USING ERRCODE='P4404'; END IF;
  INSERT INTO tholi.usage_records(workspace_id,id,request_id,provider,model,input_units,output_units,
      provider_usd_micros,charged_credits,policy_version)
    VALUES(held.workspace_id,gen_random_uuid(),held.request_id,p.provider,p.model,COALESCE(input_count,0),COALESCE(output_count,0),
      provider_cost,credit_charge,p.version)
    ON CONFLICT(workspace_id,request_id) DO UPDATE SET input_units=EXCLUDED.input_units,output_units=EXCLUDED.output_units,
      provider_usd_micros=EXCLUDED.provider_usd_micros,charged_credits=EXCLUDED.charged_credits
      WHERE usage_records.provider_usd_micros IS NULL AND usage_records.charged_credits IS NULL;
  UPDATE tholi.inference_reservations SET
    state=CASE finished_resolution WHEN 'unknown' THEN 'uncertain' WHEN 'not-sent' THEN 'released' ELSE 'settled' END,
    resolution=finished_resolution,outcome=finished_outcome,input_units=input_count,output_units=output_count,
    provider_usd_micros=COALESCE(provider_cost,(SELECT o.provider_usd_micros FROM tholi.inference_outcomes o WHERE o.reservation_id=held.id)),
    charged_credits=credit_charge,provider_request_id=provider_request,updated_at=clock_timestamp()
    WHERE id=held.id;
END $$;

CREATE FUNCTION tholi.refund_inference(target uuid,token uuid,key text,refund_amount bigint)
RETURNS TABLE(id uuid,settlement_id uuid,amount text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE held tholi.inference_reservations%ROWTYPE; settlement tholi.credit_settlements%ROWTYPE;
  existing tholi.credit_refunds%ROWTYPE; refund_id uuid:=gen_random_uuid();
BEGIN
  held:=tholi.lock_inference_accounting(target,token);
  IF held.state<>'settled' OR refund_amount IS NULL OR refund_amount<=0 OR length(key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A known charge is required for a refund.' USING ERRCODE='P4403'; END IF;
  SELECT * INTO STRICT settlement FROM tholi.credit_settlements s
    WHERE s.workspace_id=held.workspace_id AND s.reservation_id=held.credit_reservation_id;
  SELECT * INTO existing FROM tholi.credit_refunds f WHERE f.workspace_id=held.workspace_id AND f.idempotency_key=key;
  IF FOUND THEN
    IF existing.settlement_id<>settlement.id OR existing.amount<>refund_amount THEN
      RAISE EXCEPTION 'The refund key changed.' USING ERRCODE='P4404'; END IF;
    RETURN QUERY SELECT existing.id,existing.settlement_id,existing.amount::text; RETURN;
  END IF;
  IF refund_amount+(SELECT COALESCE(sum(f.amount),0) FROM tholi.credit_refunds f
      WHERE f.workspace_id=held.workspace_id AND f.settlement_id=settlement.id)>settlement.amount THEN
    RAISE EXCEPTION 'Refunds cannot exceed the original charge.' USING ERRCODE='P4403'; END IF;
  INSERT INTO tholi.credit_refunds(workspace_id,id,settlement_id,idempotency_key,amount)
    VALUES(held.workspace_id,refund_id,settlement.id,key,refund_amount);
  RETURN QUERY SELECT refund_id,settlement.id,refund_amount::text;
END $$;

CREATE FUNCTION tholi.guard_inference_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  RAISE EXCEPTION 'Publish a new policy version instead of editing one.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER inference_policy_immutable BEFORE UPDATE OR DELETE ON tholi.inference_policy_versions
  FOR EACH ROW EXECUTE FUNCTION tholi.guard_inference_policy();

CREATE FUNCTION tholi.inference_usage(target uuid,token uuid)
RETURNS TABLE(id uuid,"requestId" uuid,provider text,model text,"inputUnits" text,"outputUnits" text,
  "providerUsdMicros" text,"chargedCredits" text,"policyVersion" text,"createdAt" timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT FROM tholi.inference_reservations r WHERE r.id=target AND r.claim_token=token) THEN
    RAISE EXCEPTION 'The accounting capability is unavailable.' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT u.id,u.request_id,u.provider,u.model,
    CASE WHEN r.resolution='unknown' THEN NULL ELSE u.input_units::text END,
    CASE WHEN r.resolution='unknown' THEN NULL ELSE u.output_units::text END,
    u.provider_usd_micros::text,u.charged_credits::text,u.policy_version,u.created_at
    FROM tholi.usage_records u JOIN tholi.inference_reservations r
      ON r.workspace_id=u.workspace_id AND r.request_id=u.request_id WHERE r.id=target AND r.claim_token=token;
END $$;

CREATE FUNCTION tholi.schedule_inference_reconciliation(batch integer,interval_ms integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE held record; job uuid; scheduled integer:=0; inserted integer; phase text;
BEGIN
  IF batch IS NULL OR batch NOT BETWEEN 1 AND 100 OR interval_ms IS NULL OR interval_ms NOT BETWEEN 1000 AND 86400000 THEN
    RAISE EXCEPTION 'Use a bounded reconciliation tick.' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM tholi.inference_control c WHERE c.singleton FOR UPDATE;
  FOR held IN SELECT r.*,EXISTS(SELECT FROM tholi.inference_outcomes o WHERE o.reservation_id=r.id) AS proven
    FROM tholi.inference_reservations r WHERE r.state IN('reserved','dispatched','uncertain')
      AND r.expires_at<=clock_timestamp() AND r.updated_at<=clock_timestamp()-interval_ms*interval '1 millisecond'
    ORDER BY r.updated_at,r.id LIMIT batch FOR UPDATE OF r SKIP LOCKED LOOP
    phase:=CASE WHEN held.proven THEN 'proof' ELSE 'review' END;
    job:=gen_random_uuid();
    INSERT INTO tholi.jobs(workspace_id,id,account_id,request_id,kind,version,idempotency_key,record_references,
      max_attempts,replay_safe)
      VALUES(held.workspace_id,job,held.account_id,held.request_id,'inference.reconcile',1,
        'inference:'||held.id::text||':'||phase,jsonb_build_object('requestId',held.request_id),3,true)
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS inserted=ROW_COUNT;
    IF inserted=1 THEN
      INSERT INTO tholi.outbox(workspace_id,id,job_id,event_kind,idempotency_key)
        VALUES(held.workspace_id,gen_random_uuid(),job,'job.queued','job:'||job::text||':queued');
      scheduled:=scheduled+1;
    END IF;
  END LOOP;
  RETURN scheduled;
END $$;

CREATE FUNCTION tholi.reconcile_inference(workspace uuid,actor uuid,target_job uuid,fence uuid)
RETURNS TABLE(processed integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE task tholi.jobs%ROWTYPE; held tholi.inference_reservations%ROWTYPE;
  receipt tholi.inference_outcomes%ROWTYPE; unresolved boolean:=false;
BEGIN
  -- A worker may use only its exact live registered metadata job. This is not a
  -- general suspended-account scope and grants no data, funding or model access.
  SELECT * INTO task FROM tholi.jobs j WHERE j.workspace_id=workspace AND j.account_id=actor AND j.id=target_job
    AND j.kind='inference.reconcile' AND j.version=1 AND j.replay_safe AND j.status='running'
    AND j.claim_token=fence AND j.lease_expires_at>clock_timestamp() AND j.cancel_requested_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'The accounting job lease is unavailable.' USING ERRCODE='42501'; END IF;
  SELECT * INTO held FROM tholi.inference_reservations r
    WHERE r.workspace_id=workspace AND r.account_id=actor AND r.request_id=task.request_id;
  IF NOT FOUND OR task.record_references<>jsonb_build_object('requestId',held.request_id) THEN
    RAISE EXCEPTION 'The accounting job reference changed.' USING ERRCODE='42501'; END IF;
  held:=tholi.lock_inference_accounting(held.id,held.claim_token);
  SELECT * INTO task FROM tholi.jobs j WHERE j.workspace_id=workspace AND j.id=target_job AND j.account_id=actor
    AND j.status='running' AND j.claim_token=fence AND j.lease_expires_at>clock_timestamp()
    AND j.cancel_requested_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The accounting job lease expired.' USING ERRCODE='42501'; END IF;
  SELECT * INTO receipt FROM tholi.inference_outcomes o WHERE o.reservation_id=held.id;
  IF FOUND THEN
    PERFORM tholi.finish_inference(held.id,held.claim_token,receipt.resolution,receipt.outcome,
      receipt.input_units,receipt.output_units,receipt.provider_usd_micros,receipt.charged_credits,receipt.provider_request_id);
  ELSIF held.state='reserved' AND held.dispatched_at IS NULL AND held.expires_at<=clock_timestamp() THEN
    PERFORM tholi.finish_inference(held.id,held.claim_token,'not-sent','cancelled',0,0,0,0,NULL);
  ELSIF held.state IN('dispatched','uncertain') THEN
    PERFORM tholi.finish_inference(held.id,held.claim_token,'unknown','uncertain',NULL,NULL,NULL,NULL,NULL);
    unresolved:=true;
  ELSIF held.state NOT IN('settled','released') THEN
    RAISE EXCEPTION 'The accounting outcome is not ready.' USING ERRCODE='P4403';
  END IF;
  UPDATE tholi.jobs SET status=CASE WHEN unresolved THEN 'uncertain' ELSE 'succeeded' END,
    last_error_code=CASE WHEN unresolved THEN 'UNAVAILABLE' ELSE NULL END,
    result_count=CASE WHEN unresolved THEN 0 ELSE 1 END,claim_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
    revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=workspace AND id=target_job;
  IF NOT unresolved THEN
    INSERT INTO tholi.outbox(workspace_id,id,job_id,event_kind,idempotency_key,status,published_at)
      VALUES(workspace,gen_random_uuid(),target_job,'job.completed','job:'||target_job::text||':completed','published',clock_timestamp())
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN QUERY SELECT CASE WHEN unresolved THEN 0 ELSE 1 END;
END $$;

CREATE INDEX credit_grants_history_idx ON tholi.credit_grants(workspace_id,created_at,id);
CREATE INDEX credit_settlements_history_idx ON tholi.credit_settlements(workspace_id,created_at,id);
CREATE INDEX credit_refunds_history_idx ON tholi.credit_refunds(workspace_id,created_at,id);

CREATE FUNCTION tholi.inference_health()
RETURNS TABLE(settled_provider_usd_micros text,reserved_provider_usd_micros text,uncertain_count text,enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT COALESCE(sum(r.provider_usd_micros) FILTER(WHERE r.state='settled'),0)::text,
    COALESCE(sum(GREATEST(r.max_provider_usd_micros,COALESCE(r.provider_usd_micros,0)))
      FILTER(WHERE r.state IN('reserved','dispatched','uncertain')),0)::text,
    count(*) FILTER(WHERE r.state='uncertain')::text,
    (SELECT c.enabled FROM tholi.inference_control c WHERE c.singleton)
    FROM tholi.inference_reservations r
$$;

REVOKE ALL ON FUNCTION tholi.allocate_credit_lots_internal(uuid,uuid,boolean),
  tholi.allocate_credit_lots(uuid,uuid),tholi.workspace_credit_totals(uuid),
  tholi.reserve_inference(uuid,uuid,text,timestamptz),tholi.mark_inference_dispatched(uuid,uuid),
  tholi.finish_inference(uuid,uuid,text,text,bigint,bigint,bigint,bigint,text),
  tholi.refund_inference(uuid,uuid,text,bigint),tholi.guard_inference_policy(),
  tholi.lock_inference_accounting(uuid,uuid),
  tholi.validate_inference_outcome(uuid,uuid,text,text,bigint,bigint,bigint,bigint,text),
  tholi.record_inference_outcome(uuid,uuid,text,text,bigint,bigint,bigint,bigint,text),
  tholi.inference_usage(uuid,uuid),tholi.schedule_inference_reconciliation(integer,integer),
  tholi.reconcile_inference(uuid,uuid,uuid,uuid),tholi.inference_health() FROM PUBLIC;
`;
