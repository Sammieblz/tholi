import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationService,
  AuthorizationError,
  type AuthorizationRepositories,
  type AuthorizationTransaction,
} from "../../../apps/api/src/application/authorization";
import {
  JobService,
  type JobTransaction,
} from "../../../apps/api/src/application/jobs";
import {
  IdentityService,
  identityHash,
} from "../../../apps/api/src/application/identity";
import type {
  IdentityProvider,
  IdentitySession,
  IdentityStore,
} from "../../../apps/api/src/application/identity-contracts";
import { parseServiceConfig } from "../../../apps/api/src/config";
import {
  RepositoryError,
  type Consent,
  type Membership,
  type Job,
  type RepositoryScope,
  type ServiceRequest,
} from "../../../apps/api/src/database/contracts";
import {
  createServiceApi,
  createOperatorEvaluationApi,
} from "../../../apps/api/src/server";
import type { NavigationModel } from "../../../apps/api/src/capabilities";
import {
  NavigationTransportService,
  type NavigationRequestTransaction,
  type NavigationEvaluationPolicy,
  type NavigationEvaluationOperation,
} from "../../../apps/api/src/application/navigation";
import { createFakeNavigationModel } from "../../../apps/api/src/adapters/fake-navigation-model";
import { ModelError } from "../../../apps/api/src/application/model-contracts";
import { CreditService } from "../../../apps/api/src/application/quotas";
import {
  PlanService,
  type PlanRepositories,
} from "../../../apps/api/src/application/plans";
import {
  productCatalogSchema,
  productEntitlementsSchema,
  freeEnrollmentSchema,
  type EffectiveProductPlan,
} from "../../../packages/navigation-core/contracts-plans";
import { createProductCatalogFixture } from "../../support/product-plan-fixture";
import {
  creditHistoryPageSchema,
  creditUsagePageSchema,
  fakeDevelopmentChargingPolicy,
  workspaceCreditsSchema,
} from "../../../packages/navigation-core/contracts-credits";
import {
  navigationModelObservation,
  navigationModelValidation,
  navigationModelCapture,
} from "../../support/navigation-model-fixture";
import {
  NAVIGATION_TRANSPORT_LIMITS,
  NAVIGATION_TRANSPORT_OPERATION,
  navigationTransportResponseSchema,
  navigationRequestStatusSchema,
  navigationCancellationSchema,
} from "../../../packages/navigation-core/contracts-navigation";
import { SupportService } from "../../../apps/api/src/application/support";
import type {
  ObjectPort,
  PrivateFile,
  SupportStore,
} from "../../../apps/api/src/application/support-contracts";
import {
  diagnosticSnapshotSchema,
  fileLinkSchema,
  privateFileSchema,
  supportRequestSchema,
} from "../../../packages/navigation-core/contracts-support";
import {
  consentSchema,
  membershipSchema,
  policyCatalogSchema,
  workspacePageSchema,
} from "../../../packages/navigation-core/contracts-authorization";
import { serviceErrorEnvelopeSchema } from "../../../packages/navigation-core/contracts-service";
import {
  ProductAnalyticsService,
  type ProductAnalyticsTransaction,
} from "../../../apps/api/src/application/analytics";
import {
  PRODUCT_FUNNEL_AVAILABILITY,
  productFunnelEventSchema,
  productAnalyticsPageSchema,
  recordProductEventInputSchema,
} from "../../../packages/navigation-core/contracts-analytics";
import {
  cancelJobInputSchema,
  jobPageQuerySchema,
  jobPageSchema,
  jobSchema,
} from "../../../packages/navigation-core/contracts-jobs";

const applications: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});
const webOrigin = "https://tholi.io";
const nativeOrigin = "chrome-extension://" + "a".repeat(32);
const nativeToken = "n".repeat(43);
const webToken = "w".repeat(43);
const bearer = { authorization: `Bearer ${nativeToken}` };

async function fixture(
  supportEnabled = true,
  analyticsEnabled = true,
  navigationModel?: NavigationModel,
  evaluationFactory?: (session: IdentitySession) => NavigationEvaluationPolicy,
  creditsEnabled = false,
  plansEnvironment?: "development" | "production",
) {
  const options = parseServiceConfig({
    NODE_ENV: "production",
    THOLI_SERVICE_ORIGINS: `${webOrigin},https://help.tholi.io`,
    THOLI_SERVICE_PUBLIC_ORIGIN: "https://api.tholi.io",
    THOLI_DATABASE_URL:
      "postgresql://runtime:synthetic@unreachable.invalid/tholi",
    THOLI_IDENTITY_ISSUER: "https://identity.tholi.io/realms/tholi",
    THOLI_IDENTITY_AUTHORIZATION_ENDPOINT:
      "https://identity.tholi.io/realms/tholi/protocol/openid-connect/auth",
    THOLI_IDENTITY_TOKEN_ENDPOINT:
      "https://identity.tholi.io/realms/tholi/protocol/openid-connect/token",
    THOLI_IDENTITY_JWKS_URI:
      "https://identity.tholi.io/realms/tholi/protocol/openid-connect/certs",
    THOLI_IDENTITY_LOGOUT_ENDPOINT:
      "https://identity.tholi.io/realms/tholi/protocol/openid-connect/logout",
    THOLI_IDENTITY_CLIENT_ID: "tholi-service",
    THOLI_IDENTITY_CLIENT_SECRET_KEY: "synthetic-authorization-profile-secret",
    THOLI_IDENTITY_FLOW_SECRET_KEY: Buffer.alloc(32, 7).toString("base64url"),
    THOLI_IDENTITY_WEB_ORIGIN: webOrigin,
    THOLI_IDENTITY_CHROMIUM_CALLBACKS:
      "https://" + "a".repeat(32) + ".chromiumapp.org/",
  }).options;
  const account = { id: randomUUID(), status: "active" as const, revision: 1n };
  const workspace = {
    id: randomUUID(),
    kind: "organization" as "personal" | "organization",
    ownerAccountId: account.id,
    revision: 1n,
  };
  const membership: Membership = {
    accountId: account.id,
    role: "owner",
    status: "active",
    revision: 1n,
  };
  const target: Membership = {
    accountId: randomUUID(),
    role: "member",
    status: "active",
    revision: 2n,
  };
  const consents: Consent[] = [];
  let effectivePlan: EffectiveProductPlan | null = null;
  const navigationRequests = new Map<string, ServiceRequest>();
  const job: Job & { leaseOwner: string; leaseToken: string } = {
    id: randomUUID(),
    accountId: account.id,
    requestId: randomUUID(),
    kind: "fixture.prune",
    version: 1,
    recordReferences: { accountId: account.id },
    status: "queued",
    availableAt: new Date(),
    maxAttempts: 3,
    revision: 1n,
    attempts: 0,
    cancelRequested: false,
    errorCode: null,
    result: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    leaseOwner: "PRIVATE_WORKER_SENTINEL",
    leaseToken: "PRIVATE_FENCE_SENTINEL",
  };
  const scoped = {
    readEffectivePlan: vi.fn(async () => effectivePlan),
    listEntitlements: vi.fn(async () => []),
    enrollFree: vi.fn(async () => {
      const catalog = createProductCatalogFixture();
      const plan = catalog.plans.find((item) => item.mode === "free-cloud")!;
      const replayed = effectivePlan !== null;
      effectivePlan ??= {
        catalogVersion: catalog.catalogVersion,
        planId: plan.id,
        planVersion: plan.version,
        status: "active",
        periodStart: "2026-10-31T00:00:00Z",
        periodEnd: "2026-11-01T00:00:00Z",
        caps: plan.developmentAllowance!.caps,
      };
      return {
        effective: effectivePlan,
        grant: {
          id: account.id,
          amount: plan.developmentAllowance!.amount,
          expiresAt: effectivePlan.periodEnd,
        },
        replayed,
      };
    }),
    getAccount: vi.fn(async () => account),
    getWorkspace: vi.fn(async () => workspace),
    getMembership: vi.fn(async () => membership),
    listMemberships: vi.fn(async () => [target]),
    listConsents: vi.fn(async () => consents),
    creditBalance: vi.fn(async () => ({
      granted: 9007199254740993n,
      spent: 9007199254740993n,
      reserved: 0n,
      available: 0n,
      expired: 0n,
      refunded: 0n,
    })),
    getInferencePolicy: vi.fn(async () => ({
      version: fakeDevelopmentChargingPolicy.version,
      provider: "fake" as const,
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
      accountRequests: 20,
      workspaceRequests: 100,
      globalRequests: 500,
      accountProviderUsdMicros: 0n,
      workspaceProviderUsdMicros: 0n,
      globalProviderUsdMicros: 0n,
      journeyProviderUsdMicros: 0n,
    })),
    listCreditHistory: vi.fn(
      async (_query: { after?: string; limit?: number }) => ({
        items: [
          {
            id: randomUUID(),
            kind: "grant" as const,
            amount: 9007199254740993n,
            createdAt: new Date("2026-10-31T00:00:00Z"),
            source: "fixture",
            periodStart: null,
            periodEnd: null,
            expiresAt: null,
            policyVersion: null,
          },
        ],
      }),
    ),
    listUsage: vi.fn(async (_query: { after?: string; limit?: number }) => ({
      items: [
        {
          id: randomUUID(),
          requestId: randomUUID(),
          provider: "fake",
          model: fakeDevelopmentChargingPolicy.model,
          inputUnits: null,
          outputUnits: null,
          providerUsdMicros: null,
          chargedCredits: null,
          policyVersion: fakeDevelopmentChargingPolicy.version,
          createdAt: new Date("2026-10-31T00:00:00Z"),
        },
      ],
    })),
    beginRequest: vi.fn<NavigationRequestTransaction["beginRequest"]>(
      async (input) => {
        const existing = [...navigationRequests.values()].find(
          (row) =>
            row.operation === input.operation &&
            row.idempotencyKey === input.idempotencyKey,
        );
        if (existing) {
          if (existing.payloadHash !== input.payloadHash)
            throw new RepositoryError(
              "IDEMPOTENCY_CONFLICT",
              "PRIVATE_HASH_SENTINEL",
            );
          return { request: { ...existing }, replayed: true };
        }
        const id = input.id ?? randomUUID();
        if (navigationRequests.has(id))
          throw new RepositoryError("CONFLICT", "PRIVATE_REQUEST_SENTINEL");
        const request: ServiceRequest = {
          id,
          operation: input.operation,
          idempotencyKey: input.idempotencyKey,
          payloadHash: input.payloadHash,
          status: "pending",
        };
        navigationRequests.set(id, request);
        return { request: { ...request }, replayed: false };
      },
    ),
    getRequest: vi.fn<NavigationRequestTransaction["getRequest"]>(
      async (id) => {
        const row = navigationRequests.get(id);
        return row ? { ...row } : undefined;
      },
    ),
    setRequestStatus: vi.fn<NavigationRequestTransaction["setRequestStatus"]>(
      async (id, status, expectedStatus) => {
        const row = navigationRequests.get(id);
        if (
          !row ||
          (expectedStatus === undefined
            ? !["pending", "uncertain", status].includes(row.status)
            : row.status !== expectedStatus)
        )
          throw new RepositoryError("CONFLICT", "PRIVATE_REQUEST_SENTINEL");
        row.status = status;
        return { ...row };
      },
    ),
    recordProductEvent: vi.fn<
      ProductAnalyticsTransaction["recordProductEvent"]
    >(async () => ({ recorded: true })),
    listProductEvents: vi.fn<ProductAnalyticsTransaction["listProductEvents"]>(
      async () => [
        {
          schemaVersion: 1,
          eventId: "00000000-0000-4000-8000-000000000035",
          event: { name: "page_view", page: "account" },
          recordedAt: new Date("2026-10-30T00:00:00Z"),
        },
      ],
    ),
    deleteProductEvents: vi.fn(async () => 1n),
    listJobs: vi.fn<JobTransaction["listJobs"]>(async () => [job]),
    getJob: vi.fn<JobTransaction["getJob"]>(async (id) =>
      id === job.id ? job : undefined,
    ),
    cancelJob: vi.fn<JobTransaction["cancelJob"]>(async () => ({
      ...job,
      status: "running",
      cancelRequested: true,
      revision: 2n,
    })),
    setMembership: vi.fn<AuthorizationTransaction["setMembership"]>(
      async (input) => ({
        accountId: input.accountId,
        role: input.role,
        status: input.status,
        revision: input.expectedRevision + 1n,
      }),
    ),
    recordConsent: vi.fn<AuthorizationTransaction["recordConsent"]>(
      async (input) => {
        const result = {
          id:
            consents.find((row) => row.purpose === input.purpose)?.id ??
            randomUUID(),
          purpose: input.purpose,
          policyVersion: input.policyVersion,
          granted: input.granted,
          revision: input.expectedRevision + 1n,
        };
        consents.splice(0, consents.length, result);
        return result;
      },
    ),
  };
  const repositories = {
    readPlanCatalog: vi.fn(async () => createProductCatalogFixture()),
    listWorkspaces: vi.fn(async () => [workspace]),
    async transaction<T>(
      scope: RepositoryScope,
      work: (repository: typeof scoped) => Promise<T>,
    ) {
      if (scope.accountId !== account.id || scope.workspaceId !== workspace.id)
        throw new RepositoryError("FORBIDDEN", "PRIVATE_SCOPE_SENTINEL");
      return work(scoped);
    },
  } satisfies AuthorizationRepositories & PlanRepositories;
  vi.spyOn(repositories, "transaction");
  const session: IdentitySession = {
    id: randomUUID(),
    identityId: randomUUID(),
    accountId: account.id,
    workspaceId: randomUUID(),
    revision: "1",
    clientId: "extension-chromium",
    clientKind: "extension",
    providerIssuer: options.identity!.issuer,
    providerSubject: "synthetic-subject",
    providerIssuedAt: new Date(),
    accessHash: identityHash(nativeToken),
    refreshHash: identityHash("r".repeat(43)),
    csrfHash: identityHash("c".repeat(43)),
    accessExpiresAt: new Date(Date.now() + 60_000),
    expiresAt: new Date(Date.now() + 600_000),
    createdAt: new Date(),
    lastUsedAt: new Date(),
  };
  const webSession: IdentitySession = {
    ...session,
    id: randomUUID(),
    clientId: "web",
    clientKind: "web",
    accessHash: identityHash(webToken),
  };
  const unexpected = vi.fn(async (): Promise<never> => {
    throw new Error(
      "Provider and identity mutation are outside this route fixture.",
    );
  });
  const store: IdentityStore = {
    createFlow: unexpected,
    consumeFlow: unexpected,
    resolveIdentity: unexpected,
    createBroker: unexpected,
    consumeBroker: unexpected,
    createSession: unexpected,
    authenticateSession: vi.fn(async (hash) =>
      hash === session.accessHash
        ? session
        : hash === webSession.accessHash
          ? webSession
          : null,
    ),
    rotateSession: unexpected,
    listSessions: unexpected,
    revokeSession: unexpected,
    revokeAllSessions: unexpected,
    revokeProviderSessions: unexpected,
  };
  const provider: IdentityProvider = {
    authorize: () => {
      throw new Error("Unexpected provider authorization.");
    },
    exchange: unexpected,
    verifyLogout: unexpected,
    logoutUrl: () => {
      throw new Error("Unexpected provider logout.");
    },
  };
  const identity = new IdentityService(options.identity!, store, provider);
  const csrf = identity.account(webSession).csrfToken!;
  webSession.csrfHash = identityHash(csrf);
  const authorization = new AuthorizationService(repositories);
  const jobs = new JobService(repositories);
  const snapshot = diagnosticSnapshotSchema.parse({
    schemaVersion: 1,
    version: "0.11.0",
    profile: "service",
    accountStatus: "active",
    workspaceKind: "personal",
    role: "owner",
    jobs: {
      queued: 1,
      running: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
      cancelled: 0,
      uncertain: 0,
    },
  });
  const diagnosticBody = Buffer.from(JSON.stringify(snapshot));
  const file: PrivateFile = {
    id: randomUUID(),
    requestId: randomUUID(),
    revision: 1n,
    key: "",
    bytes: diagnosticBody.byteLength,
    sha256: createHash("sha256").update(diagnosticBody).digest("hex"),
    contentType: "application/json",
    expiresAt: new Date(Date.now() + 60_000),
    status: "ready",
  };
  file.key = `exports/${session.workspaceId}/${file.id}.json`;
  const supportRecord = {
    id: randomUUID(),
    operatorJobId: randomUUID(),
    receiptJobId: null,
    expiresAt: new Date(Date.now() + 60_000),
  };
  const supportStore: SupportStore = {
    submit: vi.fn(async () => supportRecord),
    requestDiagnostic: vi.fn(async () => ({
      requestId: file.requestId,
      jobId: randomUUID(),
      fileId: file.id,
    })),
    getFile: vi.fn(async (_scope, id) => (id === file.id ? file : null)),
    prepareExternal: unexpected,
    finishExternal: unexpected,
    prepareCleanup: unexpected,
    finishCleanup: unexpected,
    scheduleFileExpiry: unexpected,
  };
  const objects: ObjectPort = {
    put: unexpected,
    read: vi.fn(async () => diagnosticBody),
    delete: unexpected,
    close: vi.fn(async () => {}),
  };
  const support = new SupportService(
    supportStore,
    objects,
    {
      issue: vi.fn(async () => "signed.download-proof"),
      verify: vi.fn(async () => ({
        accountId: session.accountId,
        workspaceId: session.workspaceId,
        fileId: file.id,
        revision: "1",
      })),
    },
    { publicOrigin: "https://api.tholi.io", linkLifetimeMs: 60_000 },
  );
  const evaluation = evaluationFactory?.(session);
  const navigation = navigationModel
    ? new NavigationTransportService(repositories, navigationModel, evaluation)
    : undefined;
  const app = await (
    evaluation ? createOperatorEvaluationApi : createServiceApi
  )(
    {
      ...options,
      ...(navigationModel ? { navigation: { provider: "fake" as const } } : {}),
    },
    [],
    {
      identity,
      authorization,
      jobs,
      ...(analyticsEnabled
        ? { analytics: new ProductAnalyticsService(repositories) }
        : {}),
      ...(supportEnabled ? { support } : {}),
      ...(navigation ? { navigation } : {}),
      ...(creditsEnabled
        ? {
            credits: new CreditService(
              repositories,
              fakeDevelopmentChargingPolicy,
            ),
          }
        : {}),
      ...(plansEnvironment
        ? { plans: new PlanService(repositories, plansEnvironment) }
        : {}),
    },
  );
  applications.push(app);
  return {
    app,
    options,
    navigation,
    identity,
    authorization,
    store,
    repositories,
    scoped,
    account,
    workspace,
    membership,
    target,
    consents,
    navigationRequests,
    job,
    session,
    supportStore,
    supportRecord,
    file,
    snapshot,
    objects,
    diagnosticBody,
    csrf,
    cookie: `__Host-tholi_session=${webToken}`,
  };
}

function safeError(
  response: { statusCode: number; json(): unknown },
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  expect(serviceErrorEnvelopeSchema.parse(response.json()).error).toMatchObject(
    { code, retryable: false },
  );
  expect(JSON.stringify(response.json())).not.toMatch(
    /SENTINEL|unreachable|postgresql|synthetic-subject/,
  );
}
const change = { role: "admin", status: "active", expectedRevision: "2" };

function navigationInput(images = false) {
  const observation = navigationModelObservation();
  if (images) navigationModelCapture(observation);
  return {
    requestId: randomUUID(),
    profile: "fake" as const,
    observation,
    validation: navigationModelValidation(observation),
  };
}
function grantNavigation(
  f: Awaited<ReturnType<typeof fixture>>,
  images = false,
) {
  for (const purpose of [
    "cloud_inference",
    ...(images ? ["image_transmission"] : []),
  ])
    f.consents.push({
      id: randomUUID(),
      purpose,
      policyVersion: "1",
      granted: true,
      revision: 1n,
    });
}
function delayedNavigation() {
  const fake = createFakeNavigationModel();
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const model: NavigationModel = {
    infer: vi.fn<NavigationModel["infer"]>(async (input, context) => {
      started();
      await held;
      return fake.infer(input, context);
    }),
  };
  return { model, entered, release };
}

describe("opt-in authenticated navigation transport", () => {
  const operatorMetadata = () => ({
    profile: "operator-evaluation" as const,
    planSha256: "a".repeat(64),
    provider: "fake" as const,
    runtimeManifestSha256: "b".repeat(64),
    expiresAtMs: Date.now() + 60000,
  });
  const operatorInput = () => ({
    ...navigationInput(),
    profile: "operator-evaluation",
    evaluation: {
      planSha256: "a".repeat(64),
      trialId: randomUUID(),
      generation: 0,
    },
  });

  it("ordinary fake composition rejects the operator profile without claiming work", async () => {
    const model = createFakeNavigationModel(),
      infer = vi.spyOn(model, "infer");
    const f = await fixture(false, false, model);
    grantNavigation(f);
    safeError(
      await f.app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${f.workspace.id}/decisions`,
        headers: bearer,
        payload: operatorInput(),
      }),
      409,
      "COMPATIBILITY_MISMATCH",
    );
    expect(infer).not.toHaveBeenCalled();
    expect(f.scoped.beginRequest).not.toHaveBeenCalled();
  });

  it("operator composition advertises its explicit profile, forwards authenticated actor fields and never invokes the default model", async () => {
    const fallback = createFakeNavigationModel(),
      fallbackInfer = vi.spyOn(fallback, "infer");
    const selected = createFakeNavigationModel(),
      selectedInfer = vi.spyOn(selected, "infer");
    const finish = vi.fn<NavigationEvaluationOperation["finish"]>(
      async () => {},
    );
    const prepare = vi.fn<NavigationEvaluationPolicy["prepare"]>(async () => ({
      model: selected,
      budget: {},
      finish,
    }));
    const metadata = operatorMetadata();
    const f = await fixture(false, false, fallback, () => ({
      metadata,
      prepare,
    }));
    grantNavigation(f);
    await expect(
      createServiceApi({ ...f.options, navigation: { provider: "fake" } }, [], {
        identity: f.identity,
        authorization: f.authorization,
        navigation: f.navigation,
      }),
    ).rejects.toThrow("ordinary service startup");
    const capabilities = (
      await f.app.inject({ url: "/api/v1/capabilities", headers: bearer })
    ).json();
    expect(capabilities.evaluation).toEqual(metadata);
    expect(capabilities.capabilities).toContain(
      "operator-navigation-evaluation",
    );
    expect(capabilities.capabilities).not.toContain("fake-navigation-model");
    const path = `/api/v1/workspaces/${f.workspace.id}/decisions`;
    safeError(
      await f.app.inject({
        method: "POST",
        url: path,
        headers: bearer,
        payload: navigationInput(),
      }),
      409,
      "COMPATIBILITY_MISMATCH",
    );
    expect(prepare).not.toHaveBeenCalled();
    const input = operatorInput();
    const response = await f.app.inject({
      method: "POST",
      url: path,
      headers: bearer,
      payload: input,
    });
    expect(response.statusCode).toBe(200);
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0][1]).toMatchObject({
      workspaceId: f.workspace.id,
      principal: {
        accountId: f.account.id,
        clientId: "extension-chromium",
        clientKind: "extension",
      },
    });
    expect(selectedInfer).toHaveBeenCalledOnce();
    expect(fallbackInfer).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledOnce();
    expect(finish.mock.calls[0][0]).toMatchObject({
      decision: { native: input.observation.native },
      usage: { provider: "fake" },
    });
    const replay = await f.app.inject({
      method: "POST",
      url: path,
      headers: bearer,
      payload: input,
    });
    expect(replay.json()).toEqual({
      requestId: input.requestId,
      status: "completed",
      replayed: true,
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(selectedInfer).toHaveBeenCalledOnce();
  });

  it("operator admission rechecks consent after preparation before calling the model", async () => {
    const model = createFakeNavigationModel(),
      infer = vi.spyOn(model, "infer");
    const finish = vi.fn<NavigationEvaluationOperation["finish"]>(
      async () => {},
    );
    let withdraw = () => {};
    const prepare = vi.fn<NavigationEvaluationPolicy["prepare"]>(async () => {
      withdraw();
      return { model, budget: {}, finish };
    });
    const f = await fixture(false, false, model, () => ({
      metadata: operatorMetadata(),
      prepare,
    }));
    grantNavigation(f);
    withdraw = () => {
      f.consents[0].granted = false;
    };
    safeError(
      await f.app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${f.workspace.id}/decisions`,
        headers: bearer,
        payload: operatorInput(),
      }),
      403,
      "FORBIDDEN",
    );
    expect(infer).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledOnce();
  });

  it("a blocked operator preparation respects the HTTP deadline without calling the model", async () => {
    const model = createFakeNavigationModel(),
      infer = vi.spyOn(model, "infer");
    let entered!: () => void, release!: () => void;
    const preparing = new Promise<void>((done) => {
      entered = done;
    });
    const held = new Promise<void>((done) => {
      release = done;
    });
    const finish = vi.fn<NavigationEvaluationOperation["finish"]>(
      async () => {},
    );
    const prepare = vi.fn<NavigationEvaluationPolicy["prepare"]>(async () => {
      entered();
      await held;
      return { model, budget: {}, finish };
    });
    const f = await fixture(false, false, model, () => ({
      metadata: operatorMetadata(),
      prepare,
    }));
    grantNavigation(f);
    const response = f.app
      .inject({
        method: "POST",
        url: `/api/v1/workspaces/${f.workspace.id}/decisions`,
        headers: { ...bearer, "x-tholi-timeout-ms": "100" },
        payload: operatorInput(),
      })
      .then((result) => result);
    try {
      await preparing;
      safeError(await response, 504, "DEADLINE_EXCEEDED");
      expect(infer).not.toHaveBeenCalled();
    } finally {
      release();
    }
    await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
    expect(finish.mock.calls[0][0]).toMatchObject({
      error: { code: "DEADLINE_EXCEEDED" },
    });
    expect(infer).not.toHaveBeenCalled();
  });

  it("an uncertain operator settlement withholds the proposal and is never retried", async () => {
    const model = createFakeNavigationModel(),
      infer = vi.spyOn(model, "infer");
    const finish = vi.fn<NavigationEvaluationOperation["finish"]>(async () => {
      throw new ModelError("CONFIGURATION");
    });
    const prepare = vi.fn<NavigationEvaluationPolicy["prepare"]>(async () => ({
      model,
      budget: {},
      finish,
    }));
    const f = await fixture(false, false, model, () => ({
      metadata: operatorMetadata(),
      prepare,
    }));
    grantNavigation(f);
    const input = operatorInput();
    safeError(
      await f.app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${f.workspace.id}/decisions`,
        headers: bearer,
        payload: input,
      }),
      503,
      "UNAVAILABLE",
    );
    expect(infer).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(f.navigationRequests.get(input.requestId)?.status).toBe("uncertain");
  });

  it.each(["credits", "storage"])(
    "propagates the authenticated %s allowance refusal without inferring or opening checkout",
    async (resource) => {
      const model = createFakeNavigationModel(),
        infer = vi.spyOn(model, "infer");
      const f = await fixture(false, false, model);
      grantNavigation(f);
      f.scoped.beginRequest.mockRejectedValueOnce(
        resource === "credits"
          ? new RepositoryError(
              "INSUFFICIENT_CREDITS",
              "PRIVATE_ALLOWANCE_SENTINEL",
            )
          : new AuthorizationError(
              429,
              "QUOTA_EXCEEDED",
              "The cloud storage allowance has been reached.",
            ),
      );
      const response = await f.app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${f.workspace.id}/decisions`,
        headers: bearer,
        payload: navigationInput(),
      });
      safeError(response, 429, "QUOTA_EXCEEDED");
      expect(Object.keys(response.json())).toEqual(["error"]);
      expect(Object.keys(response.json().error).sort()).toEqual([
        "code",
        "message",
        "requestId",
        "retryable",
      ]);
      expect(response.payload).not.toMatch(
        /checkout|charged|remainingCredits|planId/,
      );
      expect(infer).not.toHaveBeenCalled();
      expect(f.navigationRequests.size).toBe(0);
    },
  );

  it("advertises only explicitly composed fake decisions and authenticates before body parsing", async () => {
    const model = createFakeNavigationModel(),
      infer = vi.spyOn(model, "infer");
    const f = await fixture(false, false, model);
    const disabled = await fixture(false, false);
    const capabilities = (await f.app.inject("/api/v1/capabilities")).json();
    expect(capabilities.capabilities).toEqual(
      expect.arrayContaining(["navigation-decisions", "fake-navigation-model"]),
    );
    expect(capabilities.availability).toMatchObject({
      decisions: true,
      billing: false,
    });
    expect(capabilities.limits.maxBodyBytes).toBe(512 * 1024);
    expect(
      (await disabled.app.inject("/api/v1/capabilities")).json().availability
        .decisions,
    ).toBe(false);
    const path = `/api/v1/workspaces/${f.workspace.id}/decisions`;
    safeError(
      await f.app.inject({
        method: "POST",
        url: path,
        headers: { "content-type": "application/json" },
        payload: "invalid JSON",
      }),
      401,
      "UNAUTHENTICATED",
    );
    safeError(
      await f.app.inject({
        method: "POST",
        url: path,
        headers: {
          cookie: f.cookie,
          origin: webOrigin,
          "content-type": "application/json",
        },
        payload: "invalid JSON",
      }),
      403,
      "FORBIDDEN",
    );
    for (const profile of [undefined, "vertex", "cloud"])
      safeError(
        await f.app.inject({
          method: "POST",
          url: path,
          headers: bearer,
          payload: { ...navigationInput(), profile },
        }),
        400,
        "INVALID_REQUEST",
      );
    const invalidGeometry = navigationInput();
    invalidGeometry.observation.frames[0].viewport.width = 0;
    safeError(
      await f.app.inject({
        method: "POST",
        url: path,
        headers: bearer,
        payload: invalidGeometry,
      }),
      400,
      "INVALID_REQUEST",
    );
    safeError(
      await f.app.inject({
        method: "POST",
        url: path,
        headers: bearer,
        payload: { ...navigationInput(), extra: "x".repeat(600 * 1024) },
      }),
      400,
      "INVALID_REQUEST",
    );
    safeError(
      await f.app.inject({
        method: "POST",
        url: path,
        headers: { ...bearer, "content-type": "application/json" },
        payload: "x".repeat(NAVIGATION_TRANSPORT_LIMITS.maxBodyBytes + 1),
      }),
      413,
      "PAYLOAD_TOO_LARGE",
    );
    expect(infer).not.toHaveBeenCalled();
    expect(f.scoped.beginRequest).not.toHaveBeenCalled();
    const spec = (await f.app.inject("/api/v1/openapi.json")).json();
    for (const route of [
      "/api/v1/workspaces/{workspaceId}/decisions",
      "/api/v1/workspaces/{workspaceId}/decisions/{requestId}",
      "/api/v1/workspaces/{workspaceId}/decisions/{requestId}/cancel",
    ])
      expect(Object.keys(spec.paths)).toContain(route);
    const documentedBody =
      spec.paths["/api/v1/workspaces/{workspaceId}/decisions"].post.requestBody
        .content["application/json"].schema;
    const common = documentedBody.allOf.find(
      (part: any) => part.properties?.observation,
    );
    const profiles = documentedBody.allOf.find(
      (part: any) => part.anyOf,
    )?.anyOf;
    expect(profiles).toHaveLength(2);
    expect(
      common.properties.observation.properties.frames.items.properties.viewport
        .properties.width,
    ).toMatchObject({ minimum: 0, exclusiveMinimum: true });
  });

  it("admits a valid masked PNG above the account body limit only on the decision route", async () => {
    const model = createFakeNavigationModel(),
      infer = vi.spyOn(model, "infer");
    const f = await fixture(false, false, model),
      input = navigationInput(true);
    grantNavigation(f, true);
    const pixels = Buffer.alloc(640 * 180 * 4);
    let seed = 0x6a09e667;
    for (let index = 0; index < pixels.length; index++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      pixels[index] = seed >>> 24;
    }
    const png = await sharp(pixels, {
      raw: { width: 640, height: 180, channels: 4 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    input.observation.images[0].image = png.toString("base64");
    const body = JSON.stringify(input);
    expect(Buffer.byteLength(body)).toBeGreaterThan(512 * 1024);
    expect(Buffer.byteLength(body)).toBeLessThan(
      NAVIGATION_TRANSPORT_LIMITS.maxBodyBytes,
    );
    const response = await f.app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${f.workspace.id}/decisions`,
      headers: bearer,
      payload: input,
    });
    expect(response.statusCode).toBe(200);
    expect(
      navigationTransportResponseSchema.parse(response.json()).status,
    ).toBe("completed");
    expect(infer).toHaveBeenCalledOnce();
    safeError(
      await f.app.inject({
        method: "POST",
        url: "/api/v1/handshake",
        payload: input,
      }),
      413,
      "PAYLOAD_TOO_LARGE",
    );
  });

  it("requires independent current text/image purposes and preserves caller clocks and native identity", async () => {
    const model = createFakeNavigationModel(),
      infer = vi.spyOn(model, "infer");
    const f = await fixture(false, false, model),
      input = navigationInput(true);
    const path = `/api/v1/workspaces/${f.workspace.id}/decisions`;
    const send = () =>
      f.app.inject({
        method: "POST",
        url: path,
        headers: bearer,
        payload: input,
      });
    safeError(await send(), 403, "FORBIDDEN");
    grantNavigation(f);
    safeError(await send(), 403, "FORBIDDEN");
    expect(infer).not.toHaveBeenCalled();
    f.consents.push({
      id: randomUUID(),
      purpose: "image_transmission",
      policyVersion: "1",
      granted: true,
      revision: 1n,
    });
    const response = await send();
    expect(response.statusCode).toBe(200);
    const result = navigationTransportResponseSchema.parse(response.json());
    expect(result).toMatchObject({
      requestId: input.requestId,
      status: "completed",
      replayed: false,
      decision: {
        native: input.observation.native,
        stamp: input.observation.stamp,
      },
    });
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(infer).toHaveBeenCalledOnce();
    expect(f.scoped.beginRequest.mock.calls[0][0]).toEqual({
      id: input.requestId,
      operation: NAVIGATION_TRANSPORT_OPERATION,
      idempotencyKey: input.requestId,
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(Object.keys(f.navigationRequests.get(input.requestId)!)).toEqual([
      "id",
      "operation",
      "idempotencyKey",
      "payloadHash",
      "status",
    ]);
  });

  it("returns metadata-only replays, rejects changed commands and does not leak another scope", async () => {
    const model = createFakeNavigationModel(),
      infer = vi.spyOn(model, "infer");
    const f = await fixture(false, false, model),
      input = navigationInput();
    grantNavigation(f);
    const path = `/api/v1/workspaces/${f.workspace.id}/decisions`;
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: path,
          headers: bearer,
          payload: input,
        })
      ).statusCode,
    ).toBe(200);
    const replay = navigationTransportResponseSchema.parse(
      (
        await f.app.inject({
          method: "POST",
          url: path,
          headers: bearer,
          payload: input,
        })
      ).json(),
    );
    expect(replay).toEqual({
      requestId: input.requestId,
      status: "completed",
      replayed: true,
    });
    expect(infer).toHaveBeenCalledOnce();
    safeError(
      await f.app.inject({
        method: "POST",
        url: path,
        headers: bearer,
        payload: {
          ...input,
          observation: {
            ...input.observation,
            context: {
              ...input.observation.context,
              goal: "A different destination",
            },
          },
        },
      }),
      409,
      "IDEMPOTENCY_CONFLICT",
    );
    safeError(
      await f.app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${randomUUID()}/decisions`,
        headers: bearer,
        payload: navigationInput(),
      }),
      403,
      "FORBIDDEN",
    );
    safeError(
      await f.app.inject({ url: `${path}/${randomUUID()}`, headers: bearer }),
      404,
      "NOT_FOUND",
    );
    safeError(
      await f.app.inject({
        method: "POST",
        url: `${path}/${input.requestId}/cancel`,
        headers: bearer,
        payload: { force: true },
      }),
      400,
      "INVALID_REQUEST",
    );
    const request = f.navigationRequests.get(input.requestId)!;
    request.operation = "legacy-navigation";
    safeError(
      await f.app.inject({
        url: `${path}/${input.requestId}`,
        headers: bearer,
      }),
      404,
      "NOT_FOUND",
    );
    safeError(
      await f.app.inject({
        method: "POST",
        url: `${path}/${input.requestId}/cancel`,
        headers: bearer,
        payload: {},
      }),
      404,
      "NOT_FOUND",
    );
    request.operation = NAVIGATION_TRANSPORT_OPERATION;
    f.consents[0].granted = false;
    expect(
      navigationRequestStatusSchema.parse(
        (
          await f.app.inject({
            url: `${path}/${input.requestId}`,
            headers: bearer,
          })
        ).json(),
      ),
    ).toEqual({ requestId: input.requestId, status: "completed" });
  });

  it("keeps the original active request through a duplicate and acknowledges cancellation after consent withdrawal", async () => {
    const deferred = delayedNavigation(),
      f = await fixture(false, false, deferred.model),
      input = navigationInput();
    grantNavigation(f);
    const path = `/api/v1/workspaces/${f.workspace.id}/decisions`;
    const original = f.app
      .inject({ method: "POST", url: path, headers: bearer, payload: input })
      .then((response) => response);
    try {
      await deferred.entered;
      expect(
        navigationTransportResponseSchema.parse(
          (
            await f.app.inject({
              method: "POST",
              url: path,
              headers: bearer,
              payload: input,
            })
          ).json(),
        ),
      ).toEqual({
        requestId: input.requestId,
        status: "pending",
        replayed: true,
      });
      f.consents[0].granted = false;
      const cancelled = navigationCancellationSchema.parse(
        (
          await f.app.inject({
            method: "POST",
            url: `${path}/${input.requestId}/cancel`,
            headers: bearer,
            payload: {},
          })
        ).json(),
      );
      expect(cancelled).toEqual({
        requestId: input.requestId,
        status: "uncertain",
        cancelRequested: true,
        cancellationConfirmed: false,
      });
      safeError(await original, 409, "CANCELLED");
      expect(deferred.model.infer).toHaveBeenCalledOnce();
      expect(
        navigationRequestStatusSchema.parse(
          (
            await f.app.inject({
              url: `${path}/${input.requestId}`,
              headers: bearer,
            })
          ).json(),
        ).status,
      ).toBe("uncertain");
    } finally {
      deferred.release();
    }
  });

  it("withholds a proposal when another replica cancels after the final pending read", async () => {
    const deferred = delayedNavigation(),
      f = await fixture(false, false, deferred.model),
      input = navigationInput();
    grantNavigation(f);
    const update = f.scoped.setRequestStatus.getMockImplementation()!;
    f.scoped.setRequestStatus.mockImplementation(
      async (id, status, expected) => {
        if (status === "completed")
          f.navigationRequests.get(id)!.status = "uncertain";
        return update(id, status, expected);
      },
    );
    const original = f.app
      .inject({
        method: "POST",
        url: `/api/v1/workspaces/${f.workspace.id}/decisions`,
        headers: bearer,
        payload: input,
      })
      .then((response) => response);
    try {
      await deferred.entered;
      deferred.release();
      safeError(await original, 409, "CONFLICT");
      expect(f.navigationRequests.get(input.requestId)?.status).toBe(
        "uncertain",
      );
      expect(deferred.model.infer).toHaveBeenCalledOnce();
    } finally {
      deferred.release();
    }
  });

  it.each([3, 4])(
    "does not start more work or release a proposal after consent withdrawal during authentication read %i",
    async (authenticationRead) => {
      const model = createFakeNavigationModel(),
        infer = vi.spyOn(model, "infer");
      const f = await fixture(false, false, model),
        input = navigationInput();
      grantNavigation(f);
      const authenticate = vi
        .mocked(f.store.authenticateSession)
        .getMockImplementation()!;
      let calls = 0,
        entered!: () => void,
        release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(f.store.authenticateSession).mockImplementation(
        async (...args) => {
          const session = await authenticate(...args);
          // This await formerly followed the final purpose snapshot before work.
          if (++calls === authenticationRead) {
            entered();
            await held;
          }
          return session;
        },
      );
      const pending = f.app
        .inject({
          method: "POST",
          url: `/api/v1/workspaces/${f.workspace.id}/decisions`,
          headers: bearer,
          payload: input,
        })
        .then((response) => response);
      try {
        await waiting;
        const beforeWithdrawal = infer.mock.calls.length;
        f.consents[0].granted = false;
        release();
        safeError(await pending, 403, "FORBIDDEN");
        expect(infer).toHaveBeenCalledTimes(beforeWithdrawal);
      } finally {
        release();
      }
    },
  );

  it.each(["identity", "admission"])(
    "shortens the entire %s wait to the original request budget",
    async (phase) => {
      const model = createFakeNavigationModel(),
        infer = vi.spyOn(model, "infer");
      const f = await fixture(false, false, model),
        input = { ...navigationInput(), policy: { timeoutMs: 50 } };
      grantNavigation(f);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (phase === "identity") {
        const authenticate = vi
          .mocked(f.store.authenticateSession)
          .getMockImplementation()!;
        vi.mocked(f.store.authenticateSession)
          .mockImplementationOnce(authenticate)
          .mockImplementationOnce(async (...args) => {
            await held;
            return authenticate(...args);
          });
      } else {
        const begin = f.scoped.beginRequest.getMockImplementation()!;
        f.scoped.beginRequest.mockImplementationOnce(async (...args) => {
          await held;
          return begin(...args);
        });
      }
      try {
        safeError(
          await f.app.inject({
            method: "POST",
            url: `/api/v1/workspaces/${f.workspace.id}/decisions`,
            headers: bearer,
            payload: input,
          }),
          504,
          "DEADLINE_EXCEEDED",
        );
        expect(infer).not.toHaveBeenCalled();
      } finally {
        release();
      }
    },
  );

  it.each(["consent", "session", "clientId", "clientKind"])(
    "rechecks %s after model work and withholds a late proposal",
    async (change) => {
      const deferred = delayedNavigation(),
        f = await fixture(false, false, deferred.model),
        input = navigationInput();
      grantNavigation(f);
      const path = `/api/v1/workspaces/${f.workspace.id}/decisions`;
      const original = f.app
        .inject({ method: "POST", url: path, headers: bearer, payload: input })
        .then((response) => response);
      await deferred.entered;
      if (change === "consent") f.consents[0].granted = false;
      else if (change === "clientId") f.session.clientId = "extension-firefox";
      else if (change === "clientKind") f.session.clientKind = "desktop";
      else vi.mocked(f.store.authenticateSession).mockResolvedValue(null);
      deferred.release();
      safeError(
        await original,
        change === "consent" ? 403 : 401,
        change === "consent" ? "FORBIDDEN" : "UNAUTHENTICATED",
      );
      expect(f.navigationRequests.get(input.requestId)?.status).toBe(
        "uncertain",
      );
    },
  );
});

describe("consented product analytics HTTP contracts", () => {
  const input = {
    schemaVersion: 1,
    eventId: "00000000-0000-4000-8000-000000000035",
    event: { name: "page_view", page: "account" },
  };
  it("requires both current actor consent and real cookie/CSRF authority on a local HTTP request", async () => {
    const f = await fixture();
    const url = await f.app.listen({ host: "127.0.0.1", port: 0 });
    const endpoint = `${url}/api/v1/workspaces/${f.workspace.id}/analytics/events`;
    const send = (headers: Record<string, string> = {}) =>
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(input),
      });
    expect((await send()).status).toBe(401);
    const cookieHeaders = { cookie: f.cookie, origin: webOrigin };
    expect((await send(cookieHeaders)).status).toBe(403);
    const headers = { ...cookieHeaders, "X-Tholi-CSRF": f.csrf };
    expect((await send(headers)).status).toBe(403);
    expect(f.scoped.recordProductEvent).not.toHaveBeenCalled();
    f.consents.push({
      id: randomUUID(),
      purpose: "product_analytics",
      policyVersion: "1",
      granted: true,
      revision: 1n,
    });
    const response = await send(headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(f.scoped.recordProductEvent).toHaveBeenCalledWith(input);
    f.consents[0].granted = false;
    expect((await send(headers)).status).toBe(403);
    const exported = await fetch(endpoint, { headers: cookieHeaders });
    expect(
      productAnalyticsPageSchema.parse(await exported.json()).items,
    ).toHaveLength(1);
    const deleted = await fetch(endpoint, { method: "DELETE", headers });
    expect(await deleted.json()).toEqual({ deleted: "1" });
  });

  it("rejects invented data fields, forged workspace scope and unavailable activation producers", async () => {
    const f = await fixture();
    const path = `/api/v1/workspaces/${f.workspace.id}/analytics/events`;
    for (const payload of [
      { ...input, accountId: f.account.id },
      { ...input, event: { ...input.event, goal: "PRIVATE_GOAL_SENTINEL" } },
      { ...input, schemaVersion: 2 },
      { ...input, event: { name: "mode_activated", mode: "paid-cloud" } },
      { ...input, event: { name: "allowance_exhausted", mode: "free-cloud" } },
    ]) {
      expect(recordProductEventInputSchema.safeParse(payload).success).toBe(
        false,
      );
      safeError(
        await f.app.inject({
          method: "POST",
          url: path,
          headers: bearer,
          payload,
        }),
        400,
        "INVALID_REQUEST",
      );
    }
    safeError(
      await f.app.inject({
        method: "GET",
        url: `/api/v1/workspaces/${randomUUID()}/analytics/events`,
        headers: bearer,
      }),
      403,
      "FORBIDDEN",
    );
    expect(f.scoped.recordProductEvent).not.toHaveBeenCalled();
    expect(
      productFunnelEventSchema.safeParse({
        name: "mode_activated",
        mode: "local",
      }).success,
    ).toBe(true);
    expect(PRODUCT_FUNNEL_AVAILABILITY).toEqual({
      publicOnboardingFunnel: "unavailable",
      localActivation: "unavailable",
      freeCloudActivation: "unavailable",
      paidCloudActivation: "unavailable",
      allowanceExhaustion: "unavailable",
    });
  });

  it("advertises only composed handlers and maps bounded collection admission safely", async () => {
    const f = await fixture();
    const disabled = await fixture(false, false);
    expect(
      (await f.app.inject("/api/v1/capabilities")).json().capabilities,
    ).toContain("product-analytics");
    expect(
      (await disabled.app.inject("/api/v1/capabilities")).json().capabilities,
    ).not.toContain("product-analytics");
    const path = `/api/v1/workspaces/${f.workspace.id}/analytics/events`;
    expect(
      (await disabled.app.inject({ url: path, headers: bearer })).statusCode,
    ).toBe(404);
    f.consents.push({
      id: randomUUID(),
      purpose: "product_analytics",
      policyVersion: "1",
      granted: true,
      revision: 1n,
    });
    f.scoped.recordProductEvent.mockRejectedValueOnce(
      new RepositoryError("RATE_LIMITED", "PRIVATE_SQL_SENTINEL"),
    );
    const limited = await f.app.inject({
      method: "POST",
      url: path,
      headers: bearer,
      payload: input,
    });
    safeError(limited, 429, "RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBe("86400");
    expect(limited.payload).not.toContain("PRIVATE_SQL_SENTINEL");
  });
});

describe("account support and private file HTTP contracts", () => {
  const input = {
    idempotencyKey: "support-request-1",
    email: "reply@example.test",
    topic: "Support",
    subject: "Opening Tholi",
    message: "Please help me find the browser panel.",
  };
  it("rechecks current session authority after object I/O before releasing private bytes", async () => {
    const { app, file, objects, diagnosticBody, store } = await fixture();
    let begin!: () => void;
    let complete!: () => void;
    const started = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      complete = resolve;
    });
    vi.mocked(objects.read).mockImplementationOnce(async () => {
      begin();
      await paused;
      return diagnosticBody;
    });
    const pending = app
      .inject({
        url: `/api/v1/account/files/${file.id}/download?token=signed.proof`,
        headers: bearer,
      })
      .then((response) => response);
    await started;
    vi.mocked(store.authenticateSession).mockResolvedValue(null);
    complete();
    const response = await pending;
    safeError(response, 401, "UNAUTHENTICATED");
    expect(response.payload).not.toContain('"schemaVersion"');
    expect(response.headers["content-disposition"]).toBeUndefined();
  });
  it("advertises only composed support/file handlers and leaves general saved-data export planned", async () => {
    const { app } = await fixture();
    const disabled = (await fixture(false)).app;
    for (const [current, enabled] of [
      [app, true],
      [disabled, false],
    ] as const) {
      const capabilities = (
        await current.inject({ url: "/api/v1/capabilities" })
      ).json();
      expect(capabilities.capabilities.includes("support-requests")).toBe(
        enabled,
      );
      expect(capabilities.capabilities.includes("private-files")).toBe(enabled);
      const spec = (
        await current.inject({ url: "/api/v1/openapi.json" })
      ).json();
      const entries = spec["x-tholi-route-inventory"].filter(
        (route: { issue: number }) => route.issue === 33,
      );
      expect(entries).toHaveLength(5);
      expect(
        entries.every(
          (route: { status: string }) =>
            route.status === (enabled ? "implemented" : "planned"),
        ),
      ).toBe(true);
      expect(Boolean(spec.paths["/api/v1/support/requests"])).toBe(enabled);
      expect(
        Boolean(spec.paths["/api/v1/account/files/{fileId}/download"]),
      ).toBe(enabled);
      expect(spec.paths["/api/v1/account/saved-data/export"]).toBeUndefined();
      if (enabled) {
        expect(
          spec.paths["/api/v1/support/requests"].post.responses["429"],
        ).toBeDefined();
        expect(spec.paths["/api/v1/support/requests"].post.security).toEqual([
          { NativeBearer: [] },
          { WebSession: [] },
        ]);
      }
    }
    expect(
      (
        await disabled.inject({
          method: "POST",
          url: "/api/v1/support/requests",
          payload: input,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("requires the current session and exact website CSRF boundary, rejects invented template/scope fields and reports queued requests with quota headers", async () => {
    const { app, supportStore, session, cookie, csrf, supportRecord } =
      await fixture();
    const url = "/api/v1/support/requests";
    safeError(
      await app.inject({ method: "POST", url, payload: input }),
      401,
      "UNAUTHENTICATED",
    );
    for (const headers of [
      { cookie, origin: webOrigin },
      { cookie, "x-tholi-csrf": csrf },
      { cookie, origin: "https://help.tholi.io", "x-tholi-csrf": csrf },
    ])
      safeError(
        await app.inject({ method: "POST", url, headers, payload: input }),
        403,
        "FORBIDDEN",
      );
    expect(supportStore.submit).not.toHaveBeenCalled();
    for (const payload of [
      { ...input, accountId: randomUUID() },
      { ...input, template: "custom" },
      { ...input, to: "unapproved@example.test" },
      { ...input, subject: "Header\r\nInjected" },
      { ...input, subject: "Header\tInjected" },
      { ...input, subject: "Header\u007fInjected" },
      { ...input, message: "x".repeat(3001) },
      { ...input, topic: "arbitrary" },
    ])
      safeError(
        await app.inject({ method: "POST", url, headers: bearer, payload }),
        400,
        "INVALID_REQUEST",
      );
    const response = await app.inject({
      method: "POST",
      url,
      headers: { cookie, origin: webOrigin, "x-tholi-csrf": csrf },
      payload: input,
    });
    expect(response.statusCode).toBe(200);
    expect(supportRequestSchema.parse(response.json())).toMatchObject({
      id: supportRecord.id,
      receiptJobId: null,
    });
    expect(supportStore.submit).toHaveBeenCalledWith(
      { accountId: session.accountId, workspaceId: session.workspaceId },
      expect.objectContaining(input),
      expect.any(AbortSignal),
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(response.json())).not.toContain(input.message);
    vi.mocked(supportStore.submit).mockRejectedValueOnce(
      new RepositoryError("RATE_LIMITED", "PRIVATE_QUOTA_SENTINEL"),
    );
    const limited = await app.inject({
      method: "POST",
      url,
      headers: bearer,
      payload: input,
    });
    safeError(limited, 429, "RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBe("3600");
  });

  it("exports only explicitly requested diagnostic metadata and protects private links/downloads with the same account guard", async () => {
    const { app, file, supportStore, cookie, csrf, snapshot } = await fixture();
    expect(
      fileLinkSchema.safeParse({
        url: "not a URL",
        expiresAt: file.expiresAt.toISOString(),
      }).success,
    ).toBe(false);
    expect(
      diagnosticSnapshotSchema.safeParse({
        ...snapshot,
        pages: ["private page"],
      }).success,
    ).toBe(false);
    expect(supportStore.requestDiagnostic).not.toHaveBeenCalled();
    const url = "/api/v1/account/diagnostic-exports";
    safeError(
      await app.inject({
        method: "POST",
        url,
        headers: bearer,
        payload: { idempotencyKey: "export-1", screenshot: "forbidden" },
      }),
      400,
      "INVALID_REQUEST",
    );
    const created = await app.inject({
      method: "POST",
      url,
      headers: bearer,
      payload: { idempotencyKey: "export-1" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().fileId).toBe(file.id);
    const path = `/api/v1/account/files/${file.id}`;
    const metadata = await app.inject({ url: path, headers: bearer });
    expect(privateFileSchema.parse(metadata.json())).toMatchObject({
      id: file.id,
      revision: "1",
    });
    expect(metadata.payload).not.toMatch(
      /PRIVATE_OBJECT|sha256|accountId|workspaceId/,
    );
    safeError(
      await app.inject({
        method: "POST",
        url: path + "/link",
        headers: { cookie, origin: webOrigin },
        payload: { expectedRevision: "1" },
      }),
      403,
      "FORBIDDEN",
    );
    safeError(
      await app.inject({
        method: "POST",
        url: path + "/link",
        headers: bearer,
        payload: { expectedRevision: "0" },
      }),
      400,
      "INVALID_REQUEST",
    );
    const link = await app.inject({
      method: "POST",
      url: path + "/link",
      headers: { cookie, origin: webOrigin, "x-tholi-csrf": csrf },
      payload: { expectedRevision: "1" },
    });
    expect(link.statusCode).toBe(200);
    const download = new URL(link.json().url);
    safeError(
      await app.inject({ url: download.pathname + download.search }),
      401,
      "UNAUTHENTICATED",
    );
    safeError(
      await app.inject({
        url: download.pathname + download.search,
        headers: { cookie, origin: "https://help.tholi.io" },
      }),
      403,
      "FORBIDDEN",
    );
    safeError(
      await app.inject({
        url: download.pathname + download.search + "&key=forged",
        headers: bearer,
      }),
      400,
      "INVALID_REQUEST",
    );
    const response = await app.inject({
      url: download.pathname + download.search,
      headers: bearer,
    });
    expect(response.statusCode).toBe(200);
    expect(diagnosticSnapshotSchema.parse(response.json())).toEqual(snapshot);
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="tholi-diagnostic.json"',
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });
});

describe("product plans", () => {
  it("publishes production availability without prices or fixture allowances and describes actual operations", async () => {
    const f = await fixture(
      false,
      false,
      undefined,
      undefined,
      false,
      "production",
    );
    const response = await f.app.inject({ url: "/api/v1/plans" });
    expect(response.statusCode).toBe(200);
    const catalog = productCatalogSchema.parse(response.json());
    expect(catalog.environment).toBe("production");
    expect(catalog.plans.find((plan) => plan.mode === "local")).toMatchObject({
      requiresAccount: false,
      availability: { available: true },
    });
    for (const plan of catalog.plans.filter((plan) => plan.mode !== "local")) {
      expect(plan.availability.available).toBe(false);
      expect(plan.productionAllowance).toBeNull();
      expect(plan.developmentAllowance).toBeNull();
      if (plan.mode === "paid")
        expect(plan.pricing).toEqual({ status: "unpublished", amount: null });
    }
    expect(f.repositories.transaction).not.toHaveBeenCalled();
    const capabilities = (
      await f.app.inject({ url: "/api/v1/capabilities" })
    ).json();
    expect(capabilities.capabilities).toContain("product-plans");
    expect(capabilities.availability.billing).toBe(false);
    const spec = (await f.app.inject({ url: "/api/v1/openapi.json" })).json();
    expect(spec.paths["/api/v1/plans"].get.security).toEqual([]);
    expect(
      spec.paths["/api/v1/workspaces/{workspaceId}/entitlements/free"].post
        .security,
    ).toEqual([{ NativeBearer: [] }, { WebSession: [] }]);
    for (const operationId of [
      "listPublishedPlans",
      "getWorkspaceEntitlements",
      "enrollWorkspaceFreePlan",
    ])
      expect(
        spec["x-tholi-route-inventory"].find(
          (entry: { operationId: string }) => entry.operationId === operationId,
        ).status,
      ).toBe("implemented");
    safeError(
      await f.app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${f.workspace.id}/entitlements/free`,
        headers: bearer,
        payload: {},
      }),
      503,
      "UNAVAILABLE",
    );
    expect(f.scoped.enrollFree).not.toHaveBeenCalled();
  });

  it("requires current personal-owner authority, strict server-derived enrollment and cookie CSRF", async () => {
    const f = await fixture(
      false,
      false,
      undefined,
      undefined,
      false,
      "development",
    );
    const base = `/api/v1/workspaces/${f.workspace.id}/entitlements`;
    safeError(
      await f.app.inject({ method: "POST", url: base + "/free", payload: {} }),
      401,
      "UNAUTHENTICATED",
    );
    safeError(
      await f.app.inject({
        method: "POST",
        url: base + "/free",
        headers: bearer,
        payload: {},
      }),
      403,
      "FORBIDDEN",
    );
    expect(f.scoped.enrollFree).not.toHaveBeenCalled();
    f.workspace.kind = "personal";
    for (const payload of [
      { planId: "paid-cloud" },
      { amount: "9000" },
      { environment: "development" },
    ])
      safeError(
        await f.app.inject({
          method: "POST",
          url: base + "/free",
          headers: bearer,
          payload,
        }),
        400,
        "INVALID_REQUEST",
      );
    safeError(
      await f.app.inject({
        method: "POST",
        url: base + "/free",
        headers: { cookie: f.cookie, origin: webOrigin },
        payload: {},
      }),
      403,
      "FORBIDDEN",
    );
    safeError(
      await f.app.inject({
        method: "POST",
        url: base + "/free",
        headers: {
          cookie: f.cookie,
          origin: "https://help.tholi.io",
          "x-tholi-csrf": f.csrf,
        },
        payload: {},
      }),
      403,
      "FORBIDDEN",
    );
    const enrolled = await f.app.inject({
      method: "POST",
      url: base + "/free",
      headers: { cookie: f.cookie, origin: webOrigin, "x-tholi-csrf": f.csrf },
      payload: {},
    });
    expect(enrolled.statusCode).toBe(200);
    expect(freeEnrollmentSchema.parse(enrolled.json()).replayed).toBe(false);
    const replay = await f.app.inject({
      method: "POST",
      url: base + "/free",
      headers: bearer,
      payload: {},
    });
    expect(freeEnrollmentSchema.parse(replay.json()).replayed).toBe(true);
    const entitlement = await f.app.inject({ url: base, headers: bearer });
    expect(entitlement.statusCode).toBe(200);
    expect(
      productEntitlementsSchema.parse(entitlement.json()).effective?.status,
    ).toBe("active");
    expect(entitlement.headers["cache-control"]).toBe("no-store");
    safeError(
      await f.app.inject({
        url: base.replace(f.workspace.id, randomUUID()),
        headers: bearer,
      }),
      403,
      "FORBIDDEN",
    );
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: base,
          headers: bearer,
          payload: { planId: "paid-cloud" },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("keeps plan discovery absent without composition and rejects forged public query selectors", async () => {
    const uncomposed = await fixture(false, false);
    expect(
      (await uncomposed.app.inject({ url: "/api/v1/plans" })).statusCode,
    ).toBe(404);
    const f = await fixture(
      false,
      false,
      undefined,
      undefined,
      false,
      "development",
    );
    safeError(
      await f.app.inject({ url: "/api/v1/plans?environment=development" }),
      400,
      "INVALID_REQUEST",
    );
    const response = await f.app.inject({ url: "/api/v1/plans" });
    expect(
      productCatalogSchema
        .parse(response.json())
        .plans.find((plan) => plan.mode === "free-cloud"),
    ).toMatchObject({
      requiresAccount: true,
      availability: { available: true, reason: "development-fixture" },
      pricing: { status: "free", amount: "0" },
    });
  });
});

describe("credit accounting reads", () => {
  it("keeps exhausted balances and history readable without inference consent and preserves exact quantities", async () => {
    const f = await fixture(false, false, undefined, undefined, true);
    const base = `/api/v1/workspaces/${f.workspace.id}`;
    expect(f.consents).toEqual([]);
    const response = await f.app.inject({
      url: base + "/credits",
      headers: bearer,
    });
    expect(response.statusCode).toBe(200);
    expect(workspaceCreditsSchema.parse(response.json())).toMatchObject({
      balance: {
        granted: "9007199254740993",
        spent: "9007199254740993",
        available: "0",
      },
      policy: { ...fakeDevelopmentChargingPolicy, billingAvailable: false },
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    const history = await f.app.inject({
      url: base + "/credits/events?limit=1",
      headers: bearer,
    });
    expect(history.statusCode).toBe(200);
    expect(creditHistoryPageSchema.parse(history.json()).items[0].amount).toBe(
      "9007199254740993",
    );
    expect(f.scoped.listCreditHistory).toHaveBeenCalledWith({ limit: 1 });
    const usage = await f.app.inject({
      url: base + "/usage",
      headers: { cookie: f.cookie, origin: webOrigin },
    });
    expect(usage.statusCode).toBe(200);
    expect(creditUsagePageSchema.parse(usage.json())).toMatchObject({
      items: [
        {
          inputUnits: null,
          outputUnits: null,
          providerUsdMicros: null,
          chargedCredits: null,
        },
      ],
      verification: {
        independentOutcomesAvailable: false,
        costPerVerifiedSuccessUsdMicros: null,
      },
    });
    expect(
      (await f.app.inject({ url: "/api/v1/account", headers: bearer }))
        .statusCode,
    ).toBe(200);
    for (const path of ["/credits", "/credits/events", "/usage"]) {
      safeError(
        await f.app.inject({ url: base + path + "?limit=101" }),
        401,
        "UNAUTHENTICATED",
      );
      safeError(
        await f.app.inject({
          url: base.replace(f.workspace.id, randomUUID()) + path,
          headers: bearer,
        }),
        403,
        "FORBIDDEN",
      );
    }
    safeError(
      await f.app.inject({ url: base + "/usage?limit=101", headers: bearer }),
      400,
      "INVALID_REQUEST",
    );
    safeError(
      await f.app.inject({
        url: base + "/credits/events?accountId=" + f.account.id,
        headers: bearer,
      }),
      400,
      "INVALID_REQUEST",
    );
    safeError(
      await f.app.inject({
        url: base + "/credits",
        headers: { cookie: f.cookie, origin: "https://help.tholi.io" },
      }),
      403,
      "FORBIDDEN",
    );
  });

  it("advertises only composed read operations and exposes no client financial mutation", async () => {
    const f = await fixture(false, false, undefined, undefined, true);
    const capabilities = (
      await f.app.inject({ url: "/api/v1/capabilities" })
    ).json();
    expect(capabilities.capabilities).toContain("credit-accounting");
    expect(capabilities.availability.billing).toBe(false);
    const spec = (await f.app.inject({ url: "/api/v1/openapi.json" })).json();
    for (const path of ["/credits", "/credits/events", "/usage"]) {
      const route = spec.paths["/api/v1/workspaces/{workspaceId}" + path];
      expect(Object.keys(route)).toEqual(["get"]);
      expect(route.get.security).toEqual([
        { NativeBearer: [] },
        { WebSession: [] },
      ]);
      expect(
        spec["x-tholi-route-inventory"].find((entry: { path: string }) =>
          entry.path.endsWith(path),
        ).status,
      ).toBe("implemented");
    }
    const base = `/api/v1/workspaces/${f.workspace.id}/credits`;
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: base,
          headers: bearer,
          payload: { amount: "100" },
        })
      ).statusCode,
    ).toBe(404);
    const uncomposed = await fixture(false, false);
    expect(
      (await uncomposed.app.inject({ url: base, headers: bearer })).statusCode,
    ).toBe(404);
  });
});

describe("tenant authorization routes", () => {
  it("advertises exactly the six authorization operations with native/cookie security and PATCH preflight", async () => {
    const { app } = await fixture();
    const capabilities = (
      await app.inject({ url: "/api/v1/capabilities" })
    ).json();
    expect(capabilities.capabilities).toEqual(
      expect.arrayContaining(["tenant-authorization", "purpose-consent"]),
    );
    expect(capabilities.availability).toMatchObject({
      decisions: false,
      billing: false,
    });
    const openapi = (await app.inject({ url: "/api/v1/openapi.json" })).json();
    const operations = Object.values(
      openapi.paths as Record<string, Record<string, any>>,
    )
      .flatMap((path) => Object.values(path))
      .filter((operation) => operation.tags?.includes("authorization"));
    expect(operations.map((operation) => operation.operationId).sort()).toEqual(
      [
        "getWorkspacePolicies",
        "listAuthorizedWorkspaces",
        "listWorkspaceConsents",
        "listWorkspaceMemberships",
        "recordWorkspaceConsent",
        "updateWorkspaceMembership",
      ],
    );
    for (const operation of operations)
      expect(operation.security).toEqual([
        { NativeBearer: [] },
        { WebSession: [] },
      ]);
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/workspaces",
      headers: {
        origin: webOrigin,
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "content-type,x-tholi-csrf",
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-methods"]).toContain(
      "PATCH",
    );
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("derives the actor from its session, bounds actual query strings and rejects forged selectors", async () => {
    const { app, repositories, workspace, account } = await fixture();
    safeError(
      await app.inject({ url: "/api/v1/workspaces" }),
      401,
      "UNAUTHENTICATED",
    );
    const response = await app.inject({
      url: "/api/v1/workspaces?limit=1",
      headers: { ...bearer, origin: nativeOrigin },
    });
    expect(response.statusCode).toBe(200);
    expect(workspacePageSchema.parse(response.json()).nextCursor).toBe(
      workspace.id,
    );
    expect(repositories.listWorkspaces).toHaveBeenCalledWith(account.id, {
      limit: 1,
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    for (const query of [
      `accountId=${randomUUID()}`,
      `workspaceId=${workspace.id}`,
      "limit=1e2",
      "limit=101",
      "limit=1&limit=2",
    ])
      safeError(
        await app.inject({
          url: "/api/v1/workspaces?" + query,
          headers: bearer,
        }),
        400,
        "INVALID_REQUEST",
      );
    safeError(
      await app.inject({
        url: `/api/v1/workspaces/${randomUUID()}/policies`,
        headers: bearer,
      }),
      403,
      "FORBIDDEN",
    );
  });

  it("shares cookie delivery and CSRF enforcement with identity routes, without trusting admitted origins", async () => {
    const { app, workspace, csrf, cookie } = await fixture();
    const url = `/api/v1/workspaces/${workspace.id}/consents`;
    expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(
      200,
    );
    for (const origin of [nativeOrigin, "https://help.tholi.io"])
      safeError(
        await app.inject({ url, headers: { cookie, origin } }),
        403,
        "FORBIDDEN",
      );
    safeError(
      await app.inject({
        url,
        headers: { authorization: `Bearer ${webToken}` },
      }),
      401,
      "UNAUTHENTICATED",
    );
    safeError(
      await app.inject({
        url,
        headers: { cookie: `__Host-tholi_session=${nativeToken}` },
      }),
      401,
      "UNAUTHENTICATED",
    );
    const payload = {
      purpose: "cloud_inference",
      policyVersion: "1",
      granted: true,
      expectedRevision: "0",
    };
    safeError(
      await app.inject({
        method: "POST",
        url,
        headers: { cookie, origin: webOrigin },
        payload,
      }),
      403,
      "FORBIDDEN",
    );
    safeError(
      await app.inject({
        method: "POST",
        url,
        headers: { cookie, "x-tholi-csrf": csrf },
        payload,
      }),
      403,
      "FORBIDDEN",
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { cookie, origin: webOrigin, "x-tholi-csrf": csrf },
          payload,
        })
      ).statusCode,
    ).toBe(200);
  });

  it("applies current roles and existing positive revisions to membership PATCH without provisioning", async () => {
    const {
      app,
      workspace,
      membership,
      target,
      scoped,
      repositories,
      account,
    } = await fixture();
    const url = `/api/v1/workspaces/${workspace.id}/memberships/${target.accountId}`;
    const response = await app.inject({
      method: "PATCH",
      url,
      headers: bearer,
      payload: change,
    });
    expect(response.statusCode).toBe(200);
    expect(membershipSchema.parse(response.json()).revision).toBe("3");
    expect(scoped.setMembership).toHaveBeenCalledWith({
      ...change,
      accountId: target.accountId,
      expectedRevision: 2n,
    });
    expect(repositories.transaction).toHaveBeenCalledWith(
      { accountId: account.id, workspaceId: workspace.id },
      expect.any(Function),
    );
    for (const payload of [
      { ...change, accountId: randomUUID() },
      { ...change, workspaceId: randomUUID() },
      { ...change, expectedRevision: "0" },
      { ...change, role: "owner" },
    ])
      safeError(
        await app.inject({ method: "PATCH", url, headers: bearer, payload }),
        400,
        "INVALID_REQUEST",
      );
    workspace.ownerAccountId = randomUUID();
    membership.role = "admin";
    expect(
      (
        await app.inject({
          url: `/api/v1/workspaces/${workspace.id}/memberships`,
          headers: bearer,
        })
      ).statusCode,
    ).toBe(200);
    safeError(
      await app.inject({
        method: "PATCH",
        url,
        headers: bearer,
        payload: change,
      }),
      403,
      "FORBIDDEN",
    );
    membership.status = "revoked";
    safeError(
      await app.inject({
        url: `/api/v1/workspaces/${workspace.id}/policies`,
        headers: bearer,
      }),
      403,
      "FORBIDDEN",
    );
    expect(scoped.setMembership).toHaveBeenCalledTimes(1);
  });

  it("records current purpose/version consent, permits old-version withdrawal and returns safe stale-write conflicts", async () => {
    const { app, workspace, consents, scoped } = await fixture();
    const url = `/api/v1/workspaces/${workspace.id}/consents`;
    const payload = {
      purpose: "cloud_inference",
      policyVersion: "1",
      granted: true,
      expectedRevision: "0",
    };
    safeError(
      await app.inject({
        method: "POST",
        url,
        headers: bearer,
        payload: { ...payload, accountId: randomUUID() },
      }),
      400,
      "INVALID_REQUEST",
    );
    const saved = await app.inject({
      method: "POST",
      url,
      headers: bearer,
      payload,
    });
    expect(saved.statusCode).toBe(200);
    expect(consentSchema.parse(saved.json())).toMatchObject({
      purpose: "cloud_inference",
      granted: true,
      revision: "1",
    });
    const policy = policyCatalogSchema.parse(
      (
        await app.inject({
          url: `/api/v1/workspaces/${workspace.id}/policies`,
          headers: bearer,
        })
      ).json(),
    );
    expect(policy.allowedActions).toContain("inference.request");
    expect(policy.allowedActions).not.toContain("image.transmit");
    consents[0].policyVersion = "0";
    const withdrawn = await app.inject({
      method: "POST",
      url,
      headers: bearer,
      payload: {
        ...payload,
        policyVersion: "0",
        granted: false,
        expectedRevision: "1",
      },
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(consentSchema.parse(withdrawn.json())).toMatchObject({
      granted: false,
      policyVersion: "0",
      revision: "2",
    });
    scoped.recordConsent.mockRejectedValueOnce(
      new RepositoryError("CONFLICT", "PRIVATE_SQL_SENTINEL"),
    );
    safeError(
      await app.inject({ method: "POST", url, headers: bearer, payload }),
      409,
      "CONFLICT",
    );
    const after = policyCatalogSchema.parse(
      (
        await app.inject({
          url: `/api/v1/workspaces/${workspace.id}/policies`,
          headers: bearer,
        })
      ).json(),
    );
    expect(after.allowedActions).not.toContain("inference.request");
    expect(after.allowedActions).toEqual(
      expect.arrayContaining([
        "account.manage",
        "saved-data.read",
        "saved-data.export",
        "saved-data.delete",
      ]),
    );
  });

  it("does not perform a consent mutation after its HTTP deadline and redacts unexpected repository failures", async () => {
    const { app, workspace, scoped } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    scoped.getWorkspace.mockImplementationOnce(async () => {
      await gate;
      return workspace;
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${workspace.id}/consents`,
        headers: { ...bearer, "x-tholi-timeout-ms": "5" },
        payload: {
          purpose: "cloud_inference",
          policyVersion: "1",
          granted: true,
          expectedRevision: "0",
        },
      });
      expect(response.statusCode).toBe(504);
      expect(serviceErrorEnvelopeSchema.parse(response.json()).error.code).toBe(
        "DEADLINE_EXCEEDED",
      );
    } finally {
      release();
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(scoped.recordConsent).not.toHaveBeenCalled();
    scoped.getAccount.mockRejectedValueOnce(new Error("PRIVATE_SQL_SENTINEL"));
    safeError(
      await app.inject({
        url: `/api/v1/workspaces/${workspace.id}/policies`,
        headers: bearer,
      }),
      500,
      "INTERNAL_ERROR",
    );
  });
});

describe("actor-private durable job routes", () => {
  it("exposes only the three registered operations and whitelisted job metadata", async () => {
    const { app, workspace, job, scoped } = await fixture();
    const openapi = (await app.inject({ url: "/api/v1/openapi.json" })).json();
    const operations = Object.values(
      openapi.paths as Record<
        string,
        Record<string, { tags?: string[]; operationId: string }>
      >,
    )
      .flatMap((path) => Object.values(path))
      .filter((operation) => operation.tags?.includes("jobs"));
    expect(operations.map((operation) => operation.operationId).sort()).toEqual(
      ["cancelWorkspaceJob", "getWorkspaceJob", "listWorkspaceJobs"],
    );
    expect(
      (await app.inject({ url: "/api/v1/capabilities" })).json().capabilities,
    ).toContain("durable-jobs");
    const base = `/api/v1/workspaces/${workspace.id}/jobs`;
    const response = await app.inject({
      url: `${base}?limit=1&status=queued`,
      headers: bearer,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const page = jobPageSchema.parse(response.json());
    expect(page.items[0]).toMatchObject({
      id: job.id,
      revision: "1",
      status: "queued",
    });
    expect(page.nextCursor).toBe(job.id);
    expect(scoped.listJobs).toHaveBeenCalledWith({
      limit: 1,
      status: "queued",
    });
    const read = await app.inject({
      url: `${base}/${job.id}`,
      headers: bearer,
    });
    expect(jobSchema.parse(read.json())).toEqual(page.items[0]);
    expect(response.body + read.body).not.toMatch(
      /SENTINEL|recordReferences|leaseOwner|leaseToken|accountId|requestId/,
    );
    safeError(
      await app.inject({ url: `${base}/${randomUUID()}`, headers: bearer }),
      404,
      "NOT_FOUND",
    );
    safeError(
      await app.inject({
        method: "POST",
        url: base,
        headers: bearer,
        payload: {},
      }),
      404,
      "NOT_FOUND",
    );
    safeError(
      await app.inject({
        method: "POST",
        url: `${base}/${job.id}/retry`,
        headers: bearer,
        payload: {},
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("rejects forged scope and actor records even for organization admins", async () => {
    const { app, workspace, job, scoped, membership } = await fixture();
    const base = `/api/v1/workspaces/${workspace.id}/jobs`;
    safeError(await app.inject({ url: base }), 401, "UNAUTHENTICATED");
    safeError(
      await app.inject({
        url: `/api/v1/workspaces/${randomUUID()}/jobs`,
        headers: bearer,
      }),
      403,
      "FORBIDDEN",
    );
    for (const query of [
      "accountId=" + randomUUID(),
      "limit=01",
      "limit=1e1",
      "limit=1&limit=2",
      "status=unknown",
      "cursor=unused",
    ])
      safeError(
        await app.inject({ url: `${base}?${query}`, headers: bearer }),
        400,
        "INVALID_REQUEST",
      );
    membership.role = "admin";
    workspace.ownerAccountId = randomUUID();
    scoped.getJob.mockResolvedValueOnce({ ...job, accountId: randomUUID() });
    safeError(
      await app.inject({ url: `${base}/${job.id}`, headers: bearer }),
      404,
      "NOT_FOUND",
    );
    scoped.getJob.mockResolvedValueOnce({ ...job, accountId: randomUUID() });
    safeError(
      await app.inject({
        method: "POST",
        url: `${base}/${job.id}/cancel`,
        headers: bearer,
        payload: { expectedRevision: "1" },
      }),
      404,
      "NOT_FOUND",
    );
    expect(scoped.cancelJob).not.toHaveBeenCalled();
    membership.status = "revoked";
    safeError(
      await app.inject({ url: base, headers: bearer }),
      403,
      "FORBIDDEN",
    );
  });

  it("uses shared cookie/CSRF guards and reports running cancellation as intent", async () => {
    const { app, workspace, job, scoped, cookie, csrf } = await fixture();
    const url = `/api/v1/workspaces/${workspace.id}/jobs/${job.id}/cancel`;
    const payload = { expectedRevision: "1" };
    safeError(
      await app.inject({
        method: "POST",
        url,
        headers: { cookie, origin: webOrigin },
        payload,
      }),
      403,
      "FORBIDDEN",
    );
    expect(scoped.cancelJob).not.toHaveBeenCalled();
    const result = await app.inject({
      method: "POST",
      url,
      headers: { cookie, origin: webOrigin, "x-tholi-csrf": csrf },
      payload,
    });
    expect(result.statusCode).toBe(200);
    expect(jobSchema.parse(result.json())).toMatchObject({
      status: "running",
      cancelRequested: true,
      revision: "2",
    });
    expect(scoped.cancelJob).toHaveBeenCalledWith({
      id: job.id,
      expectedRevision: 1n,
    });
    for (const invalid of [
      { expectedRevision: "0" },
      { expectedRevision: 1 },
      { ...payload, accountId: randomUUID() },
      { ...payload, force: true },
    ])
      safeError(
        await app.inject({
          method: "POST",
          url,
          headers: bearer,
          payload: invalid,
        }),
        400,
        "INVALID_REQUEST",
      );
    scoped.cancelJob.mockRejectedValueOnce(
      new RepositoryError("CONFLICT", "PRIVATE_CONFLICT_SENTINEL"),
    );
    safeError(
      await app.inject({ method: "POST", url, headers: bearer, payload }),
      409,
      "CONFLICT",
    );
  });

  it("bounds wire revisions, failure/results and rejects private worker metadata", async () => {
    const { app, workspace, job } = await fixture();
    const response = await app.inject({
      url: `/api/v1/workspaces/${workspace.id}/jobs/${job.id}`,
      headers: bearer,
    });
    const dto = jobSchema.parse(response.json());
    for (const invalid of [
      { ...dto, revision: 1 },
      { ...dto, revision: "9223372036854775808" },
      { ...dto, attempts: 4 },
      { ...dto, maxAttempts: 101 },
      { ...dto, errorCode: "raw provider password" },
      { ...dto, result: { processed: 101 } },
      { ...dto, result: { processed: 1, content: "PRIVATE_RESULT_SENTINEL" } },
      { ...dto, leaseToken: "PRIVATE_FENCE_SENTINEL" },
    ])
      expect(jobSchema.safeParse(invalid).success).toBe(false);
    expect(
      cancelJobInputSchema.safeParse({ expectedRevision: "01" }).success,
    ).toBe(false);
    expect(
      jobPageQuerySchema.parse({
        limit: "50",
        after: job.id,
        status: "uncertain",
      }),
    ).toEqual({ limit: 50, after: job.id, status: "uncertain" });
  });
});
