import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import {
  PlanService,
  type PlanRepositories,
  type PlanTransaction,
} from "../../../apps/api/src/application/plans";
import type { ServiceRequestContext } from "../../../apps/api/src/capabilities";
import type {
  Entitlement,
  Membership,
  RepositoryScope,
} from "../../../apps/api/src/database/contracts";
import {
  createEffectiveProductPlanFixture,
  createProductCatalogFixture,
} from "../../support/product-plan-fixture";
import { productCatalogSchema } from "../../../packages/navigation-core/contracts-plans";

function fixture() {
  const accountId = randomUUID(),
    workspaceId = randomUUID(),
    controller = new AbortController(),
    context: ServiceRequestContext = {
      requestId: randomUUID(),
      deadlineAt: Date.now() + 5000,
      signal: controller.signal,
    },
    account = { id: accountId, status: "active" as const },
    workspace = {
      id: workspaceId,
      ownerAccountId: accountId,
      kind: "personal" as "personal" | "organization",
    },
    membership: Membership = {
      accountId,
      role: "owner",
      status: "active",
      revision: 1n,
    },
    catalog = createProductCatalogFixture(),
    effective = createEffectiveProductPlanFixture(),
    free = catalog.plans.find((plan) => plan.mode === "free-cloud")!,
    entitlement: Entitlement = {
      id: randomUUID(),
      planId: effective.planId,
      planVersion: effective.planVersion,
      status: "active",
      startsAt: new Date(effective.periodStart),
      endsAt: new Date(effective.periodEnd),
      revision: 1n,
    },
    enrollment = {
      effective,
      grant: {
        id: randomUUID(),
        amount: free.developmentAllowance!.amount,
        expiresAt: effective.periodEnd,
      },
      replayed: false,
    };
  const tx = {
    getAccount: vi.fn(async () => account),
    getWorkspace: vi.fn(async () => workspace),
    getMembership: vi.fn(async () => membership),
    listConsents: vi.fn(async () => []),
    listEntitlements: vi.fn<PlanTransaction["listEntitlements"]>(async () => [
      entitlement,
    ]),
    readEffectivePlan: vi.fn<PlanTransaction["readEffectivePlan"]>(
      async () => effective,
    ),
    enrollFree: vi.fn<PlanTransaction["enrollFree"]>(async () => enrollment),
  } satisfies PlanTransaction;
  const repositories = {
    readPlanCatalog: vi.fn(async () => catalog),
    async transaction<T>(
      _scope: RepositoryScope,
      work: (repository: PlanTransaction) => Promise<T>,
    ) {
      return work(tx);
    },
  } satisfies PlanRepositories;
  const transactions = vi.spyOn(repositories, "transaction");
  return {
    accountId,
    workspaceId,
    context,
    controller,
    workspace,
    membership,
    catalog,
    enrollment,
    entitlement,
    tx,
    repositories,
    transactions,
    service: new PlanService(repositories, "development"),
  };
}

test("deployment-owned catalog availability hides development allowances by default without changing the stored catalog", async () => {
  const f = fixture(),
    production = await new PlanService(f.repositories).catalog(f.context),
    development = await f.service.catalog(f.context);
  expect(production.environment).toBe("production");
  expect(production.plans.find((plan) => plan.mode === "local")).toMatchObject({
    requiresAccount: false,
    availability: { available: true },
    developmentAllowance: null,
  });
  expect(
    production.plans
      .filter((plan) => plan.mode !== "local")
      .every(
        (plan) =>
          !plan.availability.available &&
          plan.developmentAllowance === null &&
          plan.productionAllowance === null,
      ),
  ).toBe(true);
  expect(
    development.plans.find((plan) => plan.mode === "free-cloud"),
  ).toMatchObject({
    requiresAccount: true,
    availability: { available: true, reason: "development-fixture" },
    pricing: { status: "free", amount: "0" },
    developmentAllowance: { rollover: false, expiresAtPeriodEnd: true },
  });
  expect(
    development.plans
      .filter((plan) => plan.mode === "paid")
      .every(
        (plan) =>
          !plan.availability.available &&
          plan.pricing.status === "unpublished" &&
          plan.pricing.amount === null,
      ),
  ).toBe(true);
  expect(f.catalog).toEqual(createProductCatalogFixture());
  expect(f.transactions).not.toHaveBeenCalled();
});

test("Free enrollment rejects client plan quantities and production funding before a transaction", async () => {
  const f = fixture();
  for (const input of [
    { amount: "1000" },
    { planId: "paid-cloud", role: "owner" },
    { environment: "development" },
  ])
    expect(() =>
      f.service.enrollFree(
        { accountId: f.accountId },
        f.workspaceId,
        input,
        f.context,
      ),
    ).toThrow();
  expect(() =>
    new PlanService(f.repositories).enrollFree(
      { accountId: f.accountId },
      f.workspaceId,
      {},
      f.context,
    ),
  ).toThrow(expect.objectContaining({ statusCode: 503, code: "UNAVAILABLE" }));
  expect(f.transactions).not.toHaveBeenCalled();
  expect(f.tx.enrollFree).not.toHaveBeenCalled();
});

test("catalog contracts reject duplicate identities, paid activation and unpublished production quantities", () => {
  const catalog = createProductCatalogFixture(),
    free = catalog.plans.find((plan) => plan.mode === "free-cloud")!,
    paid = catalog.plans.find((plan) => plan.mode === "paid")!;
  const invalid = [
    { ...catalog, plans: [...catalog.plans, catalog.plans[0]] },
    {
      ...catalog,
      plans: catalog.plans.map((plan) =>
        plan.id === paid.id ? { ...plan, id: "Paid Plan" } : plan,
      ),
    },
    { ...catalog, environment: "production" },
    {
      ...catalog,
      plans: catalog.plans.map((plan) =>
        plan.mode === "paid"
          ? { ...plan, availability: { available: true, reason: "available" } }
          : plan,
      ),
    },
    {
      ...catalog,
      plans: catalog.plans.map((plan) =>
        plan.mode === "paid"
          ? { ...plan, pricing: { status: "unpublished", amount: "10" } }
          : plan,
      ),
    },
    {
      ...catalog,
      plans: catalog.plans.map((plan) =>
        plan.id === free.id
          ? { ...plan, productionAllowance: free.developmentAllowance }
          : plan,
      ),
    },
  ];
  for (const input of invalid)
    expect(productCatalogSchema.safeParse(input).success).toBe(false);
});

test.each(["organization", "non-owner"])(
  "Free enrollment requires the current personal canonical owner (%s)",
  async (condition) => {
    const f = fixture();
    if (condition === "organization") f.workspace.kind = "organization";
    if (condition === "non-owner") f.membership.role = "member";
    await expect(
      f.service.enrollFree(
        { accountId: f.accountId },
        f.workspaceId,
        {},
        f.context,
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    expect(f.tx.enrollFree).not.toHaveBeenCalled();
  },
);

test("development enrollment forwards no client-derived grant or plan and returns the repository's idempotent result", async () => {
  const f = fixture();
  f.enrollment.replayed = true;
  const result = await f.service.enrollFree(
    { accountId: f.accountId },
    f.workspaceId,
    {},
    f.context,
  );
  expect(f.tx.enrollFree).toHaveBeenCalledExactlyOnceWith();
  expect(f.transactions.mock.calls[0][0]).toEqual({
    accountId: f.accountId,
    workspaceId: f.workspaceId,
  });
  expect(result).toEqual(f.enrollment);
});

test("inactive entitlements stay readable without inference consent and do not hold a second catalog connection", async () => {
  const f = fixture();
  f.entitlement.status = "ended";
  f.tx.readEffectivePlan.mockResolvedValueOnce(
    createEffectiveProductPlanFixture({ status: "inactive", caps: null }),
  );
  f.transactions.mockImplementationOnce(async (_scope, work) => {
    expect(f.repositories.readPlanCatalog).toHaveResolved();
    return work(f.tx);
  });
  const result = await f.service.entitlements(
    { accountId: f.accountId },
    f.workspaceId,
    f.context,
  );
  expect(result).toMatchObject({
    catalogVersion: f.catalog.catalogVersion,
    items: [{ id: f.entitlement.id, status: "ended", revision: "1" }],
    effective: { status: "inactive", caps: null },
  });
  expect(f.tx.enrollFree).not.toHaveBeenCalled();
  expect(f.tx.listEntitlements).toHaveBeenCalledWith({ limit: 100 });
});

test("production preserves owned entitlement records without advertising reused development data as active Free access", async () => {
  const f = fixture(),
    result = await new PlanService(f.repositories).entitlements(
      { accountId: f.accountId },
      f.workspaceId,
      f.context,
    );
  expect(result).toMatchObject({
    items: [{ id: f.entitlement.id, status: "active" }],
    effective: { status: "inactive", caps: null },
  });
  await expect(
    f.tx.readEffectivePlan.mock.results[0].value,
  ).resolves.toMatchObject({
    status: "active",
    caps: expect.any(Object),
  });
});
