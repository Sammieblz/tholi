import { PROVIDER_CATALOG_V1 } from "../../../../../packages/navigation-core/contracts-providers";

// This frozen catalog revision is part of migration history, never the active alias.
const policies = Object.values(PROVIDER_CATALOG_V1)
  .map(
    (entry) =>
      `('customer-${entry.provider}-development-v1','${entry.provider}','${entry.model}',
    'customer-${entry.provider}-development-v1',0,0,32768,2048,1,0,2,86400,6,6,0,0,0,
    'customer',2,'byok-catalog-v1','${entry.routingPolicyVersion}')`,
  )
  .join(",\n");

export const customerInference = `
-- Both funding sources share the same request, foreground and accounting owners.
-- Enabling customer egress cannot enable managed-provider spending.
ALTER TABLE tholi.inference_control ADD COLUMN customer_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE tholi.inference_policy_versions
  DROP CONSTRAINT inference_policy_versions_provider_check,
  DROP CONSTRAINT inference_policy_versions_max_credits_check,
  ADD COLUMN funding_source text NOT NULL DEFAULT 'managed' CHECK(funding_source IN('managed','customer')),
  ADD COLUMN requests_per_minute integer CHECK(requests_per_minute BETWEEN 1 AND 60),
  ADD COLUMN catalog_revision text,
  ADD COLUMN routing_policy_version text,
  ADD CHECK(provider IN('fake','vertex','openai','anthropic','openrouter')),
  ADD CHECK((funding_source='managed' AND provider IN('fake','vertex') AND max_credits>0
      AND catalog_revision IS NULL AND routing_policy_version IS NULL)
    OR (funding_source='customer' AND provider IN('openai','anthropic','openrouter') AND max_credits=0
      AND max_provider_usd_micros=0 AND account_provider_usd_micros=0
      AND workspace_provider_usd_micros=0 AND journey_provider_usd_micros=0
      AND requests_per_minute IS NOT NULL AND length(catalog_revision) BETWEEN 1 AND 100
      AND length(routing_policy_version) BETWEEN 1 AND 100));
INSERT INTO tholi.inference_policy_versions
  (version,provider,model,price_revision,max_credits,max_provider_usd_micros,
    max_input_units,max_output_units,max_images,max_retries,max_journey_requests,
    period_seconds,account_requests,workspace_requests,account_provider_usd_micros,
    workspace_provider_usd_micros,journey_provider_usd_micros,funding_source,
    requests_per_minute,catalog_revision,routing_policy_version)
  VALUES ${policies};

ALTER TABLE tholi.inference_reservations
  DROP CONSTRAINT inference_reservations_max_credits_check,
  ALTER COLUMN credit_reservation_id DROP NOT NULL,
  ADD COLUMN funding_source text NOT NULL DEFAULT 'managed' CHECK(funding_source IN('managed','customer')),
  ADD COLUMN provider_connection_id uuid,
  ADD COLUMN provider_binding jsonb,
  ADD COLUMN usage_details jsonb NOT NULL DEFAULT '{"version":1}',
  ADD FOREIGN KEY(account_id,provider_connection_id) REFERENCES tholi.provider_connections(account_id,id),
  ADD CHECK((funding_source='managed' AND max_credits>0 AND credit_reservation_id IS NOT NULL
      AND provider_connection_id IS NULL AND provider_binding IS NULL)
    OR (funding_source='customer' AND max_credits=0 AND max_provider_usd_micros=0
      AND credit_reservation_id IS NULL AND provider_connection_id IS NOT NULL AND provider_binding IS NOT NULL));
ALTER TABLE tholi.inference_outcomes ADD COLUMN usage_details jsonb NOT NULL DEFAULT '{"version":1}';
ALTER TABLE tholi.usage_records
  ADD COLUMN funding_source text NOT NULL DEFAULT 'managed' CHECK(funding_source IN('managed','customer')),
  ADD COLUMN usage_details jsonb NOT NULL DEFAULT '{"version":1}';

CREATE FUNCTION tholi.valid_inference_usage_details(details jsonb,input_count bigint,output_count bigint,funding text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE key text; value jsonb; measured numeric;
BEGIN
  IF jsonb_typeof(details) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF details='{"version":1}'::jsonb THEN RETURN funding='managed'; END IF;
  IF details->'version' IS DISTINCT FROM '2'::jsonb OR (SELECT count(*) FROM jsonb_object_keys(details))<>5 THEN RETURN false; END IF;
  FOR key,value IN SELECT * FROM jsonb_each(details) LOOP
    IF key='version' THEN CONTINUE; END IF;
    IF key NOT IN('customerUsdMicros','cacheReadInputUnits','cacheWriteInputUnits','reasoningOutputUnits') THEN RETURN false; END IF;
    IF value='null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(value)<>'string' OR details->>key !~ '^(0|[1-9][0-9]{0,18})$' THEN RETURN false; END IF;
    measured:=(details->>key)::numeric;
    IF measured>9223372036854775807 THEN RETURN false; END IF;
    IF key='customerUsdMicros' THEN
      IF funding<>'customer' THEN RETURN false; END IF;
    ELSIF key='reasoningOutputUnits' THEN
      IF output_count IS NULL OR measured>output_count THEN RETURN false; END IF;
    ELSIF input_count IS NULL OR measured>input_count THEN RETURN false; END IF;
  END LOOP;
  RETURN COALESCE((details->>'cacheReadInputUnits')::numeric,0)
    +COALESCE((details->>'cacheWriteInputUnits')::numeric,0)<=COALESCE(input_count,0);
END $$;

CREATE FUNCTION tholi.inference_outcome_details(target uuid,token uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE held tholi.inference_reservations%ROWTYPE; details jsonb;
BEGIN
  SELECT * INTO held FROM tholi.inference_reservations WHERE id=target AND claim_token=token;
  IF NOT FOUND THEN RAISE EXCEPTION 'The accounting capability is unavailable.' USING ERRCODE='42501'; END IF;
  SELECT usage_details INTO details FROM tholi.inference_outcomes WHERE reservation_id=target;
  RETURN COALESCE(details,CASE WHEN held.funding_source='customer' THEN
    '{"version":2,"customerUsdMicros":null,"cacheReadInputUnits":null,"cacheWriteInputUnits":null,"reasoningOutputUnits":null}'::jsonb
    ELSE held.usage_details END);
END $$;

CREATE FUNCTION tholi.reserve_inference(target_request uuid,target_journey uuid,policy text,deadline timestamptz,binding jsonb)
RETURNS TABLE(id uuid,request_id uuid,claim_token uuid,credit_reservation_id uuid,max_credits text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p tholi.inference_policy_versions%ROWTYPE; existing tholi.inference_reservations%ROWTYPE;
  platform tholi.inference_control%ROWTYPE; connection tholi.provider_connections%ROWTYPE;
  expired_hold record; actor uuid:=tholi.actor_account_id(); workspace uuid:=tholi.actor_workspace_id();
  observed_at timestamptz; period_start timestamptz; global_period_start timestamptz;
  credits uuid; admission uuid:=gen_random_uuid(); bucket record; cap bigint; cost_cap bigint;
  granted_credit text; spent_credit text; reserved_credit text; expired_credit text; refunded_credit text;
BEGIN
  SELECT * INTO platform FROM tholi.inference_control c WHERE c.singleton FOR UPDATE;
  SELECT * INTO p FROM tholi.inference_policy_versions v WHERE v.version=policy FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The inference policy is unavailable.' USING ERRCODE='P4403'; END IF;
  IF (p.funding_source='customer' AND NOT platform.customer_enabled)
    OR (p.funding_source='managed' AND NOT platform.enabled) THEN
    RAISE EXCEPTION 'Inference is disabled.' USING ERRCODE='P4405'; END IF;
  PERFORM 1 FROM tholi.accounts a WHERE a.id=actor AND a.status='active' FOR UPDATE;
  IF NOT FOUND OR tholi.current_member_role(workspace) IS NULL THEN
    RAISE EXCEPTION 'The inference account is unavailable.' USING ERRCODE='42501'; END IF;
  FOR expired_hold IN SELECT r.id,r.claim_token FROM tholi.inference_reservations r
    WHERE r.account_id=actor AND r.state='reserved' AND r.expires_at<=clock_timestamp()
      AND r.dispatched_at IS NULL ORDER BY r.workspace_id,r.id LOOP
    PERFORM tholi.finish_inference(expired_hold.id,expired_hold.claim_token,'not-sent','cancelled',0,0,0,0,NULL);
  END LOOP;
  PERFORM 1 FROM tholi.workspaces w WHERE w.id=workspace FOR UPDATE;
  IF p.funding_source='customer' THEN
    IF jsonb_typeof(binding) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'The provider binding is invalid.' USING ERRCODE='22023'; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(binding))<>8
      OR NOT (binding ?& ARRAY['connectionId','revision','provider','model','catalogRevision','routingPolicyVersion','policyDigest','retrievalSnapshotDigest'])
      OR EXISTS(SELECT FROM jsonb_each(binding) WHERE jsonb_typeof(value)<>'string')
      OR binding->>'connectionId' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      OR binding->>'revision' !~ '^[1-9][0-9]{0,18}$'
      OR binding->>'policyDigest' !~ '^[a-f0-9]{64}$'
      OR binding->>'retrievalSnapshotDigest' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'The provider binding is invalid.' USING ERRCODE='22023'; END IF;
    IF (binding->>'revision')::numeric>9223372036854775807 THEN
      RAISE EXCEPTION 'The provider revision is invalid.' USING ERRCODE='22023'; END IF;
    SELECT * INTO connection FROM tholi.provider_connections c
      WHERE c.account_id=actor AND c.id=(binding->>'connectionId')::uuid;
    IF NOT FOUND OR NOT tholi.provider_connection_current(connection.id,(binding->>'revision')::bigint,decode(binding->>'policyDigest','hex'))
      OR connection.provider<>p.provider OR connection.model_id<>p.model
      OR connection.catalog_revision<>p.catalog_revision OR connection.routing_policy_version<>p.routing_policy_version
      OR binding->>'provider' IS DISTINCT FROM p.provider OR binding->>'model' IS DISTINCT FROM p.model
      OR binding->>'catalogRevision' IS DISTINCT FROM p.catalog_revision
      OR binding->>'routingPolicyVersion' IS DISTINCT FROM p.routing_policy_version THEN
      RAISE EXCEPTION 'The provider connection changed.' USING ERRCODE='42501'; END IF;
  ELSIF binding IS NOT NULL THEN
    RAISE EXCEPTION 'Managed inference cannot use a customer binding.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO existing FROM tholi.inference_reservations r
    WHERE r.workspace_id=workspace AND r.request_id=target_request AND r.account_id=actor;
  IF FOUND THEN
    IF existing.journey_id<>target_journey OR existing.policy_version<>policy
      OR existing.expires_at<>deadline OR existing.provider_binding IS DISTINCT FROM binding THEN
      RAISE EXCEPTION 'The admission key changed.' USING ERRCODE='P4404'; END IF;
    RETURN QUERY SELECT existing.id,existing.request_id,existing.claim_token,
      existing.credit_reservation_id,existing.max_credits::text,existing.expires_at;
    RETURN;
  END IF;
  observed_at:=clock_timestamp();
  IF deadline<=observed_at OR deadline>observed_at+interval '25 seconds' THEN
    RAISE EXCEPTION 'The original inference deadline is invalid.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT FROM tholi.requests q WHERE q.workspace_id=workspace AND q.account_id=actor
      AND q.id=target_request AND q.status='pending') THEN
    RAISE EXCEPTION 'The pending request is unavailable.' USING ERRCODE='P4403'; END IF;
  IF EXISTS(SELECT FROM tholi.inference_reservations r WHERE r.account_id=actor
      AND r.state IN('reserved','dispatched','uncertain')) THEN
    RAISE EXCEPTION 'A foreground decision is already active.' USING ERRCODE='P4403'; END IF;
  period_start:=CASE WHEN p.funding_source='customer' THEN observed_at-p.period_seconds*interval '1 second'
    ELSE to_timestamp(floor(extract(epoch FROM observed_at)/p.period_seconds)*p.period_seconds) END;
  global_period_start:=to_timestamp(floor(extract(epoch FROM observed_at)/platform.period_seconds)*platform.period_seconds);
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
  IF p.requests_per_minute IS NOT NULL AND (SELECT count(*) FROM tholi.inference_reservations r
    WHERE r.account_id=actor AND r.state<>'released' AND r.created_at>observed_at-interval '1 minute')>=p.requests_per_minute THEN
    RAISE EXCEPTION 'The short inference allowance is exhausted.' USING ERRCODE='P4401'; END IF;
  IF p.funding_source='managed' THEN
    SELECT t.granted,t.spent,t.reserved,t.expired,t.refunded INTO granted_credit,spent_credit,reserved_credit,expired_credit,refunded_credit
      FROM tholi.workspace_credit_totals(workspace) t;
    IF granted_credit::numeric-spent_credit::numeric-reserved_credit::numeric-expired_credit::numeric
        +refunded_credit::numeric<p.max_credits THEN
      RAISE EXCEPTION 'Available credits do not cover this reservation.' USING ERRCODE='P4402'; END IF;
    credits:=gen_random_uuid();
    INSERT INTO tholi.credit_reservations(workspace_id,id,request_id,amount,expires_at)
      VALUES(workspace,credits,target_request,p.max_credits,deadline);
    PERFORM tholi.allocate_credit_lots_internal(workspace,credits);
  END IF;
  INSERT INTO tholi.inference_reservations(id,workspace_id,account_id,request_id,journey_id,
    policy_version,claim_token,credit_reservation_id,max_credits,max_provider_usd_micros,expires_at,
    funding_source,provider_connection_id,provider_binding,usage_details)
    VALUES(admission,workspace,actor,target_request,target_journey,policy,gen_random_uuid(),credits,
      p.max_credits,p.max_provider_usd_micros,deadline,p.funding_source,connection.id,binding,
      CASE WHEN p.funding_source='customer' THEN
        '{"version":2,"customerUsdMicros":null,"cacheReadInputUnits":null,"cacheWriteInputUnits":null,"reasoningOutputUnits":null}'::jsonb
        ELSE '{"version":1}'::jsonb END);
  RETURN QUERY SELECT r.id,r.request_id,r.claim_token,r.credit_reservation_id,r.max_credits::text,r.expires_at
    FROM tholi.inference_reservations r WHERE r.id=admission;
END $$;

CREATE OR REPLACE FUNCTION tholi.mark_inference_dispatched(target uuid,token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE held tholi.inference_reservations%ROWTYPE; platform tholi.inference_control%ROWTYPE;
BEGIN
  SELECT * INTO platform FROM tholi.inference_control c WHERE c.singleton FOR UPDATE;
  held:=tholi.lock_inference_accounting(target,token);
  IF (held.funding_source='customer' AND NOT platform.customer_enabled)
    OR (held.funding_source='managed' AND NOT platform.enabled) THEN
    RAISE EXCEPTION 'Inference is disabled.' USING ERRCODE='P4405'; END IF;
  IF held.account_id IS DISTINCT FROM tholi.actor_account_id()
      OR held.workspace_id IS DISTINCT FROM tholi.actor_workspace_id() THEN
    RAISE EXCEPTION 'The inference lease is unavailable.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM tholi.accounts a WHERE a.id=held.account_id AND a.status='active';
  IF NOT FOUND OR tholi.current_member_role(held.workspace_id) IS NULL THEN
    RAISE EXCEPTION 'The inference account is unavailable.' USING ERRCODE='42501'; END IF;
  IF held.state<>'reserved' OR held.expires_at<=clock_timestamp()
    OR EXISTS(SELECT FROM tholi.inference_outcomes WHERE reservation_id=held.id)
    OR (held.funding_source='managed' AND NOT EXISTS(SELECT FROM tholi.credit_reservations r
      WHERE r.workspace_id=held.workspace_id AND r.id=held.credit_reservation_id AND r.status='active' AND r.amount=held.max_credits))
    OR (held.funding_source='customer' AND NOT tholi.provider_connection_current(held.provider_connection_id,
      (held.provider_binding->>'revision')::bigint,decode(held.provider_binding->>'policyDigest','hex'))) THEN
    RAISE EXCEPTION 'The inference lease changed or expired.' USING ERRCODE='P4403'; END IF;
  UPDATE tholi.inference_reservations SET state='dispatched',dispatched_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=target;
END $$;

CREATE OR REPLACE FUNCTION tholi.reserve_inference(target_request uuid,target_journey uuid,policy text,deadline timestamptz)
RETURNS TABLE(id uuid,request_id uuid,claim_token uuid,credit_reservation_id uuid,max_credits text,expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT * FROM tholi.reserve_inference(target_request,target_journey,policy,deadline,NULL)
$$;

CREATE OR REPLACE FUNCTION tholi.validate_inference_outcome(target uuid,token uuid,finished_resolution text,finished_outcome text,
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
    IF input_count IS NOT NULL OR output_count IS NOT NULL OR
      (held.funding_source='managed' AND (provider_cost IS NOT NULL OR credit_charge IS NOT NULL)) OR
      (held.funding_source='customer' AND (COALESCE(provider_cost,0)<>0 OR COALESCE(credit_charge,0)<>0)) THEN
      RAISE EXCEPTION 'Unknown usage cannot claim measured quantities.' USING ERRCODE='22023'; END IF;
  ELSE
    IF input_count IS NULL OR output_count IS NULL OR provider_cost IS NULL OR credit_charge IS NULL
      OR input_count<0 OR output_count<0
      OR provider_cost<0 OR credit_charge<0 OR credit_charge>held.max_credits
      OR (held.funding_source='customer' AND (provider_cost<>0 OR credit_charge<>0))
      OR (finished_outcome<>'completed' AND credit_charge<>0)
      OR (finished_resolution='not-sent' AND (input_count<>0 OR output_count<>0 OR provider_cost<>0 OR credit_charge<>0)) THEN
      RAISE EXCEPTION 'The measured usage exceeds its original hold.' USING ERRCODE='22023'; END IF;
  END IF;
  -- An explicit server-held capability may record trusted no-send proof after
  -- authorization intent. A lease timeout alone never creates that proof.
END $$;

CREATE FUNCTION tholi.record_inference_outcome(target uuid,token uuid,finished_resolution text,finished_outcome text,
  input_count bigint,output_count bigint,provider_cost bigint,credit_charge bigint,provider_request text,details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE held tholi.inference_reservations%ROWTYPE; receipt tholi.inference_outcomes%ROWTYPE; inserted integer;
BEGIN
  held:=tholi.lock_inference_accounting(target,token);
  PERFORM tholi.validate_inference_outcome(target,token,finished_resolution,finished_outcome,input_count,output_count,provider_cost,credit_charge,provider_request);
  IF NOT tholi.valid_inference_usage_details(details,input_count,output_count,held.funding_source) THEN
    RAISE EXCEPTION 'The usage details are invalid.' USING ERRCODE='22023'; END IF;
  IF finished_resolution='unknown' THEN
    RAISE EXCEPTION 'An unknown outcome is not a measured receipt.' USING ERRCODE='22023'; END IF;
  INSERT INTO tholi.inference_outcomes(reservation_id,resolution,outcome,input_units,output_units,
      provider_usd_micros,charged_credits,provider_request_id,usage_details)
    VALUES(target,finished_resolution,finished_outcome,input_count,output_count,provider_cost,credit_charge,provider_request,details)
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  SELECT * INTO STRICT receipt FROM tholi.inference_outcomes WHERE reservation_id=target;
  IF receipt.resolution IS DISTINCT FROM finished_resolution OR receipt.outcome IS DISTINCT FROM finished_outcome
      OR receipt.input_units IS DISTINCT FROM input_count OR receipt.output_units IS DISTINCT FROM output_count
      OR receipt.provider_usd_micros IS DISTINCT FROM provider_cost OR receipt.charged_credits IS DISTINCT FROM credit_charge
      OR receipt.provider_request_id IS DISTINCT FROM provider_request OR receipt.usage_details IS DISTINCT FROM details THEN
    RAISE EXCEPTION 'The trusted outcome receipt changed.' USING ERRCODE='P4404'; END IF;
  IF inserted=1 THEN
    -- Observed usage is evidence even if it breaches a submitted token ceiling
    -- or versioned cost estimate. Freeze inference instead of erasing cost or
    -- charging the user beyond the disclosed credit maximum.
    UPDATE tholi.inference_reservations SET provider_usd_micros=provider_cost,usage_details=details
      WHERE id=target AND state IN('reserved','dispatched','uncertain');
    IF provider_cost>held.max_provider_usd_micros OR EXISTS(
      SELECT FROM tholi.inference_policy_versions p WHERE p.version=held.policy_version
        AND (input_count>p.max_input_units OR output_count>p.max_output_units)) THEN
      UPDATE tholi.inference_control SET enabled=CASE WHEN held.funding_source='managed' THEN false ELSE enabled END,
        customer_enabled=CASE WHEN held.funding_source='customer' THEN false ELSE customer_enabled END,revision=revision+1 WHERE singleton;
    END IF;
  END IF;
END $$;

CREATE FUNCTION tholi.finish_inference(target uuid,token uuid,finished_resolution text,finished_outcome text,
  input_count bigint,output_count bigint,provider_cost bigint,credit_charge bigint,provider_request text,details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE held tholi.inference_reservations%ROWTYPE; p tholi.inference_policy_versions%ROWTYPE;
  settlement tholi.credit_settlements%ROWTYPE; existing_usage tholi.usage_records%ROWTYPE;
BEGIN
  -- The unguessable hold capability authorizes only accounting for this recorded
  -- actor/request. Account, consent and membership revocation cannot erase cost.
  held:=tholi.lock_inference_accounting(target,token);
  IF held.funding_source='customer' THEN provider_cost:=COALESCE(provider_cost,0); credit_charge:=COALESCE(credit_charge,0); END IF;
  IF NOT tholi.valid_inference_usage_details(details,input_count,output_count,held.funding_source) THEN
    RAISE EXCEPTION 'The usage details are invalid.' USING ERRCODE='22023'; END IF;
  SELECT * INTO STRICT p FROM tholi.inference_policy_versions v WHERE v.version=held.policy_version;
  PERFORM tholi.validate_inference_outcome(target,token,finished_resolution,finished_outcome,input_count,output_count,provider_cost,credit_charge,provider_request);
  IF finished_resolution<>'unknown' THEN
    PERFORM tholi.record_inference_outcome(target,token,finished_resolution,finished_outcome,input_count,output_count,provider_cost,credit_charge,provider_request,details);
  END IF;
  IF held.state IN('settled','released') THEN
    IF held.resolution IS DISTINCT FROM finished_resolution OR held.outcome IS DISTINCT FROM finished_outcome
      OR held.input_units IS DISTINCT FROM input_count OR held.output_units IS DISTINCT FROM output_count
      OR held.provider_usd_micros IS DISTINCT FROM provider_cost OR held.charged_credits IS DISTINCT FROM credit_charge
      OR held.provider_request_id IS DISTINCT FROM provider_request OR held.usage_details IS DISTINCT FROM details THEN
      RAISE EXCEPTION 'The settlement key changed.' USING ERRCODE='P4404'; END IF;
    RETURN;
  END IF;
  IF held.credit_reservation_id IS NOT NULL THEN
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
  END IF;
  SELECT * INTO existing_usage FROM tholi.usage_records u
    WHERE u.workspace_id=held.workspace_id AND u.request_id=held.request_id;
  IF FOUND AND (existing_usage.provider<>p.provider OR existing_usage.model<>p.model
      OR existing_usage.policy_version IS DISTINCT FROM p.version) THEN
    RAISE EXCEPTION 'The usage identity changed.' USING ERRCODE='P4404'; END IF;
  INSERT INTO tholi.usage_records(workspace_id,id,request_id,provider,model,input_units,output_units,
      provider_usd_micros,charged_credits,policy_version,funding_source,usage_details)
    VALUES(held.workspace_id,gen_random_uuid(),held.request_id,p.provider,p.model,COALESCE(input_count,0),COALESCE(output_count,0),
      provider_cost,credit_charge,p.version,held.funding_source,details)
    ON CONFLICT(workspace_id,request_id) DO UPDATE SET input_units=EXCLUDED.input_units,output_units=EXCLUDED.output_units,
      provider_usd_micros=EXCLUDED.provider_usd_micros,charged_credits=EXCLUDED.charged_credits,usage_details=EXCLUDED.usage_details
      WHERE (usage_records.provider_usd_micros IS NULL AND usage_records.charged_credits IS NULL)
        OR held.state='uncertain';
  UPDATE tholi.inference_reservations SET
    state=CASE finished_resolution WHEN 'unknown' THEN 'uncertain' WHEN 'not-sent' THEN 'released' ELSE 'settled' END,
    resolution=finished_resolution,outcome=finished_outcome,input_units=input_count,output_units=output_count,
    provider_usd_micros=COALESCE(provider_cost,(SELECT o.provider_usd_micros FROM tholi.inference_outcomes o WHERE o.reservation_id=held.id)),
    charged_credits=credit_charge,provider_request_id=provider_request,usage_details=details,updated_at=clock_timestamp()
    WHERE id=held.id;
END $$;

CREATE OR REPLACE FUNCTION tholi.record_inference_outcome(target uuid,token uuid,finished_resolution text,finished_outcome text,
  input_count bigint,output_count bigint,provider_cost bigint,credit_charge bigint,provider_request text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT tholi.record_inference_outcome(target,token,finished_resolution,finished_outcome,input_count,output_count,
    provider_cost,credit_charge,provider_request,tholi.inference_outcome_details(target,token))
$$;

CREATE OR REPLACE FUNCTION tholi.finish_inference(target uuid,token uuid,finished_resolution text,finished_outcome text,
  input_count bigint,output_count bigint,provider_cost bigint,credit_charge bigint,provider_request text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT tholi.finish_inference(target,token,finished_resolution,finished_outcome,input_count,output_count,
    provider_cost,credit_charge,provider_request,tholi.inference_outcome_details(target,token))
$$;

DROP FUNCTION tholi.inference_usage(uuid,uuid);
CREATE FUNCTION tholi.inference_usage(target uuid,token uuid)
RETURNS TABLE(id uuid,"requestId" uuid,provider text,model text,"inputUnits" text,"outputUnits" text,
  "providerUsdMicros" text,"chargedCredits" text,"policyVersion" text,"createdAt" timestamptz,
  "fundingSource" text,"usageVersion" integer,"customerUsdMicros" text,
  "cacheReadInputUnits" text,"cacheWriteInputUnits" text,"reasoningOutputUnits" text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT FROM tholi.inference_reservations r WHERE r.id=target AND r.claim_token=token) THEN
    RAISE EXCEPTION 'The accounting capability is unavailable.' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT u.id,u.request_id,u.provider,u.model,
    CASE WHEN r.resolution='unknown' THEN NULL ELSE u.input_units::text END,
    CASE WHEN r.resolution='unknown' THEN NULL ELSE u.output_units::text END,
    u.provider_usd_micros::text,u.charged_credits::text,u.policy_version,u.created_at,u.funding_source,
    (u.usage_details->>'version')::integer,u.usage_details->>'customerUsdMicros',u.usage_details->>'cacheReadInputUnits',
    u.usage_details->>'cacheWriteInputUnits',u.usage_details->>'reasoningOutputUnits'
    FROM tholi.usage_records u JOIN tholi.inference_reservations r
      ON r.workspace_id=u.workspace_id AND r.request_id=u.request_id WHERE r.id=target AND r.claim_token=token;
END $$;

ALTER TABLE tholi.usage_records ADD CHECK(tholi.valid_inference_usage_details(usage_details,input_units,output_units,funding_source));
ALTER TABLE tholi.usage_records ADD CHECK(funding_source<>'customer' OR (provider_usd_micros=0 AND charged_credits=0));

REVOKE ALL ON FUNCTION tholi.valid_inference_usage_details(jsonb,bigint,bigint,text),
  tholi.inference_outcome_details(uuid,uuid),tholi.reserve_inference(uuid,uuid,text,timestamptz,jsonb),
  tholi.record_inference_outcome(uuid,uuid,text,text,bigint,bigint,bigint,bigint,text,jsonb),
  tholi.finish_inference(uuid,uuid,text,text,bigint,bigint,bigint,bigint,text,jsonb),
  tholi.inference_usage(uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION tholi.check_product_inference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE effective jsonb; caps jsonb; original_caps jsonb; p tholi.inference_policy_versions%ROWTYPE;
  period_start timestamptz; in_period bigint; in_minute bigint; in_journey bigint;
BEGIN
  IF NEW.funding_source='customer' THEN RETURN NEW; END IF;
  effective:=tholi.effective_product_plan_internal(NEW.account_id,NEW.workspace_id);
  IF effective IS NULL THEN RETURN NEW; END IF;
  IF effective->>'status'<>'active' THEN
    RAISE EXCEPTION 'The product plan is inactive; account data remains accessible.' USING ERRCODE='P4401'; END IF;
  caps:=effective->'caps'; period_start:=(effective->>'periodStart')::timestamptz;
  SELECT * INTO STRICT p FROM tholi.inference_policy_versions WHERE version=NEW.policy_version;
  IF p.provider<>'fake' OR p.model<>'tholi-deterministic-v1' OR NEW.max_provider_usd_micros>(caps->>'maxProviderCostUsdMicros')::bigint THEN
    RAISE EXCEPTION 'This model is unavailable on the product plan.' USING ERRCODE='P4401'; END IF;
  IF TG_OP='INSERT' THEN NEW.plan_snapshot:=effective;
  ELSE
    original_caps:=COALESCE(OLD.plan_snapshot->'caps',jsonb_build_object(
      'maxInputTokens',p.max_input_units,'maxOutputTokens',p.max_output_units,'maxImages',p.max_images,
      'maxDecisionsPerJourney',p.max_journey_requests));
    IF (original_caps->>'maxInputTokens')::integer>(caps->>'maxInputTokens')::integer
      OR (original_caps->>'maxOutputTokens')::integer>(caps->>'maxOutputTokens')::integer
      OR (original_caps->>'maxImages')::integer>(caps->>'maxImages')::integer
      OR (original_caps->>'maxDecisionsPerJourney')::integer>(caps->>'maxDecisionsPerJourney')::integer THEN
      RAISE EXCEPTION 'The admitted plan ceilings no longer fit the current plan.' USING ERRCODE='P4401'; END IF;
  END IF;
  SELECT count(*) FILTER(WHERE r.created_at>=period_start),
    count(*) FILTER(WHERE r.created_at>clock_timestamp()-interval '1 minute'),
    count(*) FILTER(WHERE r.journey_id=NEW.journey_id)
    INTO in_period,in_minute,in_journey FROM tholi.inference_reservations r
    WHERE r.account_id=NEW.account_id AND r.id<>NEW.id;
  IF in_period+1>(caps->>'requestsPerPeriod')::integer OR in_minute+1>(caps->>'requestsPerMinute')::integer
    OR in_journey+1>(caps->>'maxDecisionsPerJourney')::integer THEN
    RAISE EXCEPTION 'The current product allowance is exhausted.' USING ERRCODE='P4401'; END IF;
  RETURN NEW;
END $$;
`;
