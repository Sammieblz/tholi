// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const config = vi.hoisted(() => ({
  origin: "https://api.example.test" as string | undefined,
}));
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../../apps/web/src/config/project", () => ({
  get serviceApiOrigin() {
    return config.origin;
  },
}));
vi.mock(
  "../../../packages/navigation-core/service-client",
  async (original) => ({
    ...(await original<
      typeof import("../../../packages/navigation-core/service-client")
    >()),
    serviceRequest: transport.request,
  }),
);
import {
  AccountProvider,
  useAccount,
} from "../../../apps/web/src/features/account/session";
import { ServiceClientError } from "../../../packages/navigation-core/service-client";
const session = {
  account: {
    id: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    revision: "1",
  },
  session: {
    id: "00000000-0000-4000-8000-000000000003",
    clientId: "web",
    clientKind: "web",
    expiresAt: "2030-01-01T00:00:00.000Z",
  },
  csrfToken: "c".repeat(43),
};
let current: ReturnType<typeof useAccount>;
let root: Root;
let container: HTMLDivElement;
function Probe() {
  current = useAccount();
  return createElement(
    "p",
    null,
    current.session ? "Signed in" : current.loading ? "Loading" : "Signed out",
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  config.origin = "https://api.example.test";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.resetAllMocks();
});
async function mount() {
  await act(async () => {
    root.render(createElement(AccountProvider, null, createElement(Probe)));
  });
}
it("keeps the unconfigured account boundary honest and makes no account request", async () => {
  config.origin = undefined;
  await mount();
  expect(current.configured).toBe(false);
  expect(current.loading).toBe(false);
  expect(current.authorizationUrl("signin")).toBeUndefined();
  expect(transport.request).not.toHaveBeenCalled();
});
it("uses credentialed cookie requests and CSRF for mutations without browser token storage", async () => {
  transport.request
    .mockResolvedValueOnce(session)
    .mockResolvedValueOnce(session);
  const local = vi.spyOn(Storage.prototype, "setItem");
  await mount();
  expect(current.session).toEqual(session);
  await act(async () => current.renew());
  expect(transport.request.mock.calls[0][3]).toMatchObject({
    credentials: "include",
    method: "GET",
  });
  expect(transport.request.mock.calls[1][3]).toMatchObject({
    credentials: "include",
    method: "POST",
    body: { clientId: "web" },
    headers: { "X-Tholi-CSRF": session.csrfToken },
  });
  expect(local).not.toHaveBeenCalled();
  local.mockRestore();
  expect(
    new URL(current.authorizationUrl("recover")!).searchParams.get("action"),
  ).toBe("recover");
});
it("a missing account ends loading instead of retaining mock or earlier identity", async () => {
  sessionStorage.setItem(
    "tholi-demo-account",
    JSON.stringify({ name: "Legacy identity", email: "legacy@example.test" }),
  );
  transport.request.mockRejectedValueOnce(
    new ServiceClientError("UNAUTHENTICATED", 401, "Sign in"),
  );
  await mount();
  expect(current.session).toBeUndefined();
  expect(current.loading).toBe(false);
  expect(current.error).toBe("");
  expect(container.textContent).toBe("Signed out");
  sessionStorage.clear();
});
it("sign-out cancels pending account work and rejects late results from the old session", async () => {
  let complete: (value: { items: unknown[] }) => void = () => {};
  transport.request
    .mockResolvedValueOnce(session)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValueOnce({
      signedOut: true,
      providerLogoutUrl: "https://identity.example.test/logout",
    });
  await mount();
  const pending = current.sessions();
  const rejected = expect(pending).rejects.toThrow("session changed");
  await act(async () => {
    await current.signOut();
  });
  complete({ items: [] });
  await rejected;
  expect(current.session).toBeUndefined();
  expect(transport.request.mock.calls[1][3].signal.aborted).toBe(true);
});
