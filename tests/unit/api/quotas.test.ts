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
import { fakeDevelopmentChargingPolicy } from "../../../packages/navigation-core/contracts-credits";
import { navigationTransportInputSchema } from "../../../packages/navigation-core/contracts-navigation";
import {
  navigationModelObservation,
  navigationModelValidation,
} from "../../support/navigation-model-fixture";
import type { JobLease } from "../../../apps/api/src/application/job-contracts";

function fixture(model: NavigationModel = createFakeNavigationModel()) {
  const accountId = randomUUID(),
    workspaceId = randomUUID(),
    requestId = randomUUID(),
    controller = new AbortController();
  const context: ServiceRequestContext = {
    requestId: randomUUID(),
    deadlineAt: Date.now() + 5000,
    signal: controller.signal,
  };
  const observation = navigationModelObservation(),
    input = navigationTransportInputSchema.parse({
      requestId,
      profile: "fake",
      observation,
      validation: navigationModelValidation(observation),
      policy: { timeoutMs: 5000 },
    });
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
    reserveInference: vi.fn(async () => ({
      id: randomUUID(),
      requestId,
      claimToken: "private-server-hold-capability",
      creditReservationId: randomUUID(),
      maxCredits: 1n,
      expiresAt: new Date(context.deadlineAt),
      policy,
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
  const revalidate = vi.fn(async () => {}),
    quota = createNavigationQuotaPolicy(repositories, model),
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
    prepare,
  };
}

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
