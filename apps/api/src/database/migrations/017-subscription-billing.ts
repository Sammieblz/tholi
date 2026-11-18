// Frozen development fixtures once this migration is applied. No commercial offer.
const fixtureCaps = {
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
} as const;
export const billingCatalogSeed = {
  version: 2,
  catalogVersion: "2026-11-offline-billing-v2",
  chargingPolicyVersion: "fake-development-v1",
  paidPlans: [
    { id: "paid-cloud", name: "Paid Cloud", price: "price_tholiPaidFixture" },
    { id: "team-cloud", name: "Team Cloud", price: "price_tholiTeamFixture" },
  ].map((entry) => ({
    id: entry.id,
    version: 2,
    name: entry.name,
    mode: "paid",
    requiresAccount: true,
    availability: { available: true, reason: "development-fixture" },
    pricing: {
      status: "development-fixture",
      amountMinor: "100",
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      providerPriceId: entry.price,
    },
    productionAllowance: null,
    developmentAllowance: {
      programId: "tholi-billing-development",
      amount: "6",
      period: "invoice",
      expiresAtPeriodEnd: true,
      rollover: false,
      caps: fixtureCaps,
    },
    billing: { source: "fake", policyVersion: "offline-billing-v1" },
  })),
} as const;

// Additive storage and negotiated reads only. Financial execution is composed separately.
export const subscriptionBilling = `
ALTER TABLE tholi.product_catalog_releases ADD COLUMN contract_version smallint NOT NULL DEFAULT 1
  CHECK(contract_version IN(1,2));
ALTER TABLE tholi.product_catalog_control ADD COLUMN current_version_2 text
  REFERENCES tholi.product_catalog_releases(version);
ALTER TABLE tholi.product_catalog_entries ADD CONSTRAINT product_catalog_plan_version_key
  UNIQUE(catalog_version,plan_id,plan_version);
DO $$ DECLARE plan jsonb; BEGIN
  FOR plan IN SELECT value FROM jsonb_array_elements('${JSON.stringify(billingCatalogSeed.paidPlans)}'::jsonb) LOOP
    INSERT INTO tholi.plan_versions(plan_id,version,name,definition)
      VALUES(plan->>'id',(plan->>'version')::integer,plan->>'name',plan);
  END LOOP;
END $$;
INSERT INTO tholi.product_catalog_releases(version,charging_policy_version,contract_version)
  VALUES('${billingCatalogSeed.catalogVersion}','${billingCatalogSeed.chargingPolicyVersion}',2);
INSERT INTO tholi.product_catalog_entries(catalog_version,plan_id,plan_version,position) VALUES
  ('${billingCatalogSeed.catalogVersion}','local',1,0),
  ('${billingCatalogSeed.catalogVersion}','free-cloud',1,1),
  ('${billingCatalogSeed.catalogVersion}','paid-cloud',2,2),
  ('${billingCatalogSeed.catalogVersion}','team-cloud',2,3);
UPDATE tholi.product_catalog_control SET current_version_2='${billingCatalogSeed.catalogVersion}' WHERE singleton;

-- Existing no-argument reads and their immutable version-1 plans are unchanged.
CREATE FUNCTION tholi.read_product_catalog(schema_version integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  IF schema_version=1 THEN RETURN tholi.read_product_catalog(); END IF;
  IF schema_version<>2 THEN RAISE EXCEPTION 'Unsupported catalog view.' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object('version',2,'catalogVersion',r.version,'environment','development',
    'chargingPolicyVersion',r.charging_policy_version,
    'plans',jsonb_agg(p.definition||jsonb_build_object('billing',p.definition->'billing') ORDER BY e.position))
    INTO result
  FROM tholi.product_catalog_control c JOIN tholi.product_catalog_releases r ON r.version=c.current_version_2
    JOIN tholi.product_catalog_entries e ON e.catalog_version=r.version
    JOIN tholi.plan_versions p ON p.plan_id=e.plan_id AND p.version=e.plan_version
  WHERE c.singleton AND r.contract_version=2 GROUP BY r.version,r.charging_policy_version;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION tholi.read_product_catalog(integer) FROM PUBLIC;

-- Private financial provenance. HTTP composition remains unavailable until lifecycle integration.
-- Ledger rows remain in credit_grants/reservations/events; this is financial provenance.
CREATE TABLE tholi.billing_workspaces (
  workspace_id uuid PRIMARY KEY REFERENCES tholi.workspaces(id),
  account_id uuid NOT NULL REFERENCES tholi.accounts(id),
  mode text NOT NULL CHECK(mode IN('fake','stripe-test','stripe-live')),
  merchant_id text NOT NULL CHECK(length(merchant_id) BETWEEN 1 AND 128),
  profile_id text NOT NULL CHECK(length(profile_id) BETWEEN 1 AND 100),
  profile_revision bigint NOT NULL CHECK(profile_revision>0),
  profile_digest bytea NOT NULL CHECK(octet_length(profile_digest)=32),
  provider_customer_id text CHECK(provider_customer_id ~ '^cus_[A-Za-z0-9_]{1,120}$'),
  selected_subscription_id uuid,
  managed_spending_held boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(workspace_id,account_id) REFERENCES tholi.memberships(workspace_id,account_id),
  UNIQUE(workspace_id,mode,merchant_id),
  UNIQUE(mode,merchant_id,provider_customer_id)
);
CREATE INDEX billing_workspace_actor_idx ON tholi.billing_workspaces(account_id,workspace_id);

CREATE TABLE tholi.billing_subscriptions (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  mode text NOT NULL,
  merchant_id text NOT NULL,
  provider_subscription_id text NOT NULL CHECK(provider_subscription_id ~ '^sub_[A-Za-z0-9_]{1,120}$'),
  plan_id text NOT NULL,
  plan_version integer NOT NULL,
  catalog_version text NOT NULL,
  entitlement_id uuid NOT NULL,
  status text NOT NULL CHECK(status IN('pending','active','past-due','ended','review','uncertain')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL CHECK(period_end>period_start),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,id),
  UNIQUE(mode,merchant_id,provider_subscription_id),
  FOREIGN KEY(workspace_id,mode,merchant_id) REFERENCES tholi.billing_workspaces(workspace_id,mode,merchant_id),
  FOREIGN KEY(catalog_version,plan_id,plan_version)
    REFERENCES tholi.product_catalog_entries(catalog_version,plan_id,plan_version),
  FOREIGN KEY(workspace_id,entitlement_id) REFERENCES tholi.entitlements(workspace_id,id)
);
CREATE INDEX billing_subscription_catalog_idx ON tholi.billing_subscriptions(catalog_version,plan_id,plan_version);
CREATE INDEX billing_subscription_entitlement_idx ON tholi.billing_subscriptions(workspace_id,entitlement_id);
ALTER TABLE tholi.billing_workspaces ADD CONSTRAINT billing_selected_subscription
  FOREIGN KEY(workspace_id,selected_subscription_id) REFERENCES tholi.billing_subscriptions(workspace_id,id);

CREATE TABLE tholi.billing_operations (
  workspace_id uuid NOT NULL REFERENCES tholi.billing_workspaces(workspace_id),
  id uuid NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES tholi.accounts(id),
  client_operation_id uuid NOT NULL,
  initiating_session_id uuid NOT NULL REFERENCES tholi.sessions(id),
  request_id uuid NOT NULL,
  job_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN('checkout','portal','cancel','expire','cancel-immediate')),
  mandatory boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
    CHECK(status IN('pending','ready','completed','cancelled','rejected','uncertain')),
  plan_id text,
  plan_version integer,
  catalog_version text,
  profile_revision bigint NOT NULL CHECK(profile_revision>0),
  profile_digest bytea NOT NULL CHECK(octet_length(profile_digest)=32),
  command_hash bytea NOT NULL CHECK(octet_length(command_hash)=32),
  target_operation_id uuid,
  subscription_id uuid,
  provider_object_id text CHECK(provider_object_id ~ '^(cs|bps)_[A-Za-z0-9_]{1,120}$'),
  provider_expires_at timestamptz,
  link_expires_at timestamptz NOT NULL,
  sealed_link jsonb CHECK(sealed_link IS NULL OR tholi.valid_sealed_provider_key(sealed_link)),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,id),
  UNIQUE(workspace_id,account_id,client_operation_id),
  UNIQUE(workspace_id,request_id),
  UNIQUE(workspace_id,job_id),
  FOREIGN KEY(workspace_id,account_id) REFERENCES tholi.memberships(workspace_id,account_id),
  FOREIGN KEY(workspace_id,request_id,account_id) REFERENCES tholi.requests(workspace_id,id,account_id),
  FOREIGN KEY(workspace_id,job_id,account_id) REFERENCES tholi.jobs(workspace_id,id,account_id),
  FOREIGN KEY(catalog_version,plan_id,plan_version)
    REFERENCES tholi.product_catalog_entries(catalog_version,plan_id,plan_version) MATCH FULL,
  FOREIGN KEY(workspace_id,target_operation_id) REFERENCES tholi.billing_operations(workspace_id,id),
  FOREIGN KEY(workspace_id,subscription_id) REFERENCES tholi.billing_subscriptions(workspace_id,id),
  CHECK((plan_id IS NULL)=(plan_version IS NULL)),
  CHECK((kind='checkout' AND plan_id IS NOT NULL AND plan_version IS NOT NULL AND catalog_version IS NOT NULL)
     OR (kind<>'checkout' AND plan_id IS NULL AND plan_version IS NULL AND catalog_version IS NULL)),
  CHECK((kind='expire')=(target_operation_id IS NOT NULL)),
  CHECK(kind NOT IN('cancel','cancel-immediate') OR subscription_id IS NOT NULL),
  CHECK(NOT mandatory OR kind IN('expire','cancel-immediate')),
  CHECK(sealed_link IS NULL OR status='ready'),
  CHECK(isfinite(link_expires_at) AND link_expires_at>created_at
    AND link_expires_at<=created_at+interval '5 minutes')
);
CREATE INDEX billing_operation_session_idx ON tholi.billing_operations(initiating_session_id);
CREATE INDEX billing_operation_actor_idx ON tholi.billing_operations(account_id,workspace_id,id);
CREATE INDEX billing_operation_catalog_idx ON tholi.billing_operations(catalog_version,plan_id,plan_version);
CREATE INDEX billing_operation_target_idx ON tholi.billing_operations(workspace_id,target_operation_id);
CREATE INDEX billing_operation_subscription_idx ON tholi.billing_operations(workspace_id,subscription_id);
CREATE UNIQUE INDEX billing_checkout_pending_idx ON tholi.billing_operations(workspace_id)
  WHERE kind='checkout' AND status IN('pending','ready','uncertain');
CREATE INDEX billing_link_expiry_idx ON tholi.billing_operations(link_expires_at,workspace_id,id)
  WHERE sealed_link IS NOT NULL;

CREATE TABLE tholi.billing_invoices (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  mode text NOT NULL,
  merchant_id text NOT NULL,
  provider_invoice_id text NOT NULL CHECK(provider_invoice_id ~ '^in_[A-Za-z0-9_]{1,120}$'),
  subscription_id uuid NOT NULL,
  plan_id text NOT NULL,
  plan_version integer NOT NULL,
  catalog_version text NOT NULL,
  status text NOT NULL CHECK(status IN('draft','open','paid','void','uncollectible','review')),
  amount_paid_minor bigint NOT NULL CHECK(amount_paid_minor>=0),
  currency text NOT NULL CHECK(currency ~ '^[a-z]{3}$'),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL CHECK(period_end>period_start),
  issued_at timestamptz NOT NULL,
  grant_id uuid,
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,id),
  UNIQUE(mode,merchant_id,provider_invoice_id),
  FOREIGN KEY(workspace_id,mode,merchant_id) REFERENCES tholi.billing_workspaces(workspace_id,mode,merchant_id),
  FOREIGN KEY(workspace_id,subscription_id) REFERENCES tholi.billing_subscriptions(workspace_id,id),
  FOREIGN KEY(catalog_version,plan_id,plan_version)
    REFERENCES tholi.product_catalog_entries(catalog_version,plan_id,plan_version),
  FOREIGN KEY(workspace_id,grant_id) REFERENCES tholi.credit_grants(workspace_id,id),
  CHECK(grant_id IS NULL OR status IN('paid','review'))
);
CREATE INDEX billing_invoice_subscription_idx ON tholi.billing_invoices(workspace_id,subscription_id,period_start,period_end);
CREATE UNIQUE INDEX billing_invoice_grant_idx ON tholi.billing_invoices(workspace_id,grant_id) WHERE grant_id IS NOT NULL;
CREATE UNIQUE INDEX billing_original_period_idx ON tholi.billing_invoices(workspace_id,subscription_id,period_start,period_end)
  WHERE grant_id IS NOT NULL;
CREATE INDEX billing_invoice_page_idx ON tholi.billing_invoices(workspace_id,issued_at DESC,id DESC);
CREATE INDEX billing_invoice_catalog_idx ON tholi.billing_invoices(catalog_version,plan_id,plan_version);

-- Valid signed ingress is durable before acknowledgement. Hints locate only;
-- the worker must verify current provider relations before changing entitlements.
CREATE TABLE tholi.billing_events (
  id uuid PRIMARY KEY,
  mode text NOT NULL CHECK(mode IN('fake','stripe-test','stripe-live')),
  merchant_id text NOT NULL CHECK(length(merchant_id) BETWEEN 1 AND 128),
  provider_event_id text NOT NULL CHECK(provider_event_id ~ '^evt_[A-Za-z0-9_]{1,120}$'),
  event_type text NOT NULL CHECK(length(event_type) BETWEEN 1 AND 100),
  provider_object_id text NOT NULL CHECK(provider_object_id ~ '^[a-z]+_[A-Za-z0-9_]{1,120}$'),
  operation_hint uuid,
  customer_hint text CHECK(customer_hint ~ '^cus_[A-Za-z0-9_]{1,120}$'),
  payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
  workspace_id uuid,
  job_id uuid,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  processed_at timestamptz,
  UNIQUE(mode,merchant_id,provider_event_id),
  FOREIGN KEY(workspace_id,job_id) REFERENCES tholi.jobs(workspace_id,id),
  CHECK((workspace_id IS NULL)=(job_id IS NULL))
);
CREATE INDEX billing_event_pending_idx ON tholi.billing_events(received_at,id) WHERE processed_at IS NULL;
CREATE INDEX billing_event_job_idx ON tholi.billing_events(workspace_id,job_id);
CREATE INDEX billing_event_operation_idx ON tholi.billing_events(operation_hint) WHERE processed_at IS NULL;

-- No raw payloads, contact fields, card data, credentials or plaintext URLs.
-- As with existing financial/lifecycle tables, the dedicated migration owner
-- retains privileged cleanup. The pooled non-owner roles cannot bypass RLS.
ALTER TABLE tholi.billing_workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_workspace_owner ON tholi.billing_workspaces
  USING(workspace_id=tholi.actor_workspace_id() AND account_id=tholi.actor_account_id()
    AND EXISTS(SELECT FROM tholi.workspaces w JOIN tholi.memberships m ON m.workspace_id=w.id
      JOIN tholi.accounts a ON a.id=m.account_id
      WHERE w.id=billing_workspaces.workspace_id AND w.owner_account_id=billing_workspaces.account_id
        AND m.account_id=billing_workspaces.account_id AND m.role='owner' AND m.status='active' AND a.status='active'));
ALTER TABLE tholi.billing_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_subscription_owner ON tholi.billing_subscriptions
  USING(workspace_id=tholi.actor_workspace_id()
    AND EXISTS(SELECT FROM tholi.billing_workspaces b WHERE b.workspace_id=billing_subscriptions.workspace_id));
ALTER TABLE tholi.billing_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_operation_owner ON tholi.billing_operations
  USING(workspace_id=tholi.actor_workspace_id() AND account_id=tholi.actor_account_id()
    AND EXISTS(SELECT FROM tholi.billing_workspaces b WHERE b.workspace_id=billing_operations.workspace_id));
ALTER TABLE tholi.billing_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_invoice_owner ON tholi.billing_invoices
  USING(workspace_id=tholi.actor_workspace_id()
    AND EXISTS(SELECT FROM tholi.billing_workspaces b WHERE b.workspace_id=billing_invoices.workspace_id));
-- Signed ingress is unscoped. No pooled role receives direct access or policy;
-- later ingress/reconciliation composition uses narrow privileged functions.
ALTER TABLE tholi.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tholi.billing_workspaces,tholi.billing_subscriptions,tholi.billing_operations,
  tholi.billing_invoices,tholi.billing_events FROM PUBLIC;

`;
