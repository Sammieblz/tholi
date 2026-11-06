import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { createFakeNavigationModel } from "../../../apps/api/src/adapters/fake-navigation-model";
import type {
  NavigationModel,
  ServiceRequestContext,
} from "../../../apps/api/src/capabilities";
import { AuthorizationError } from "../../../apps/api/src/application/authorization";
import {
  ModelError,
  type ModelUsage,
} from "../../../apps/api/src/application/model-contracts";
import { createNavigationModelService } from "../../../apps/api/src/application/navigation";
import {
  createNavigationQuotaPolicy,
  createInferenceReconciliationHandler,
  CreditService,
  type QuotaRepositories,
  type QuotaTransaction,
} from "../../../apps/api/src/application/quotas";
import {
  RepositoryError,
  type InferencePolicy,
  type Membership,
  type RepositoryScope,
} from "../../../apps/api/src/database/contracts";
import { AUTHORIZATION_CONSENT_POLICIES } from "../../../packages/navigation-core/contracts-authorization";
import {
  fakeDevelopmentChargingPolicy,
  customerDevelopmentChargingPolicy,
} from "../../../packages/navigation-core/contracts-credits";
import { navigationTransportInputSchema } from "../../../packages/navigation-core/contracts-navigation";
import { createEffectiveProductPlanFixture } from "../../support/product-plan-fixture";
import {
  navigationModelObservation,
  navigationModelValidation,
} from "../../support/navigation-model-fixture";
import type { JobLease } from "../../../apps/api/src/application/job-contracts";

function fixture(
  model: NavigationModel = createFakeNavigationModel(),
  environment: "development" | "production" = "production",
  customer = false,
) {
  const accountId = randomUUID(),
    workspaceId = randomUUID(),
    requestId = randomUUID(),
    controller = new AbortController();
  const context: ServiceRequestContext = {
    requestId: randomUUID(),
    deadlineAt: Date.now() + 5000,
    signal: controller.signal,
  };
  const observation = navigationModelObservation();
  const policy: InferencePolicy = {
    version: fakeDevelopmentChargingPolicy.version,
    provider: "fake",
    model: fakeDevelopmentChargingPolicy.model,
    priceRevision: fakeDevelopmentChargingPolicy.version,
    maxCredits: 1n,
    maxProviderUsdMicros: 0n,
    maxInputUnits: 32768,
    maxOutputUnits: 2048,
    maxImages: 1,
    maxRetries: 0,
    maxJourneyRequests: 8,
    periodSeconds: 3600,
    accountRequests: 10,
    workspaceRequests: 20,
    accountProviderUsdMicros: 0n,
    workspaceProviderUsdMicros: 0n,
    journeyProviderUsdMicros: 0n,
  };
  const customerPolicy = customerDevelopmentChargingPolicy("openai");
  const connection = {
    connectionId: randomUUID(),
    provider: customerPolicy.provider,
    model: customerPolicy.model,
    catalogRevision: customerPolicy.catalogRevision,
    routingPolicyVersion: customerPolicy.routingPolicyVersion,
    policyDigest: "c".repeat(64),
    revision: "1",
  };
  const binding = { ...connection, retrievalSnapshotDigest: "d".repeat(64) };
  const input = navigationTransportInputSchema.parse({
    requestId,
    profile: customer ? "customer-funded" : "fake",
    observation,
    validation: navigationModelValidation(observation),
    policy: { timeoutMs: 5000 },
    ...(customer ? { connection } : {}),
  });
  if (customer)
    Object.assign(policy, {
      version: customerPolicy.version,
      provider: customerPolicy.provider,
      model: customerPolicy.model,
      priceRevision: customerPolicy.version,
      maxCredits: 0n,
      maxJourneyRequests: 2,
      periodSeconds: 86400,
      accountRequests: 6,
      workspaceRequests: 6,
      fundingSource: "customer",
      catalogRevision: customerPolicy.catalogRevision,
      routingPolicyVersion: customerPolicy.routingPolicyVersion,
      requestsPerMinute: 2,
    });
  const membership: Membership = {
    accountId,
    role: "owner",
    status: "active",
    revision: 1n,
  };
  const tx = {
    getAccount: vi.fn(async () => ({
      id: accountId,
      status: "active" as const,
    })),
    getWorkspace: vi.fn(async () => ({
      id: workspaceId,
      kind: "personal" as const,
      ownerAccountId: accountId,
    })),
    getMembership: vi.fn(async () => membership),
    listConsents: vi.fn(async () =>
      AUTHORIZATION_CONSENT_POLICIES.map((entry) => ({
        purpose: entry.purpose,
        policyVersion: entry.policyVersion,
        granted: true,
      })),
    ),
    creditBalance: vi.fn(async () => ({
      granted: 0n,
      spent: 0n,
      reserved: 0n,
      available: 0n,
      expired: 0n,
      refunded: 0n,
    })),
    listCreditHistory: vi.fn<QuotaTransaction["listCreditHistory"]>(
      async () => ({
        items: [],
      }),
    ),
    listUsage: vi.fn<QuotaTransaction["listUsage"]>(async () => ({
      items: [],
    })),
    getInferencePolicy: vi.fn(async () => policy),
    reserveInference: vi.fn<QuotaTransaction["reserveInference"]>(async () => ({
      id: randomUUID(),
      requestId,
      claimToken: "private-server-hold-capability",
      creditReservationId: customer ? null : randomUUID(),
      maxCredits: customer ? 0n : 1n,
      expiresAt: new Date(context.deadlineAt),
      policy,
      effectivePlan: null,
      ...(customer ? { binding } : {}),
    })),
    markInferenceDispatched: vi.fn<QuotaTransaction["markInferenceDispatched"]>(
      async () => {},
    ),
  } satisfies QuotaTransaction;
  const repositories = {
    async transaction<T>(
      _scope: RepositoryScope,
      work: (repository: QuotaTransaction) => Promise<T>,
    ): Promise<T> {
      return work(tx);
    },
    finishInference: vi.fn<QuotaRepositories["finishInference"]>(
      async (result) => ({
        id: randomUUID(),
        requestId,
        provider: "fake",
        model: policy.model,
        inputUnits: result.inputUnits ?? 0n,
        outputUnits: result.outputUnits ?? 0n,
        providerUsdMicros: result.providerUsdMicros ?? null,
        chargedCredits: result.chargedCredits ?? null,
        policyVersion: policy.version,
        createdAt: new Date(),
      }),
    ),
  } satisfies QuotaRepositories;
  const transactions = vi.spyOn(repositories, "transaction");
  const revalidateConnection = vi.fn(async () => {});
  const revalidate = vi.fn(async () => {}),
    quota = createNavigationQuotaPolicy(
      repositories,
      model,
      customer ? customerPolicy : undefined,
      environment,
      customer ? { binding, revalidateConnection } : undefined,
    ),
    prepare = () =>
      quota.prepare(input, {
        principal: { accountId },
        workspaceId,
        context,
        revalidate,
      });
  return {
    accountId,
    workspaceId,
    requestId,
    context,
    controller,
    input,
    policy,
    membership,
    tx,
    repositories,
    transactions,
    revalidate,
    model,
    binding,
    revalidateConnection,
    prepare,
  };
}

function customerModel(): NavigationModel {
  const fake = createFakeNavigationModel();
  return {
    async infer(request, context) {
      const result = await fake.infer(request, context);
      return {
        ...result,
        usage: {
          version: 2,
          provider: "openai",
          source: "measured",
          model: customerDevelopmentChargingPolicy("openai").model,
          inputTokens: 12,
          outputTokens: 2048,
          cacheReadInputTokens: null,
          cacheWriteInputTokens: null,
          reasoningOutputTokens: 1024,
          totalTokens: 2060,
        },
      };
    },
  };
}

test("customer-funded inference needs no managed enrollment or credit hold and counts reasoning once", async () => {
  const f = fixture(customerModel(), "production", true);
  f.tx.creditBalance.mockRejectedValue(
    new Error("Credit balance must not gate customer funding"),
  );
  const held = await f.tx.reserveInference({
    requestId: f.requestId,
    journeyId: f.input.observation.stamp.journeyId,
    policyVersion: f.policy.version,
    expiresAt: new Date(f.context.deadlineAt),
    binding: f.binding,
  });
  held.effectivePlan = createEffectiveProductPlanFixture({
    status: "inactive",
    caps: null,
  });
  f.tx.reserveInference.mockClear();
  f.tx.reserveInference.mockResolvedValueOnce(held);
  const { operation, result } = await propose(f);
  expect(operation.budget).toEqual({
    maxInputTokens: 32768,
    maxOutputTokens: 2048,
    maxImages: 1,
  });
  await operation.finish(result);
  expect(f.tx.reserveInference).toHaveBeenCalledWith(
    expect.objectContaining({ binding: f.binding }),
  );
  expect(f.tx.creditBalance).not.toHaveBeenCalled();
  expect(f.repositories.finishInference.mock.calls[0][0]).toMatchObject({
    resolution: "reported",
    inputUnits: 12n,
    outputUnits: 2048n,
    usageVersion: 2,
    reasoningOutputUnits: 1024n,
    cacheReadInputUnits: null,
    cacheWriteInputUnits: null,
    providerUsdMicros: 0n,
    chargedCredits: 0n,
    customerUsdMicros: null,
  });
});

test("a revoked customer connection prevents dispatch and finalizes trusted no-send without a managed charge", async () => {
  const model = customerModel(),
    infer = vi.spyOn(model, "infer"),
    f = fixture(model, "production", true);
  const operation = await f.prepare();
  f.revalidateConnection.mockRejectedValueOnce(
    new AuthorizationError(
      403,
      "FORBIDDEN",
      "The provider connection changed.",
    ),
  );
  const error = await createNavigationModelService(operation.model)
    .propose(
      f.input.observation,
      () => f.input.validation,
      f.context,
      operation.budget,
    )
    .catch((failure) => failure);
  expect(error).toMatchObject({ code: "FORBIDDEN" });
  expect(infer).not.toHaveBeenCalled();
  expect(f.tx.markInferenceDispatched).not.toHaveBeenCalled();
  await operation.finish({ error });
  expect(f.repositories.finishInference.mock.calls[0][0]).toMatchObject({
    resolution: "not-sent",
    providerUsdMicros: 0n,
    chargedCredits: 0n,
    customerUsdMicros: 0n,
  });
});

test("customer connection withdrawal after measured generation retains usage but releases no proposal", async () => {
  const provider = customerModel();
  let f!: ReturnType<typeof fixture>;
  const model: NavigationModel = {
    async infer(request, context) {
      const result = await provider.infer(request, context);
      f.revalidateConnection.mockRejectedValueOnce(
        new AuthorizationError(
          403,
          "FORBIDDEN",
          "The provider connection changed.",
        ),
      );
      return result;
    },
  };
  f = fixture(model, "production", true);
  const operation = await f.prepare();
  const error = await createNavigationModelService(operation.model)
    .propose(
      f.input.observation,
      () => f.input.validation,
      f.context,
      operation.budget,
    )
    .catch((failure) => failure);
  expect(error).toMatchObject({ code: "FORBIDDEN" });
  await operation.finish({ error });
  expect(f.repositories.finishInference.mock.calls[0][0]).toMatchObject({
    resolution: "reported",
    outcome: "failed",
    outputUnits: 2048n,
    providerUsdMicros: 0n,
    chargedCredits: 0n,
    customerUsdMicros: null,
  });
});

test("an unknown customer outcome retains its fence and never invents a customer price or managed liability", async () => {
  const infer = vi.fn(async () => {
    throw new Error("PRIVATE_CUSTOMER_PROVIDER_ERROR");
  });
  const f = fixture({ infer }, "production", true),
    operation = await f.prepare();
  const error = await createNavigationModelService(operation.model)
    .propose(
      f.input.observation,
      () => f.input.validation,
      f.context,
      operation.budget,
    )
    .catch((failure) => failure);
  await expect(operation.finish({ error })).rejects.toMatchObject({
    code: "INVALID_USAGE",
    outcome: "unknown",
  });
  await expect(operation.finish({ error })).rejects.toMatchObject({
    code: "INVALID_USAGE",
  });
  expect(infer).toHaveBeenCalledOnce();
  expect(f.repositories.finishInference).toHaveBeenCalledOnce();
  const receipt = f.repositories.finishInference.mock.calls[0][0];
  expect(receipt).toMatchObject({
    resolution: "unknown",
    outcome: "uncertain",
    usageVersion: 2,
    providerUsdMicros: 0n,
    chargedCredits: 0n,
    customerUsdMicros: null,
  });
  expect(receipt).not.toHaveProperty("inputUnits");
  expect(receipt).not.toHaveProperty("outputUnits");
  expect(
    JSON.stringify(receipt, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  ).not.toContain("PRIVATE_CUSTOMER_PROVIDER_ERROR");
});

async function propose(f: ReturnType<typeof fixture>) {
  const operation = await f.prepare();
  const result = await createNavigationModelService(operation.model).propose(
    f.input.observation,
    () => f.input.validation,
    f.context,
    operation.budget,
  );
  return { operation, result };
}

test("a validated fake proposal settles one development credit once without claiming arrival", async () => {
  const f = fixture(),
    infer = vi.spyOn(f.model, "infer"),
    { operation, result } = await propose(f);
  await operation.finish(result);
  await operation.finish({ error: new ModelError("CANCELLED") });
  expect(infer).toHaveBeenCalledTimes(1);
  expect(f.tx.reserveInference).toHaveBeenCalledWith({
    requestId: f.requestId,
    journeyId: f.input.observation.stamp.journeyId,
    policyVersion: "fake-development-v1",
    expiresAt: new Date(f.context.deadlineAt),
  });
  expect(f.repositories.finishInference).toHaveBeenCalledTimes(1);
  expect(f.repositories.finishInference.mock.calls[0][0]).toMatchObject({
    resolution: "reported",
    outcome: "completed",
    inputUnits: 0n,
    outputUnits: 0n,
    providerUsdMicros: 0n,
    chargedCredits: 1n,
  });
  expect(f.repositories.finishInference.mock.calls[0][0]).not.toHaveProperty(
    "decision",
  );
});

test("the admitted product plan bounds the same model invocation without changing its charging policy", async () => {
  const f = fixture(undefined, "development"),
    held = await f.tx.reserveInference({
      requestId: f.requestId,
      journeyId: f.input.observation.stamp.journeyId,
      policyVersion: f.policy.version,
      expiresAt: new Date(f.context.deadlineAt),
    });
  f.tx.reserveInference.mockClear();
  const effective = createEffectiveProductPlanFixture();
  held.effectivePlan = createEffectiveProductPlanFixture({
    caps: { ...effective.caps!, maxImages: 0 },
  });
  f.tx.reserveInference.mockResolvedValueOnce(held);
  const infer = vi.spyOn(f.model, "infer"),
    { operation, result } = await propose(f);
  expect(infer.mock.calls[0][0].budget).toMatchObject({
    maxInputTokens: 8192,
    maxOutputTokens: 512,
    maxImages: 0,
  });
  expect(f.tx.reserveInference).toHaveBeenCalledWith(
    expect.objectContaining({ policyVersion: "fake-development-v1" }),
  );
  await operation.finish(result);
  expect(f.repositories.finishInference.mock.calls[0][0]).toMatchObject({
    resolution: "reported",
    chargedCredits: 1n,
    providerUsdMicros: 0n,
  });
});

test("an inactive product admission cannot regain the never-enrolled manual budget", async () => {
  const f = fixture(undefined, "development"),
    held = await f.tx.reserveInference({
      requestId: f.requestId,
      journeyId: f.input.observation.stamp.journeyId,
      policyVersion: f.policy.version,
      expiresAt: new Date(f.context.deadlineAt),
    });
  f.tx.reserveInference.mockClear();
  held.effectivePlan = createEffectiveProductPlanFixture({
    status: "inactive",
    periodStart: "2026-01-01T00:00:00Z",
    periodEnd: "2026-01-02T00:00:00Z",
    caps: null,
  });
  f.tx.reserveInference.mockResolvedValueOnce(held);
  const infer = vi.spyOn(f.model, "infer");
  await expect(f.prepare()).rejects.toMatchObject({
    statusCode: 429,
    code: "QUOTA_EXCEEDED",
  });
  expect(infer).not.toHaveBeenCalled();
  expect(f.tx.markInferenceDispatched).not.toHaveBeenCalled();
  expect(f.repositories.finishInference).not.toHaveBeenCalled();
});

test("production rejects an existing development Free admission before dispatch without changing manual development profiles", async () => {
  const f = fixture(),
    held = await f.tx.reserveInference({
      requestId: f.requestId,
      journeyId: f.input.observation.stamp.journeyId,
      policyVersion: f.policy.version,
      expiresAt: new Date(f.context.deadlineAt),
    });
  f.tx.reserveInference.mockClear();
  held.effectivePlan = createEffectiveProductPlanFixture();
  f.tx.reserveInference.mockResolvedValueOnce(held);
  const infer = vi.spyOn(f.model, "infer");
  await expect(f.prepare()).rejects.toMatchObject({
    statusCode: 503,
    code: "UNAVAILABLE",
  });
  expect(infer).not.toHaveBeenCalled();
  expect(f.tx.markInferenceDispatched).not.toHaveBeenCalled();
  expect(f.repositories.finishInference).not.toHaveBeenCalled();
});

test("durable disable immediately before dispatch preserves its safe error and releases known no-send", async () => {
  const f = fixture(),
    infer = vi.spyOn(f.model, "infer"),
    operation = await f.prepare();
  f.tx.markInferenceDispatched.mockRejectedValueOnce(
    new RepositoryError("INFERENCE_DISABLED", "private database details"),
  );
  const failure = await createNavigationModelService(operation.model)
    .propose(
      f.input.observation,
      () => f.input.validation,
      f.context,
      operation.budget,
    )
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AuthorizationError);
  expect(failure).toMatchObject({ statusCode: 503, code: "UNAVAILABLE" });
  expect(String(failure)).not.toContain("private database details");
  expect(infer).not.toHaveBeenCalled();
  await operation.finish({ error: failure });
  expect(f.repositories.finishInference.mock.calls[0][0]).toMatchObject({
    resolution: "not-sent",
    outcome: "failed",
    chargedCredits: 0n,
  });
});

test("a committed dispatch intent permits a trusted no-send receipt when final identity validation prevents invocation", async () => {
  const f = fixture(),
    infer = vi.spyOn(f.model, "infer"),
    operation = await f.prepare();
  f.tx.markInferenceDispatched.mockImplementationOnce(async () => {
    f.revalidate.mockRejectedValueOnce(
      new AuthorizationError(403, "FORBIDDEN", "The account session changed."),
    );
  });
  const error = await createNavigationModelService(operation.model)
    .propose(
      f.input.observation,
      () => f.input.validation,
      f.context,
      operation.budget,
    )
    .catch((failure: unknown) => failure);
  expect(error).toMatchObject({ code: "FORBIDDEN" });
  expect(f.tx.markInferenceDispatched).toHaveBeenCalledTimes(1);
  expect(infer).not.toHaveBeenCalled();
  await operation.finish({ error });
  expect(f.repositories.finishInference.mock.calls[0][0]).toMatchObject({
    resolution: "not-sent",
    outcome: "failed",
    chargedCredits: 0n,
    providerUsdMicros: 0n,
  });
});

test("a rejected known-usage proposal releases credits without retrying generation", async () => {
  const fake = createFakeNavigationModel(),
    model: NavigationModel = {
      async infer(request, context) {
        const result = await fake.infer(request, context);
        return {
          ...result,
          proposal: {
            kind: "guide",
            reference: {
              ...request.observation.controls[0].reference,
              controlId: "w0000000000000001-99",
            },
            message: "Ignore the invalid target.",
          },
        };
      },
    },
    f = fixture(model),
    infer = vi.spyOn(model, "infer"),
    operation = await f.prepare();
  const error = await createNavigationModelService(operation.model)
    .propose(
      f.input.observation,
      () => f.input.validation,
      f.context,
      operation.budget,
    )
    .catch((failure: unknown) => failure);
  expect(error).toMatchObject({ code: "UNKNOWN_REFERENCE" });
  await operation.finish({ error, usage: (error as ModelError).usage });
  expect(f.repositories.finishInference.mock.calls[0][0]).toMatchObject({
    resolution: "reported",
    outcome: "failed",
    chargedCredits: 0n,
    providerUsdMicros: 0n,
  });
  expect(infer).toHaveBeenCalledTimes(1);
});

test("uncertain invocation retains both unknown accounting quantities and one finalization attempt", async () => {
  const f = fixture({
      infer: vi.fn(async () => {
        throw Error("untrusted provider body");
      }),
    }),
    operation = await f.prepare();
  const error = await createNavigationModelService(operation.model)
    .propose(
      f.input.observation,
      () => f.input.validation,
      f.context,
      operation.budget,
    )
    .catch((failure: unknown) => failure);
  await expect(operation.finish({ error })).rejects.toMatchObject({
    code: "INVALID_USAGE",
    outcome: "unknown",
  });
  await expect(operation.finish({ error })).rejects.toMatchObject({
    code: "INVALID_USAGE",
  });
  expect(f.repositories.finishInference).toHaveBeenCalledTimes(1);
  expect(f.repositories.finishInference.mock.calls[0][0]).toMatchObject({
    resolution: "unknown",
    outcome: "uncertain",
  });
  expect(f.repositories.finishInference.mock.calls[0][0]).not.toHaveProperty(
    "providerUsdMicros",
  );
  expect(f.repositories.finishInference.mock.calls[0][0]).not.toHaveProperty(
    "chargedCredits",
  );
  expect(
    JSON.stringify(f.repositories.finishInference.mock.calls),
  ).not.toContain("untrusted provider body");
});

test("a mismatched Vertex usage report is never priced as a free fake decision", async () => {
  const fake = createFakeNavigationModel(),
    f = fixture({
      async infer(request, context) {
        const result = await fake.infer(request, context);
        return {
          ...result,
          usage: {
            provider: "vertex",
            source: "measured",
            model: "unexpected-live-model",
            promptTokens: 10,
            outputTokens: 1,
            thoughtTokens: 0,
            cachedTokens: 0,
            totalTokens: 11,
          } satisfies ModelUsage,
        };
      },
    }),
    operation = await f.prepare();
  const error = await createNavigationModelService(operation.model)
    .propose(
      f.input.observation,
      () => f.input.validation,
      f.context,
      operation.budget,
    )
    .catch((failure: unknown) => failure);
  expect(error).toMatchObject({ code: "INVALID_USAGE" });
  await expect(operation.finish({ error })).rejects.toMatchObject({
    outcome: "unknown",
  });
  expect(f.repositories.finishInference.mock.calls[0][0]).toEqual({
    ...f.tx.markInferenceDispatched.mock.calls[0][0],
    resolution: "unknown",
    outcome: "uncertain",
  });
});

test("settlement survives consent and membership withdrawal after validated generation", async () => {
  const f = fixture(),
    { operation, result } = await propose(f),
    transactions = f.transactions.mock.calls.length;
  f.membership.status = "revoked";
  f.tx.listConsents.mockResolvedValueOnce([]);
  f.controller.abort();
  await operation.finish(result);
  expect(f.transactions).toHaveBeenCalledTimes(transactions);
  expect(f.repositories.finishInference.mock.calls[0][0]).toMatchObject({
    resolution: "reported",
    chargedCredits: 1n,
  });
});

test("a failed durable settlement blocks proposal release and is never retried as a refund", async () => {
  const f = fixture(),
    { operation, result } = await propose(f);
  f.repositories.finishInference.mockRejectedValueOnce(
    Error("private settlement SQL"),
  );
  await expect(operation.finish(result)).rejects.toMatchObject({
    code: "UNAVAILABLE",
    outcome: "unknown",
  });
  await expect(
    operation.finish({ error: new ModelError("CANCELLED") }),
  ).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(f.repositories.finishInference).toHaveBeenCalledTimes(1);
});

test("credit reads remain available without inference consent or balance and expose only safe metadata", async () => {
  const f = fixture(),
    credits = new CreditService(f.repositories),
    createdAt = new Date();
  f.tx.listConsents.mockResolvedValue([]);
  f.tx.listCreditHistory.mockResolvedValue({
    items: [
      {
        id: randomUUID(),
        kind: "settlement",
        amount: -1n,
        createdAt,
        source: null,
        periodStart: null,
        periodEnd: null,
        expiresAt: null,
        policyVersion: "fake-development-v1",
      },
    ],
    nextCursor: "opaque-composite-cursor",
  });
  f.tx.listUsage.mockResolvedValue({
    items: [
      {
        id: randomUUID(),
        requestId: f.requestId,
        provider: "fake",
        model: "tholi-deterministic-v1",
        inputUnits: 0n,
        outputUnits: 0n,
        providerUsdMicros: null,
        chargedCredits: null,
        policyVersion: "fake-development-v1",
        createdAt,
        fundingSource: "managed",
        usageVersion: 1,
        customerUsdMicros: null,
        claimToken: "PRIVATE_CAPABILITY",
      } as Awaited<ReturnType<QuotaTransaction["listUsage"]>>["items"][number],
    ],
  });
  const principal = { accountId: f.accountId },
    balance = await credits.balance(principal, f.workspaceId, f.context),
    history = await credits.history(
      principal,
      f.workspaceId,
      { limit: 1 },
      f.context,
    ),
    usage = await credits.usage(principal, f.workspaceId, {}, f.context);
  expect(balance.balance.available).toBe("0");
  expect(balance.policy.billingAvailable).toBe(false);
  expect(history.nextCursor).toBe("opaque-composite-cursor");
  expect(history.items[0].amount).toBe("-1");
  expect(usage.items[0].providerUsdMicros).toBeNull();
  expect(usage.items[0].chargedCredits).toBeNull();
  expect(usage.verification).toEqual({
    independentOutcomesAvailable: false,
    costPerVerifiedSuccessUsdMicros: null,
  });
  expect(JSON.stringify(usage)).not.toContain("PRIVATE_CAPABILITY");
  expect(usage.items[0]).not.toHaveProperty("fundingSource");
  const extended = await credits.usage(
    principal,
    f.workspaceId,
    { schemaVersion: 2 },
    f.context,
  );
  expect(extended).toMatchObject({
    schemaVersion: 2,
    items: [
      {
        fundingSource: "managed",
        usageVersion: 1,
        customerUsdMicros: null,
        reasoningOutputUnits: null,
      },
    ],
  });
  expect(f.tx.listUsage).toHaveBeenLastCalledWith({ limit: 50 }, 2);
  expect(f.tx.reserveInference).not.toHaveBeenCalled();
  f.membership.status = "revoked";
  await expect(
    credits.balance(principal, f.workspaceId, f.context),
  ).rejects.toMatchObject({
    statusCode: 403,
    code: "FORBIDDEN",
  });
});

test("metadata reconciliation uses the exact fenced lease without account reads or model execution", async () => {
  const lease: JobLease = {
    id: randomUUID(),
    accountId: randomUUID(),
    workspaceId: randomUUID(),
    kind: "inference.reconcile",
    version: 1,
    recordReferences: { requestId: randomUUID() },
    attempts: 1,
    maxAttempts: 3,
    leaseToken: "private-job-lease",
    leaseExpiresAt: new Date(Date.now() + 1000),
  };
  const store = {
      scheduleInferenceReconciliation: vi.fn(async () => 1),
      reconcileInference: vi.fn(async () => ({ processed: 1 })),
    },
    handler = createInferenceReconciliationHandler(store);
  expect(handler.replaySafe).toBe(true);
  await handler.schedule!({ limit: 10, intervalMs: 60000 });
  await handler.execute(lease, new AbortController().signal, 1000);
  expect(store.reconcileInference).toHaveBeenCalledExactlyOnceWith(lease);
  expect(store.scheduleInferenceReconciliation).toHaveBeenCalledWith({
    limit: 10,
    intervalMs: 60000,
  });
  await expect(
    handler.execute(
      { ...lease, kind: "identity.prune-expired-brokers" },
      new AbortController().signal,
      1000,
    ),
  ).rejects.toMatchObject({
    code: "UNSUPPORTED_JOB",
  });
  expect(store.reconcileInference).toHaveBeenCalledTimes(1);
});
