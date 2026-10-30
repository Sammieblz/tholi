import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
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
  return new Response(JSON.stringify(value), { status });
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
