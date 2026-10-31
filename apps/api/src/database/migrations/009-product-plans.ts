/** Frozen migration data; runtime catalog reads always use the selected database release. */
export const productCatalogSeed = {
  version: 1,
  catalogVersion: "2026-10-offline-v1",
  environment: "development",
  chargingPolicyVersion: "fake-development-v1",
  plans: [
    {
      id: "local",
      version: 1,
      name: "Local",
      mode: "local",
      requiresAccount: false,
      availability: { available: true, reason: "available" },
      pricing: { status: "free", amount: "0" },
      productionAllowance: null,
      developmentAllowance: null,
    },
    {
      id: "free-cloud",
      version: 1,
      name: "Free Cloud",
      mode: "free-cloud",
      requiresAccount: true,
      availability: { available: true, reason: "development-fixture" },
      pricing: { status: "free", amount: "0" },
      productionAllowance: null,
      developmentAllowance: {
        programId: "tholi-free-development",
        amount: "6",
        periodSeconds: 86400,
        expiresAtPeriodEnd: true,
        rollover: false,
        caps: {
          maxInputTokens: 8192,
          maxOutputTokens: 512,
          maxImages: 1,
          maxRetries: 0,
          maxDecisionsPerJourney: 2,
          requestsPerPeriod: 6,
          requestsPerMinute: 2,
          maxSavedArtifacts: 20,
          maxSavedArtifactBytes: "16384",
          maxStoredBytes: "131072",
          maxProviderCostUsdMicros: "0",
          maxForegroundDecisions: 1,
        },
      },
    },
    {
      id: "paid-cloud",
      version: 1,
      name: "Paid cloud",
      mode: "paid",
      requiresAccount: true,
      availability: { available: false, reason: "billing-not-enabled" },
      pricing: { status: "unpublished", amount: null },
      productionAllowance: null,
      developmentAllowance: null,
    },
    {
      id: "team-cloud",
      version: 1,
      name: "Team cloud",
      mode: "paid",
      requiresAccount: true,
      availability: { available: false, reason: "billing-not-enabled" },
      pricing: { status: "unpublished", amount: null },
      productionAllowance: null,
      developmentAllowance: null,
    },
  ],
} as const;

export const productPlans = `
CREATE TABLE tholi.product_catalog_releases (
  version text PRIMARY KEY CHECK(length(version) BETWEEN 1 AND 100),
  charging_policy_version text NOT NULL REFERENCES tholi.inference_policy_versions(version),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX product_catalog_charging_idx ON tholi.product_catalog_releases(charging_policy_version);
CREATE TABLE tholi.product_catalog_entries (
  catalog_version text NOT NULL REFERENCES tholi.product_catalog_releases(version),
  plan_id text NOT NULL,
  plan_version integer NOT NULL,
  position integer NOT NULL CHECK(position BETWEEN 0 AND 7),
  PRIMARY KEY(catalog_version,plan_id),
  UNIQUE(catalog_version,position),
  FOREIGN KEY(plan_id,plan_version) REFERENCES tholi.plan_versions(plan_id,version)
);
CREATE INDEX product_catalog_plan_idx ON tholi.product_catalog_entries(plan_id,plan_version);
CREATE TABLE tholi.product_catalog_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  current_version text NOT NULL REFERENCES tholi.product_catalog_releases(version)
);
CREATE INDEX product_catalog_current_idx ON tholi.product_catalog_control(current_version);
CREATE TABLE tholi.free_programs (
  id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 100),
  period_seconds integer NOT NULL CHECK(period_seconds BETWEEN 60 AND 2678400)
);
CREATE TABLE tholi.free_program_enrollments (
  account_id uuid NOT NULL REFERENCES tholi.accounts(id),
  program_id text NOT NULL REFERENCES tholi.free_programs(id),
  workspace_id uuid NOT NULL,
  entitlement_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,program_id),
  UNIQUE(account_id),
  FOREIGN KEY(workspace_id,entitlement_id) REFERENCES tholi.entitlements(workspace_id,id),
  FOREIGN KEY(workspace_id,account_id) REFERENCES tholi.memberships(workspace_id,account_id)
);
CREATE INDEX free_program_enrollment_entitlement_idx ON tholi.free_program_enrollments(workspace_id,entitlement_id);
CREATE INDEX free_program_enrollment_program_idx ON tholi.free_program_enrollments(program_id);
CREATE TABLE tholi.free_program_grants (
  account_id uuid NOT NULL,
  program_id text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL CHECK(period_end>period_start),
  workspace_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  catalog_version text NOT NULL REFERENCES tholi.product_catalog_releases(version),
  plan_id text NOT NULL,
  plan_version integer NOT NULL,
  PRIMARY KEY(account_id,program_id,period_start),
  UNIQUE(workspace_id,grant_id),
  FOREIGN KEY(account_id,program_id) REFERENCES tholi.free_program_enrollments(account_id,program_id),
  FOREIGN KEY(workspace_id,grant_id) REFERENCES tholi.credit_grants(workspace_id,id),
  FOREIGN KEY(plan_id,plan_version) REFERENCES tholi.plan_versions(plan_id,version)
);
CREATE INDEX free_program_grant_catalog_idx ON tholi.free_program_grants(catalog_version);
CREATE INDEX free_program_grant_plan_idx ON tholi.free_program_grants(plan_id,plan_version);

DO $$ DECLARE plan jsonb; existing tholi.plan_versions%ROWTYPE; BEGIN
  FOR plan IN SELECT value FROM jsonb_array_elements('${JSON.stringify(productCatalogSeed.plans)}'::jsonb) LOOP
    INSERT INTO tholi.plan_versions(plan_id,version,name,definition)
      VALUES(plan->>'id',(plan->>'version')::integer,plan->>'name',plan) ON CONFLICT DO NOTHING;
    SELECT * INTO STRICT existing FROM tholi.plan_versions p WHERE p.plan_id=plan->>'id' AND p.version=(plan->>'version')::integer;
    IF existing.name IS DISTINCT FROM plan->>'name' OR existing.definition IS DISTINCT FROM plan THEN
      RAISE EXCEPTION 'A legacy plan conflicts with the product catalog; repair explicitly.' USING ERRCODE='23514'; END IF;
  END LOOP;
END $$;
INSERT INTO tholi.product_catalog_releases(version,charging_policy_version)
  VALUES('${productCatalogSeed.catalogVersion}','${productCatalogSeed.chargingPolicyVersion}');
INSERT INTO tholi.product_catalog_entries(catalog_version,plan_id,plan_version,position)
  VALUES ${productCatalogSeed.plans.map((plan, index) => `('${productCatalogSeed.catalogVersion}','${plan.id}',${plan.version},${index})`).join(",")};
INSERT INTO tholi.product_catalog_control(current_version) VALUES('${productCatalogSeed.catalogVersion}');
INSERT INTO tholi.free_programs(id,period_seconds) VALUES('tholi-free-development',86400);

CREATE TRIGGER product_catalog_release_immutable BEFORE UPDATE OR DELETE ON tholi.product_catalog_releases
  FOR EACH ROW EXECUTE FUNCTION tholi.guard_inference_policy();
CREATE TRIGGER product_catalog_entry_immutable BEFORE UPDATE OR DELETE ON tholi.product_catalog_entries
  FOR EACH ROW EXECUTE FUNCTION tholi.guard_inference_policy();
CREATE TRIGGER free_program_immutable BEFORE UPDATE OR DELETE ON tholi.free_programs
  FOR EACH ROW EXECUTE FUNCTION tholi.guard_inference_policy();
CREATE FUNCTION tholi.guard_product_plan_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF EXISTS(SELECT FROM tholi.product_catalog_entries e WHERE e.plan_id=OLD.plan_id AND e.plan_version=OLD.version) THEN
    RAISE EXCEPTION 'Publish a new product plan version instead of editing one.' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_plan_version_immutable BEFORE UPDATE OR DELETE ON tholi.plan_versions
  FOR EACH ROW EXECUTE FUNCTION tholi.guard_product_plan_version();

CREATE FUNCTION tholi.read_product_catalog() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('version',1,'catalogVersion',r.version,'environment','development',
    'chargingPolicyVersion',r.charging_policy_version,'plans',jsonb_agg(p.definition ORDER BY e.position))
  FROM tholi.product_catalog_control c JOIN tholi.product_catalog_releases r ON r.version=c.current_version
    JOIN tholi.product_catalog_entries e ON e.catalog_version=r.version
    JOIN tholi.plan_versions p ON p.plan_id=e.plan_id AND p.version=e.plan_version
  WHERE c.singleton GROUP BY r.version,r.charging_policy_version
$$;

CREATE FUNCTION tholi.minimum_product_caps(left_caps jsonb,right_caps jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_object_agg(item.key,CASE WHEN jsonb_typeof(item.value)='string'
    THEN to_jsonb(LEAST((item.value#>>'{}')::numeric,(right_caps->>item.key)::numeric)::text)
    ELSE to_jsonb(LEAST((item.value#>>'{}')::numeric,(right_caps->>item.key)::numeric)) END)
  FROM jsonb_each(left_caps) item
$$;

CREATE FUNCTION tholi.effective_product_plan_internal(actor uuid,workspace uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE enrollment tholi.free_program_enrollments%ROWTYPE; entitlement tholi.entitlements%ROWTYPE;
  catalog jsonb; selected jsonb; entitled jsonb; allowance jsonb; caps jsonb;
  seconds integer; started timestamptz; ended timestamptz; current_at timestamptz:=clock_timestamp(); active boolean:=false;
BEGIN
  SELECT * INTO enrollment FROM tholi.free_program_enrollments f WHERE f.account_id=actor;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT period_seconds INTO STRICT seconds FROM tholi.free_programs WHERE id=enrollment.program_id;
  started:=to_timestamp(floor(extract(epoch FROM current_at)/seconds)*seconds); ended:=started+seconds*interval '1 second';
  catalog:=tholi.read_product_catalog();
  SELECT p INTO selected FROM jsonb_array_elements(catalog->'plans') p WHERE p->>'mode'='free-cloud';
  SELECT * INTO STRICT entitlement FROM tholi.entitlements e WHERE e.workspace_id=enrollment.workspace_id AND e.id=enrollment.entitlement_id;
  SELECT p.definition INTO STRICT entitled FROM tholi.plan_versions p WHERE p.plan_id=entitlement.plan_id AND p.version=entitlement.plan_version;
  allowance:=selected->'developmentAllowance';
  active:=enrollment.workspace_id=workspace AND entitlement.status='active' AND entitlement.starts_at<=current_at
    AND (entitlement.ends_at IS NULL OR entitlement.ends_at>current_at)
    AND selected->'availability'->>'available'='true' AND entitled->>'mode'='free-cloud'
    AND allowance->>'programId'=enrollment.program_id
    AND entitled->'developmentAllowance'->>'programId'=enrollment.program_id
    AND (allowance->>'periodSeconds')::integer=seconds
    AND EXISTS(SELECT FROM tholi.free_program_grants g WHERE g.account_id=actor AND g.program_id=enrollment.program_id
      AND g.period_start=started AND g.workspace_id=workspace);
  IF active THEN caps:=tholi.minimum_product_caps(allowance->'caps',entitled->'developmentAllowance'->'caps'); END IF;
  RETURN jsonb_build_object('catalogVersion',catalog->>'catalogVersion','planId',entitlement.plan_id,
    'planVersion',entitlement.plan_version,'status',CASE WHEN active THEN 'active' ELSE 'inactive' END,
    'periodStart',started,'periodEnd',ended,'caps',caps);
END $$;

CREATE FUNCTION tholi.read_effective_product_plan() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF tholi.current_member_role(tholi.actor_workspace_id()) IS NULL THEN
    RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE='42501'; END IF;
  RETURN tholi.effective_product_plan_internal(tholi.actor_account_id(),tholi.actor_workspace_id());
END $$;

CREATE FUNCTION tholi.enroll_free_internal(actor uuid,workspace uuid,explicit_choice boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE catalog jsonb; selected jsonb; allowance jsonb; enrollment tholi.free_program_enrollments%ROWTYPE;
  entitlement tholi.entitlements%ROWTYPE; claim tholi.free_program_grants%ROWTYPE; grant_row tholi.credit_grants%ROWTYPE;
  program text; seconds integer; started timestamptz; ended timestamptz; now_at timestamptz;
  entitlement_id uuid:=gen_random_uuid(); grant_id uuid:=gen_random_uuid(); replayed boolean:=false;
BEGIN
  PERFORM 1 FROM tholi.inference_control WHERE singleton FOR UPDATE;
  PERFORM 1 FROM tholi.accounts a WHERE a.id=actor AND a.status='active' FOR UPDATE;
  IF NOT FOUND THEN
    IF NOT explicit_choice THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'The active account is unavailable.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM tholi.workspaces w JOIN tholi.memberships m ON m.workspace_id=w.id AND m.account_id=actor
    WHERE w.id=workspace AND w.kind='personal' AND w.owner_account_id=actor AND m.role='owner' AND m.status='active'
    FOR UPDATE OF w;
  IF NOT FOUND THEN
    IF NOT explicit_choice THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'Free enrollment requires the personal workspace owner.' USING ERRCODE='42501'; END IF;
  catalog:=tholi.read_product_catalog();
  SELECT p INTO selected FROM jsonb_array_elements(catalog->'plans') p WHERE p->>'mode'='free-cloud';
  allowance:=selected->'developmentAllowance'; program:=allowance->>'programId';
  SELECT period_seconds INTO seconds FROM tholi.free_programs WHERE id=program;
  IF selected->'availability'->>'available' IS DISTINCT FROM 'true' OR seconds IS NULL
      OR (allowance->>'periodSeconds')::integer IS DISTINCT FROM seconds OR (allowance->>'amount')::bigint<=0 THEN
    RAISE EXCEPTION 'This Free program is unavailable.' USING ERRCODE='P4403'; END IF;
  now_at:=clock_timestamp();
  started:=to_timestamp(floor(extract(epoch FROM now_at)/seconds)*seconds); ended:=started+seconds*interval '1 second';
  SELECT * INTO enrollment FROM tholi.free_program_enrollments f WHERE f.account_id=actor;
  IF FOUND THEN
    IF enrollment.program_id<>program OR enrollment.workspace_id<>workspace THEN
      RAISE EXCEPTION 'An account Free program cannot reset through another workspace or catalog.' USING ERRCODE='P4403'; END IF;
    entitlement_id:=enrollment.entitlement_id;
    SELECT * INTO STRICT entitlement FROM tholi.entitlements e WHERE e.workspace_id=workspace AND e.id=entitlement_id;
    IF entitlement.status='suspended' OR (NOT explicit_choice AND entitlement.status<>'active') THEN
      IF NOT explicit_choice THEN RETURN NULL; END IF;
      RAISE EXCEPTION 'The Free entitlement is suspended.' USING ERRCODE='42501'; END IF;
    UPDATE tholi.entitlements e SET plan_id=selected->>'id',plan_version=(selected->>'version')::integer,status='active',
      starts_at=started,ends_at=ended,revision=revision+1,updated_at=clock_timestamp()
      WHERE e.workspace_id=workspace AND e.id=entitlement_id AND
        (e.plan_id,e.plan_version,e.status,e.starts_at,e.ends_at) IS DISTINCT FROM
        (selected->>'id',(selected->>'version')::integer,'active'::text,started,ended);
  ELSE
    IF NOT explicit_choice THEN RETURN NULL; END IF;
    INSERT INTO tholi.entitlements(workspace_id,id,plan_id,plan_version,status,starts_at,ends_at)
      VALUES(workspace,entitlement_id,selected->>'id',(selected->>'version')::integer,'active',started,ended);
    INSERT INTO tholi.free_program_enrollments(account_id,program_id,workspace_id,entitlement_id)
      VALUES(actor,program,workspace,entitlement_id);
  END IF;
  SELECT * INTO claim FROM tholi.free_program_grants g WHERE g.account_id=actor AND g.program_id=program AND g.period_start=started;
  IF FOUND THEN
    replayed:=true;
    SELECT * INTO STRICT grant_row FROM tholi.credit_grants g WHERE g.workspace_id=claim.workspace_id AND g.id=claim.grant_id;
  ELSE
    INSERT INTO tholi.credit_grants(workspace_id,id,idempotency_key,amount,expires_at,source,period_start,period_end,policy_version)
      VALUES(workspace,grant_id,'free:'||actor::text||':'||program||':'||extract(epoch FROM started)::bigint::text,
        (allowance->>'amount')::bigint,ended,'free',started,ended,catalog->>'catalogVersion') RETURNING * INTO grant_row;
    INSERT INTO tholi.free_program_grants(account_id,program_id,period_start,period_end,workspace_id,grant_id,
        catalog_version,plan_id,plan_version)
      VALUES(actor,program,started,ended,workspace,grant_id,catalog->>'catalogVersion',selected->>'id',(selected->>'version')::integer);
  END IF;
  RETURN jsonb_build_object('effective',tholi.effective_product_plan_internal(actor,workspace),
    'grant',jsonb_build_object('id',grant_row.id,'amount',grant_row.amount::text,'expiresAt',grant_row.expires_at),'replayed',replayed);
END $$;

CREATE FUNCTION tholi.enroll_free() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  RETURN tholi.enroll_free_internal(tholi.actor_account_id(),tholi.actor_workspace_id(),true);
END $$;

CREATE FUNCTION tholi.refill_free_plans(batch integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate record; refilled integer:=0; result jsonb;
BEGIN
  IF batch IS NULL OR batch NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Use a bounded Free refill batch.' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM tholi.inference_control WHERE singleton FOR UPDATE;
  FOR candidate IN SELECT f.account_id,f.workspace_id FROM tholi.free_program_enrollments f
    JOIN tholi.entitlements e ON e.workspace_id=f.workspace_id AND e.id=f.entitlement_id
    JOIN tholi.accounts a ON a.id=f.account_id
    WHERE e.status='active' AND e.ends_at<=clock_timestamp() AND a.status='active'
    ORDER BY e.ends_at,f.account_id LIMIT batch LOOP
    result:=tholi.enroll_free_internal(candidate.account_id,candidate.workspace_id,false);
    IF result IS NOT NULL AND result->>'replayed'='false' THEN refilled:=refilled+1; END IF;
  END LOOP;
  RETURN refilled;
END $$;

ALTER TABLE tholi.inference_reservations ADD COLUMN plan_snapshot jsonb;
CREATE FUNCTION tholi.check_product_inference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE effective jsonb; caps jsonb; original_caps jsonb; p tholi.inference_policy_versions%ROWTYPE;
  period_start timestamptz; in_period bigint; in_minute bigint; in_journey bigint;
BEGIN
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
CREATE TRIGGER product_inference_admission BEFORE INSERT ON tholi.inference_reservations
  FOR EACH ROW EXECUTE FUNCTION tholi.check_product_inference();
CREATE TRIGGER product_inference_dispatch BEFORE UPDATE OF state ON tholi.inference_reservations
  FOR EACH ROW WHEN(OLD.state='reserved' AND NEW.state='dispatched') EXECUTE FUNCTION tholi.check_product_inference();

CREATE FUNCTION tholi.check_product_storage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE effective jsonb; caps jsonb; old_bytes bigint:=0; new_bytes bigint; stored_bytes bigint; stored_count bigint;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.content IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN old_bytes:=COALESCE(octet_length(OLD.content::text),0); END IF;
  new_bytes:=octet_length(NEW.content::text);
  -- Downgrades never prevent deletion, export, or an update that reduces data.
  IF TG_OP='UPDATE' AND new_bytes<=old_bytes THEN RETURN NEW; END IF;
  PERFORM 1 FROM tholi.accounts WHERE id=NEW.owner_account_id FOR UPDATE;
  effective:=tholi.effective_product_plan_internal(NEW.owner_account_id,NEW.workspace_id);
  IF effective IS NULL THEN RETURN NEW; END IF;
  IF effective->>'status'<>'active' THEN
    RAISE EXCEPTION 'The product plan does not permit storage growth.' USING ERRCODE='P4401'; END IF;
  caps:=effective->'caps';
  SELECT count(*),COALESCE(sum(octet_length(a.content::text)),0) INTO stored_count,stored_bytes
    FROM tholi.saved_artifacts a WHERE a.owner_account_id=NEW.owner_account_id AND a.deleted_at IS NULL;
  IF stored_count+(CASE WHEN TG_OP='INSERT' THEN 1 ELSE 0 END)>(caps->>'maxSavedArtifacts')::bigint
    OR new_bytes>(caps->>'maxSavedArtifactBytes')::bigint
    OR stored_bytes-old_bytes+new_bytes>(caps->>'maxStoredBytes')::bigint THEN
    RAISE EXCEPTION 'The product storage allowance is exhausted.' USING ERRCODE='P4401'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_saved_artifact_limits BEFORE INSERT OR UPDATE OF content ON tholi.saved_artifacts
  FOR EACH ROW EXECUTE FUNCTION tholi.check_product_storage();

ALTER TABLE tholi.free_program_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY free_enrollment_actor ON tholi.free_program_enrollments FOR SELECT
  USING(account_id=tholi.actor_account_id());
ALTER TABLE tholi.free_program_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY free_grant_actor ON tholi.free_program_grants FOR SELECT USING(account_id=tholi.actor_account_id());
REVOKE ALL ON FUNCTION tholi.read_product_catalog(),tholi.minimum_product_caps(jsonb,jsonb),
  tholi.effective_product_plan_internal(uuid,uuid),tholi.read_effective_product_plan(),
  tholi.enroll_free_internal(uuid,uuid,boolean),tholi.enroll_free(),tholi.refill_free_plans(integer),
  tholi.check_product_inference(),tholi.check_product_storage(),tholi.guard_product_plan_version() FROM PUBLIC;
`;
