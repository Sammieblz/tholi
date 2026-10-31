import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  SERVICE_LIMITS,
  SERVICE_TIMEOUT_HEADER,
} from "../../../packages/navigation-core/contracts-service";
import {
  NAVIGATION_FAKE_CAPABILITY,
  NAVIGATION_TRANSPORT_CAPABILITY,
  NAVIGATION_EVALUATION_CAPABILITY,
} from "../../../packages/navigation-core/contracts-navigation";
import { operatorEvaluationPlanFixture } from "../../support/operator-evaluation-fixture";
import {
  operatorEvaluationManifestSha256,
  operatorEvaluationSha256,
} from "../../../packages/navigation-core/contracts-evaluation";
import {
  navigationModelObservation,
  navigationModelValidation,
  navigationModelCapture,
} from "../../support/navigation-model-fixture";
const privateStore = vi.hoisted(() => ({
  getPrivateSetting: vi.fn(),
  setPrivateSetting: vi.fn(),
}));
vi.mock(
  "../../../apps/extension/src/platform/private-settings",
  () => privateStore,
);
const contains = vi.fn(),
  request = vi.fn(),
  launch = vi.fn(),
  fetchMock = vi.fn();
const origin = "http://127.0.0.1:8788";
const account = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  revision: "1",
};
const tokens = {
  accessToken: "a".repeat(43),
  refreshToken: "r".repeat(43),
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  sessionExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  sessionId: "00000000-0000-4000-8000-000000000003",
  account,
};
const session = {
  id: tokens.sessionId,
  clientId: "extension-firefox",
  clientKind: "extension",
  expiresAt: tokens.sessionExpiresAt,
};
let saved: unknown;
beforeEach(() => {
  saved = { origin };
  privateStore.getPrivateSetting.mockImplementation(async () => saved);
  privateStore.setPrivateSetting.mockImplementation(async (_key, value) => {
    saved = value;
  });
  contains.mockResolvedValue(true);
  request.mockResolvedValue(true);
  vi.stubGlobal("browser", {
    runtime: { getURL: () => "moz-extension://private-auth/" },
    permissions: { contains, request },
    identity: {
      getRedirectURL: () => "https://stable.extensions.allizom.org/",
      launchWebAuthFlow: launch,
    },
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

it("requests only account host and authentication consent directly in the user gesture", async () => {
  const { requestServiceAuthAccess } =
    await import("../../../apps/extension/src/platform/service-auth-access");
  const pending = requestServiceAuthAccess(origin);
  expect(request).toHaveBeenCalledWith({
    origins: ["http://127.0.0.1/*"],
    data_collection: ["authenticationInfo"],
  });
  await expect(pending).resolves.toBe(true);
});
it("verifies native state and S256 before exchanging once, keeping tokens out of panel metadata", async () => {
  let authorize: URL;
  launch.mockImplementation(async ({ url }) => {
    authorize = new URL(url);
    return `https://stable.extensions.allizom.org/?code=${"c".repeat(43)}&state=${authorize.searchParams.get("state")}`;
  });
  fetchMock
    .mockResolvedValueOnce(json(tokens))
    .mockResolvedValueOnce(json({ account, session }));
  const { serviceAuthCommand } =
    await import("../../../apps/extension/src/platform/service-auth");
  const result = await serviceAuthCommand({
    type: "AUTH_SIGN_IN",
    action: "signin",
  });
  const exchange = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(authorize!.searchParams.get("clientId")).toBe("extension-firefox");
  expect(authorize!.searchParams.get("codeChallenge")).toBe(
    createHash("sha256").update(exchange.codeVerifier).digest("base64url"),
  );
  expect(exchange.redirectUri).toBe("https://stable.extensions.allizom.org/");
  expect(fetchMock.mock.calls[0][1].credentials).toBe("omit");
  expect(saved).toEqual({ origin, tokens });
  expect(JSON.stringify(result)).not.toContain(tokens.accessToken);
  expect(JSON.stringify(result)).not.toContain(tokens.refreshToken);
  expect(result).toEqual({ configured: true, origin, account, session });
});
it.each(["wrong-state", "wrong-callback", "duplicate-code"])(
  "rejects %s without sending a broker code or retaining an earlier account",
  async (kind) => {
    saved = { origin, tokens };
    launch.mockImplementation(async ({ url }) => {
      const state = new URL(url).searchParams.get("state");
      return `${kind === "wrong-callback" ? "https://other.extensions.allizom.org/" : "https://stable.extensions.allizom.org/"}?code=${"c".repeat(43)}&state=${kind === "wrong-state" ? "bad" : state}${kind === "duplicate-code" ? "&code=duplicate" : ""}`;
    });
    const { serviceAuthCommand } =
      await import("../../../apps/extension/src/platform/service-auth");
    await expect(
      serviceAuthCommand({ type: "AUTH_SIGN_IN", action: "signin" }),
    ).rejects.toThrow("verified");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saved).toEqual({ origin });
  },
);
it("revoked native account permission blocks every authenticated request", async () => {
  saved = { origin, tokens };
  contains.mockResolvedValue(false);
  const { serviceAuthCommand } =
    await import("../../../apps/extension/src/platform/service-auth");
  await expect(serviceAuthCommand({ type: "AUTH_SESSIONS" })).rejects.toThrow(
    "revoked",
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
it("uncertain refresh clears the rotated-token capability instead of replaying it", async () => {
  saved = { origin, tokens };
  fetchMock.mockRejectedValue(new Error("PRIVATE_CONNECTION_ERROR"));
  const { serviceAuthCommand } =
    await import("../../../apps/extension/src/platform/service-auth");
  await expect(serviceAuthCommand({ type: "AUTH_REFRESH" })).rejects.toThrow(
    "could not be reached",
  );
  expect(saved).toEqual({ origin });
  await expect(serviceAuthCommand({ type: "AUTH_REFRESH" })).rejects.toThrow(
    "Sign in",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("switching the service origin cancels an in-flight account exchange and discards its late tokens", async () => {
  let complete: (response: Response) => void = () => {};
  launch.mockImplementation(
    async ({ url }) =>
      `https://stable.extensions.allizom.org/?code=${"c".repeat(43)}&state=${new URL(url).searchParams.get("state")}`,
  );
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  const { serviceAuthCommand } =
    await import("../../../apps/extension/src/platform/service-auth");
  const signingIn = serviceAuthCommand({
    type: "AUTH_SIGN_IN",
    action: "signin",
  });
  const rejected = expect(signingIn).rejects.toThrow(
    /connection changed|cancelled/,
  );
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  const exchangeSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await serviceAuthCommand({
    type: "AUTH_CONFIGURE",
    origin: "https://other-api.example.test",
  });
  expect(exchangeSignal.aborted).toBe(true);
  complete(json(tokens));
  await rejected;
  expect(saved).toEqual({ origin: "https://other-api.example.test" });
  expect(
    privateStore.setPrivateSetting.mock.calls.every(
      ([, value]) => !value.tokens,
    ),
  ).toBe(true);
});

function inferenceFixture(images = false) {
  const stored = {
    origin,
    tokens,
    inference: {
      profile: "fake",
      enabled: true,
      images,
      accountId: account.id,
      workspaceId: account.workspaceId,
    },
  };
  saved = stored;
  const capabilities = {
    protocol: "tholi-service",
    version: 1,
    implementationVersion: "0.11.0",
    supportedVersions: [1],
    capabilities: [NAVIGATION_TRANSPORT_CAPABILITY, NAVIGATION_FAKE_CAPABILITY],
    availability: {
      authentication: true,
      accountData: false,
      decisions: true,
      billing: false,
    },
    limits: SERVICE_LIMITS,
  };
  const policies = {
    workspaceId: account.workspaceId,
    role: "owner",
    allowedActions: ["consents.read", "consents.write"],
    consentPolicies: [
      { purpose: "cloud_inference", policyVersion: "3" },
      { purpose: "image_transmission", policyVersion: "4" },
    ],
  };
  const consents = {
    items: [
      {
        id: "00000000-0000-4000-8000-000000000011",
        purpose: "cloud_inference",
        policyVersion: "3",
        granted: true,
        revision: "1",
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        purpose: "image_transmission",
        policyVersion: "4",
        granted: images,
        revision: "1",
      },
    ],
  };
  const observation = navigationModelObservation();
  if (images) navigationModelCapture(observation);
  const validation = navigationModelValidation(observation);
  const input = {
    profile: "fake" as const,
    requestId: "00000000-0000-4000-8000-000000000019",
    observation,
    validation,
    policy: { timeoutMs: 25000 },
  };
  const decision = {
    protocol: observation.protocol,
    version: observation.version,
    stamp: observation.stamp,
    native: observation.native,
    decision: {
      kind: "guide",
      reference: observation.controls[0].reference,
      message: "Follow the highlighted control.",
    },
  };
  const response = {
    requestId: input.requestId,
    status: "completed",
    replayed: false,
    decision,
  };
  fetchMock.mockImplementation(async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/api/v1/capabilities") return json(capabilities);
    if (path.endsWith("/policies")) return json(policies);
    if (path.endsWith("/consents")) {
      if (init.method === "POST") {
        const body = JSON.parse(init.body);
        const consent = consents.items.find(
          (item) => item.purpose === body.purpose,
        )!;
        Object.assign(consent, {
          policyVersion: body.policyVersion,
          granted: body.granted,
          revision: String(BigInt(consent.revision) + 1n),
        });
        return json(consent);
      }
      return json(consents);
    }
    if (path.endsWith("/decisions")) return json(response);
    if (path.endsWith("/cancel"))
      return json({
        requestId: input.requestId,
        status: "pending",
        cancelRequested: true,
        cancellationConfirmed: false,
      });
    if (path.endsWith(`/decisions/${input.requestId}`))
      return json({ requestId: input.requestId, status: "completed" });
    if (path === "/api/v1/account") return json({ account, session });
    throw new Error("Unexpected fixture request");
  });
  return {
    stored,
    capabilities,
    policies,
    consents,
    input,
    response,
    decision,
    validation,
  };
}

async function operatorFixture(
  arm: "structured" | "multimodal" = "structured",
  provider: "fake" | "vertex" = "fake",
) {
  const f = inferenceFixture(arm === "multimodal");
  f.input.observation.context.goal = "Find Help";
  const manifest = {
    manifest_version: 3,
    name: "Contract fixture",
    version: "0.11.0",
  };
  const native = f.input.observation.native;
  let pageUrl = "https://github.com/microsoft/vscode";
  const tab = () => ({
    id: native.tabId,
    windowId: native.windowId,
    active: true,
    url: pageUrl,
  });
  vi.stubGlobal("browser", {
    runtime: {
      getURL: () => "chrome-extension://operator-fixture/",
      getManifest: () => manifest,
    },
    permissions: { contains, request },
    tabs: { get: vi.fn(async () => tab()), query: vi.fn(async () => [tab()]) },
    webNavigation: {
      getFrame: vi.fn(async () => ({
        documentId: native.documentId,
        url: pageUrl,
      })),
    },
  });
  const plan = operatorEvaluationPlanFixture({
    provider,
    operator: {
      accountId: account.id,
      workspaceId: account.workspaceId,
      clientId: "extension-chromium",
    },
    runtimeManifestSha256: await operatorEvaluationManifestSha256(manifest),
  });
  const trial = plan.trials.find((item) => item.arm === arm)!;
  const planJson = JSON.stringify(plan);
  const metadata = {
    profile: "operator-evaluation",
    planSha256: await operatorEvaluationSha256(planJson),
    provider,
    runtimeManifestSha256: plan.hashes.runtimeManifestSha256,
    expiresAtMs: plan.expiresAtMs,
  };
  Object.assign(f.capabilities, {
    capabilities: [
      ...f.capabilities.capabilities,
      NAVIGATION_EVALUATION_CAPABILITY,
    ],
    evaluation: metadata,
  });
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, init) =>
    String(url).endsWith("/api/v1/account")
      ? json({
          account,
          session: { ...session, clientId: "extension-chromium" },
        })
      : original(url, init),
  );
  const auth =
    await import("../../../apps/extension/src/platform/service-auth");
  const activate = () =>
    auth.serviceAuthCommand({
      type: "AUTH_EVALUATION_ACTIVATE",
      planJson,
      trialId: trial.id,
    });
  const local = () =>
    auth.serviceAuthCommand({
      type: "AUTH_INFERENCE_CONFIGURE",
      profile: "fake",
      enabled: false,
      images: false,
    });
  return {
    ...f,
    plan,
    trial,
    planJson,
    metadata,
    auth,
    activate,
    local,
    setPageUrl: (url: string) => {
      pageUrl = url;
    },
  };
}

it.each(["fake", "vertex"] as const)(
  "temporary %s operator activation is explicit, native-bound and never persisted or inherited by fake requests",
  async (provider) => {
    const f = await operatorFixture("structured", provider);
    try {
      expect(await f.activate()).toMatchObject({
        profile: "operator-evaluation",
        enabled: true,
        images: false,
        evaluation: { provider, trialId: f.trial.id },
      });
      expect(saved).not.toHaveProperty("inference");
      expect(
        JSON.stringify(privateStore.setPrivateSetting.mock.calls),
      ).not.toContain(f.planJson);
      const { backendNavigation } =
        await import("../../../apps/extension/src/platform/backend-client");
      await expect(
        backendNavigation(
          f.input,
          () => f.validation,
          vi.fn(async () => {}),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).endsWith("/decisions"),
        ),
      ).toHaveLength(0);
      const reserved = await f.auth.reserveServiceEvaluation(
        f.input.observation,
      );
      expect(reserved).toMatchObject({
        generation: 0,
        provider,
        arm: "structured",
      });
      const input = {
        ...f.input,
        profile: "operator-evaluation" as const,
        evaluation: {
          planSha256: reserved.planSha256,
          trialId: reserved.trialId,
          generation: reserved.generation,
        },
      };
      await expect(
        backendNavigation(
          input,
          () => f.validation,
          vi.fn(async () => {}),
        ),
      ).resolves.toMatchObject({ status: "completed" });
      const body = JSON.parse(
        fetchMock.mock.calls.find(([url]) =>
          String(url).endsWith("/decisions"),
        )![1].body,
      );
      expect(body).toMatchObject({
        profile: "operator-evaluation",
        evaluation: input.evaluation,
      });
      expect(body).not.toHaveProperty("plan");
      expect(body).not.toHaveProperty("planJson");
      await f.local();
      expect(
        await f.auth.serviceAuthCommand({ type: "AUTH_INFERENCE_STATUS" }),
      ).toMatchObject({ profile: "fake", enabled: false });
      expect(() => f.auth.serviceInferenceCurrent(input)).toThrow(
        "no longer current",
      );
    } finally {
      await f.local();
    }
  },
);

it.each(["manifest", "capability", "consent", "scope", "operator"])(
  "operator activation rejects changed %s before any generation",
  async (scenario) => {
    const f = await operatorFixture();
    if (scenario === "manifest")
      f.plan.hashes.runtimeManifestSha256 = "b".repeat(64);
    if (scenario === "capability") f.metadata.provider = "vertex";
    if (scenario === "consent") f.consents.items[0].granted = false;
    if (scenario === "scope") f.setPageUrl("https://github.com/pallets/flask");
    if (scenario === "operator")
      f.plan.operator.accountId = crypto.randomUUID();
    await expect(
      f.auth.serviceAuthCommand({
        type: "AUTH_EVALUATION_ACTIVATE",
        planJson:
          scenario === "manifest" || scenario === "operator"
            ? JSON.stringify(f.plan)
            : f.planJson,
        trialId: f.trial.id,
      }),
    ).rejects.toThrow();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/decisions")),
    ).toBe(false);
    await expect(
      f.auth.reserveServiceEvaluation(f.input.observation),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);

it.each(["structured", "multimodal"] as const)(
  "operator %s image policy, exact page/goal and finite generations are checked independently of the service",
  async (arm) => {
    const f = await operatorFixture(arm);
    try {
      await f.activate();
      const wrongImage = structuredClone(f.input.observation);
      if (arm === "structured") navigationModelCapture(wrongImage);
      else wrongImage.images = [];
      await expect(
        f.auth.reserveServiceEvaluation(wrongImage),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const wrongGoal = structuredClone(f.input.observation);
      wrongGoal.context.goal = "Find an undeclared destination";
      await expect(
        f.auth.reserveServiceEvaluation(wrongGoal),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      f.setPageUrl("https://github.com/microsoft/vscode?unapproved=1");
      await expect(
        f.auth.reserveServiceEvaluation(f.input.observation),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      f.setPageUrl("https://github.com/microsoft/vscode");
      const attempts = await Promise.allSettled(
        [0, 1, 2].map(() =>
          f.auth.reserveServiceEvaluation(f.input.observation),
        ),
      );
      expect(
        attempts
          .filter((item) => item.status === "fulfilled")
          .map((item) => item.status === "fulfilled" && item.value.generation),
      ).toEqual([0, 1]);
      expect(
        attempts.filter((item) => item.status === "rejected"),
      ).toHaveLength(1);
      expect(f.auth.serviceEvaluationHasGeneration()).toBe(false);
    } finally {
      await f.local();
    }
  },
);

it("operator authority expires to Local and revocation invalidates the admitted span without restoring saved inference", async () => {
  vi.useFakeTimers();
  const f = await operatorFixture();
  try {
    await f.activate();
    const signal = f.auth.serviceInferenceSignal();
    await vi.advanceTimersByTimeAsync(60001);
    expect(signal.aborted).toBe(true);
    expect(
      await f.auth.serviceAuthCommand({ type: "AUTH_INFERENCE_STATUS" }),
    ).toMatchObject({ profile: "fake", enabled: false, images: false });
    expect(saved).not.toHaveProperty("inference");
    await expect(
      f.auth.reserveServiceEvaluation(f.input.observation),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally {
    await f.local();
    vi.useRealTimers();
  }
});

it("saves explicit fake-profile processing/image consents for the current account without exposing tokens", async () => {
  const f = inferenceFixture();
  saved = { origin, tokens };
  const { serviceAuthCommand } =
    await import("../../../apps/extension/src/platform/service-auth");
  const result = await serviceAuthCommand({
    type: "AUTH_INFERENCE_CONFIGURE",
    profile: "fake",
    enabled: true,
    images: true,
  });
  expect(result).toEqual({
    configured: true,
    profile: "fake",
    enabled: true,
    images: true,
    serverConsentUpdated: true,
  });
  expect(saved).toMatchObject({
    inference: {
      profile: "fake",
      accountId: account.id,
      workspaceId: account.workspaceId,
      enabled: true,
      images: true,
    },
  });
  const posted = fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).endsWith("/consents") && init.method === "POST",
  );
  expect(posted.map(([, init]) => JSON.parse(init.body))).toContainEqual({
    purpose: "image_transmission",
    policyVersion: "4",
    granted: true,
    expectedRevision: "1",
  });
  expect(JSON.stringify(result)).not.toContain(tokens.accessToken);
  expect(JSON.stringify(result)).not.toContain(tokens.refreshToken);
  expect(
    f.consents.items.find((item) => item.purpose === "image_transmission")
      ?.granted,
  ).toBe(true);
});

it("account changes never inherit another account's inference choice", async () => {
  inferenceFixture(true);
  const { serviceAuthCommand } =
    await import("../../../apps/extension/src/platform/service-auth");
  await serviceAuthCommand({
    type: "AUTH_CONFIGURE",
    origin: "https://new-service.example.test",
  });
  expect(saved).toEqual({ origin: "https://new-service.example.test" });
  await expect(
    serviceAuthCommand({ type: "AUTH_INFERENCE_STATUS" }),
  ).resolves.toEqual({
    configured: false,
    profile: "fake",
    enabled: false,
    images: false,
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("authenticated navigation sends one bounded original attempt after current consents and the final capture guard", async () => {
  const f = inferenceFixture(true);
  const events: string[] = [];
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, init) => {
    events.push(
      new URL(url).pathname.endsWith("/decisions") ? "decision" : "metadata",
    );
    return original(url, init);
  });
  const guard = vi.fn(async () => {
    events.push("capture");
  });
  const { backendNavigation } =
    await import("../../../apps/extension/src/platform/backend-client");
  await expect(
    backendNavigation(f.input, () => f.validation, guard),
  ).resolves.toEqual(f.response);
  const decisions = fetchMock.mock.calls.filter(([url]) =>
    String(url).endsWith("/decisions"),
  );
  expect(decisions).toHaveLength(1);
  expect(events.slice(-2)).toEqual(["capture", "decision"]);
  expect(JSON.parse(decisions[0][1].body)).toEqual(f.input);
  expect(f.input.requestId).not.toBe(f.input.observation.stamp.requestId);
  expect(decisions[0][1].headers.Authorization).toBe(
    `Bearer ${tokens.accessToken}`,
  );
  expect(guard).toHaveBeenCalledOnce();
});

it.each(["original-binding", "changed-request-clock"])(
  "%s cannot use a fresh-looking current context to authorize an invalid original request",
  async (kind) => {
    const f = inferenceFixture();
    const current = structuredClone(f.validation);
    if (kind === "original-binding")
      f.input.validation.currentNative.documentId = "another-document";
    else current.requestStartedAtMs++;
    const { backendNavigation } =
      await import("../../../apps/extension/src/platform/backend-client");
    await expect(
      backendNavigation(
        f.input,
        () => current,
        vi.fn(async () => {}),
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it("a later current context cannot extend the original request deadline", async () => {
  const f = inferenceFixture();
  const current = structuredClone(f.validation);
  f.input.validation.requestDeadlineMs = current.nowMs + 500;
  const { backendNavigation } =
    await import("../../../apps/extension/src/platform/backend-client");
  await expect(
    backendNavigation(
      f.input,
      () => current,
      vi.fn(async () => {}),
    ),
  ).resolves.toEqual(f.response);
  const [, request] = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/decisions"),
  )!;
  const timeout = Number(request.headers[SERVICE_TIMEOUT_HEADER]);
  expect(timeout).toBeGreaterThan(0);
  expect(timeout).toBeLessThanOrEqual(500);
  expect(JSON.parse(request.body).validation).toEqual(f.input.validation);
});

it.each(["capture", "response"])(
  "original expiry at %s rejects the request even when current context advertises a later deadline",
  async (phase) => {
    const f = inferenceFixture();
    const current = structuredClone(f.validation);
    f.input.validation.requestDeadlineMs = current.nowMs + 500;
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (phase === "response" && String(url).endsWith("/decisions"))
        current.nowMs = f.input.validation.requestDeadlineMs;
      return original(url, init);
    });
    const { backendNavigation } =
      await import("../../../apps/extension/src/platform/backend-client");
    await expect(
      backendNavigation(
        f.input,
        () => current,
        async () => {
          if (phase === "capture")
            current.nowMs = f.input.validation.requestDeadlineMs;
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/decisions"),
      ),
    ).toHaveLength(phase === "capture" ? 0 : 1);
  },
);

it.each(["server-revoked", "live-upgrade"])(
  "%s during the final authenticated settings wait blocks page transmission",
  async (kind) => {
    const f = inferenceFixture();
    let release!: () => void;
    let reads = 0;
    privateStore.getPrivateSetting.mockImplementation(async () => {
      if (++reads === 2)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return saved;
    });
    const { backendNavigation } =
      await import("../../../apps/extension/src/platform/backend-client");
    const guard = vi.fn(async () => {});
    const operation = backendNavigation(f.input, () => f.validation, guard);
    const rejected = expect(operation).rejects.toThrow();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    if (kind === "server-revoked") f.consents.items[0].granted = false;
    else f.capabilities.capabilities = [NAVIGATION_TRANSPORT_CAPABILITY];
    release();
    await rejected;
    expect(guard).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/decisions"),
      ),
    ).toHaveLength(0);
  },
);

it("credential rotation during the final native guard prevents an upload using the old bearer", async () => {
  const f = inferenceFixture();
  const rotated = {
    ...tokens,
    accessToken: "b".repeat(43),
    refreshToken: "s".repeat(43),
  };
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, init) =>
    String(url).endsWith("/auth/refresh") ? json(rotated) : original(url, init),
  );
  const { backendNavigation } =
    await import("../../../apps/extension/src/platform/backend-client");
  const { serviceAuthCommand } =
    await import("../../../apps/extension/src/platform/service-auth");
  await expect(
    backendNavigation(
      f.input,
      () => f.validation,
      async () => {
        await serviceAuthCommand({ type: "AUTH_REFRESH" });
      },
    ),
  ).rejects.toThrow();
  expect(saved).toMatchObject({ tokens: rotated });
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/decisions")),
  ).toHaveLength(0);
});

it.each(["local-off", "image-off", "server-revoked", "live-upgrade"])(
  "%s blocks inference data without changing the legacy connection",
  async (kind) => {
    const f = inferenceFixture(true);
    if (kind === "local-off")
      f.stored.inference.enabled = f.stored.inference.images = false;
    if (kind === "image-off") f.stored.inference.images = false;
    if (kind === "server-revoked") f.consents.items[0].granted = false;
    if (kind === "live-upgrade")
      f.capabilities.capabilities = [NAVIGATION_TRANSPORT_CAPABILITY];
    const { backendNavigation } =
      await import("../../../apps/extension/src/platform/backend-client");
    await expect(
      backendNavigation(
        f.input,
        () => f.validation,
        vi.fn(async () => {}),
      ),
    ).rejects.toThrow();
    expect(
      fetchMock.mock.calls.every(
        ([url]) => !String(url).endsWith("/decisions"),
      ),
    ).toBe(true);
    expect(privateStore.setPrivateSetting).not.toHaveBeenCalled();
  },
);

it("caller cancellation while protected settings ignore abort settles the transport and prevents late egress", async () => {
  const f = inferenceFixture();
  let release!: (value: unknown) => void;
  privateStore.getPrivateSetting.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const { backendNavigation } =
    await import("../../../apps/extension/src/platform/backend-client");
  const controller = new AbortController();
  const operation = backendNavigation(
    f.input,
    () => f.validation,
    vi.fn(async () => {}),
    controller.signal,
  );
  const rejected = expect(operation).rejects.toMatchObject({
    code: "CANCELLED",
  });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  controller.abort();
  await rejected;
  release(saved);
  await Promise.resolve();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("capture invalidation after consent preflight prevents the context upload", async () => {
  const f = inferenceFixture(true);
  const controller = new AbortController();
  const guard = vi.fn(async () => {
    controller.abort();
  });
  const { backendNavigation } =
    await import("../../../apps/extension/src/platform/backend-client");
  await expect(
    backendNavigation(f.input, () => f.validation, guard, controller.signal),
  ).rejects.toMatchObject({ code: "CANCELLED" });
  expect(guard).toHaveBeenCalledOnce();
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/decisions")),
  ).toHaveLength(0);
});

it("local disable immediately aborts an in-flight span and reports unconfirmed remote withdrawal accurately", async () => {
  const f = inferenceFixture();
  let release!: (value: Response) => void;
  fetchMock.mockImplementation((url) =>
    String(url).endsWith("/capabilities")
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : Promise.reject(new Error("SYNTHETIC_OFFLINE")),
  );
  const { backendNavigation } =
    await import("../../../apps/extension/src/platform/backend-client");
  const { serviceAuthCommand } =
    await import("../../../apps/extension/src/platform/service-auth");
  const operation = backendNavigation(
    f.input,
    () => f.validation,
    vi.fn(async () => {}),
  );
  const rejected = expect(operation).rejects.toMatchObject({
    code: "CANCELLED",
  });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const disabled = await serviceAuthCommand({
    type: "AUTH_INFERENCE_CONFIGURE",
    profile: "fake",
    enabled: false,
    images: false,
  });
  await rejected;
  expect(disabled).toMatchObject({
    enabled: false,
    images: false,
    serverConsentUpdated: false,
  });
  expect(saved).not.toHaveProperty("inference");
  release(json(f.capabilities));
  await Promise.resolve();
  expect(
    fetchMock.mock.calls.every(([url]) => !String(url).endsWith("/decisions")),
  ).toBe(true);
});

it("status and cancellation remain account-scoped metadata operations without repeating generation", async () => {
  const f = inferenceFixture();
  const { backendNavigationStatus, cancelBackendNavigation } =
    await import("../../../apps/extension/src/platform/backend-client");
  expect(await backendNavigationStatus(f.input.requestId)).toEqual({
    requestId: f.input.requestId,
    status: "completed",
  });
  expect(await cancelBackendNavigation(f.input.requestId)).toEqual({
    requestId: f.input.requestId,
    status: "pending",
    cancelRequested: true,
    cancellationConfirmed: false,
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  expect(fetchMock.mock.calls[1][1].body).toBe("{}");
});

it("native permission revocation during capability discovery prevents subsequent context transmission", async () => {
  const f = inferenceFixture(true);
  let release!: (value: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const { backendNavigation } =
    await import("../../../apps/extension/src/platform/backend-client");
  const guard = vi.fn(async () => {});
  const operation = backendNavigation(f.input, () => f.validation, guard);
  const rejected = expect(operation).rejects.toThrow();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  contains.mockResolvedValue(false);
  release(json(f.capabilities));
  await rejected;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(guard).not.toHaveBeenCalled();
});

it.each(["credits", "storage"])(
  "%s exhaustion is surfaced without checkout, fallback or an automatic generation retry",
  async (reason) => {
    const f = inferenceFixture();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) =>
      String(url).endsWith("/decisions")
        ? json(
            {
              error: {
                code: "QUOTA_EXCEEDED",
                message: `${reason} allowance exhausted.`,
                requestId: f.input.requestId,
                retryable: false,
              },
            },
            429,
          )
        : original(url, init),
    );
    const { backendNavigation } =
      await import("../../../apps/extension/src/platform/backend-client");
    await expect(
      backendNavigation(
        f.input,
        () => f.validation,
        vi.fn(async () => {}),
      ),
    ).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      status: 429,
      retryable: false,
    });
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/decisions"),
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.every(([url]) => !String(url).includes("checkout")),
    ).toBe(true);
  },
);

it("a changed logical context rejects a late valid provider proposal", async () => {
  const f = inferenceFixture();
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/decisions"))
      f.validation.currentStamp.contextGeneration++;
    return original(url, init);
  });
  const { backendNavigation } =
    await import("../../../apps/extension/src/platform/backend-client");
  await expect(
    backendNavigation(
      f.input,
      () => f.validation,
      vi.fn(async () => {}),
    ),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/decisions")),
  ).toHaveLength(1);
});

it("serialized token refresh cannot restore a concurrently disabled inference choice", async () => {
  const f = inferenceFixture(true);
  const expiring = {
    ...tokens,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  };
  f.stored.tokens = expiring;
  let release!: (value: Response) => void;
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, init) =>
    String(url).endsWith("/auth/refresh")
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : original(url, init),
  );
  const { serviceAuthCommand } =
    await import("../../../apps/extension/src/platform/service-auth");
  const rotating = serviceAuthCommand({ type: "AUTH_REFRESH" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const disabling = serviceAuthCommand({
    type: "AUTH_INFERENCE_CONFIGURE",
    profile: "fake",
    enabled: false,
    images: false,
  });
  await vi.waitFor(() => expect(saved).not.toHaveProperty("inference"));
  const rotated = {
    ...tokens,
    accessToken: "b".repeat(43),
    refreshToken: "s".repeat(43),
  };
  release(json(rotated));
  await Promise.all([rotating, disabling]);
  expect(saved).toMatchObject({ tokens: rotated });
  expect(saved).not.toHaveProperty("inference");
});
