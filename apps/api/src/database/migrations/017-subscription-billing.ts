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

// Not registered until the billing storage and lifecycle portion is complete.
export const subscriptionBilling = `
ALTER TABLE tholi.product_catalog_releases ADD COLUMN contract_version smallint NOT NULL DEFAULT 1
  CHECK(contract_version IN(1,2));
ALTER TABLE tholi.product_catalog_control ADD COLUMN current_version_2 text
  REFERENCES tholi.product_catalog_releases(version);
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
`;
