import { productCatalogSeed } from "../../apps/api/src/database/migrations/009-product-plans";
import { billingCatalogSeed } from "../../apps/api/src/database/migrations/017-subscription-billing";
import {
  effectiveProductPlanSchema,
  productCatalogSchema,
  productCatalogV2Schema,
  type ProductCatalogV2,
  type EffectiveProductPlan,
  type ProductCatalog,
} from "../../packages/navigation-core/contracts-plans";

/** Test-only reuse of historical migration data, never a runtime catalog source. */
export function createProductCatalogFixture(): ProductCatalog {
  return productCatalogSchema.parse(structuredClone(productCatalogSeed));
}

/** Both negotiated views reuse the same frozen plan versions; this is test-only. */
export function createProductCatalogV2Fixture(): ProductCatalogV2 {
  const legacy = createProductCatalogFixture();
  return productCatalogV2Schema.parse({
    ...legacy,
    version: 2,
    catalogVersion: billingCatalogSeed.catalogVersion,
    plans: [
      ...legacy.plans
        .filter((plan) => plan.mode !== "paid")
        .map((plan) => ({ ...plan, billing: null })),
      ...structuredClone(billingCatalogSeed.paidPlans),
    ],
  });
}

/** A scoped admission snapshot; account grants and enforcement remain PostgreSQL-owned. */
export function createEffectiveProductPlanFixture(
  overrides: Partial<EffectiveProductPlan> = {},
): EffectiveProductPlan {
  const catalog = createProductCatalogFixture(),
    free = catalog.plans.find((plan) => plan.mode === "free-cloud")!,
    now = Date.now();
  return effectiveProductPlanSchema.parse({
    catalogVersion: catalog.catalogVersion,
    planId: free.id,
    planVersion: free.version,
    status: "active",
    periodStart: new Date(now - 1000).toISOString(),
    periodEnd: new Date(now + 86400000).toISOString(),
    caps: free.developmentAllowance!.caps,
    ...overrides,
  });
}
