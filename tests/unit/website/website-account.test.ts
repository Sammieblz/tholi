// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
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
import { AccountAnalytics } from "../../../apps/web/src/features/account/AccountAnalytics";
import { PreferencesProvider } from "../../../apps/web/src/features/preferences/PreferencesProvider";
import { savedDataArtifactFixture } from "../../support/saved-data-fixture";
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
  vi.stubGlobal("indexedDB", new IDBFactory());
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
  vi.unstubAllGlobals();
  document.cookie = "tholi_consent=; Path=/; Max-Age=0";
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

it("same-account reload preserves durable pending cloud work while explicit logout removes it", async () => {
  transport.request.mockImplementation(
    async (_origin, path, _schema, options) => {
      if (path === "/api/v1/account") return session;
      if (path === "/api/v1/capabilities")
        return { capabilities: ["saved-data-write", "account-binding"] };
      if (path.endsWith("/artifacts") && options.method === "POST")
        throw new Error("offline");
      if (path.endsWith("/auth/logout"))
        return {
          signedOut: true,
          providerLogoutUrl: "https://identity.example.test/logout",
        };
      throw new Error("Unexpected account request.");
    },
  );
  await mount();
  await expect(
    current.savedData.save(savedDataArtifactFixture("preferences"), "0"),
  ).rejects.toThrow("offline");
  expect((await current.savedData.cached()).outbox).toHaveLength(1);
  await act(async () => current.reload());
  expect((await current.savedData.cached()).outbox).toHaveLength(1);
  await act(async () => {
    await current.signOut();
  });
  expect(current.session).toBeUndefined();
  await act(async () => current.reload());
  expect((await current.savedData.cached()).outbox).toEqual([]);
});

it("peer account notices abort stale work and reload verified identity without trusting channel identities or broadcasting loops", async () => {
  const peers = new Set<PeerChannel>(),
    notices: unknown[] = [];
  class PeerChannel {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(readonly name: string) {
      peers.add(this);
    }
    postMessage(data: unknown) {
      notices.push(structuredClone(data));
      for (const peer of peers)
        if (peer !== this && peer.name === this.name)
          peer.onmessage?.({ data });
    }
    close() {
      peers.delete(this);
    }
  }
  vi.stubGlobal("BroadcastChannel", PeerChannel);
  const second = {
    ...session,
    account: {
      ...session.account,
      id: "00000000-0000-4000-8000-000000000004",
      workspaceId: "00000000-0000-4000-8000-000000000005",
    },
    session: { ...session.session, id: "00000000-0000-4000-8000-000000000006" },
  };
  let actor = session,
    accountReads = 0,
    complete!: (value: { items: [] }) => void,
    provePreviousTab!: (value: typeof session) => void;
  transport.request.mockImplementation(
    async (_origin, path, _schema, options) => {
      if (path === "/api/v1/account") {
        accountReads++;
        if (accountReads === 3)
          return new Promise((resolve) => {
            provePreviousTab = resolve;
          });
        return actor;
      }
      if (path === "/api/v1/capabilities")
        return { capabilities: ["saved-data-write", "account-binding"] };
      if (path.endsWith("/artifacts") && options.method === "POST")
        throw new Error("offline");
      if (path === "/api/v1/account/sessions")
        return new Promise((resolve) => {
          complete = resolve;
        });
      throw new Error("Unexpected account request.");
    },
  );
  await mount();
  await expect(
    current.savedData.save(savedDataArtifactFixture("preferences"), "0"),
  ).rejects.toThrow("offline");
  const pending = current.sessions(),
    rejected = pending.catch((error: unknown) => error);
  const originalSignal = transport.request.mock.calls.find(
    (call) => call[1] === "/api/v1/account/sessions",
  )![3].signal;
  expect(
    transport.request.mock.calls.find(
      (call) => call[1] === "/api/v1/account/sessions",
    )![3].expectedAccountId,
  ).toBe(session.account.id);
  actor = second;
  const peerContainer = document.createElement("div"),
    peerRoot = createRoot(peerContainer);
  let peerAccount!: ReturnType<typeof useAccount>;
  function PeerProbe() {
    peerAccount = useAccount();
    return createElement("span", null, "Peer");
  }
  document.body.append(peerContainer);
  try {
    await act(async () =>
      peerRoot.render(
        createElement(AccountProvider, null, createElement(PeerProbe)),
      ),
    );
    await vi.waitFor(() => {
      expect(peerAccount.session?.account).toEqual(second.account);
      expect(provePreviousTab).toBeTypeOf("function");
    });
    expect(originalSignal.aborted).toBe(true);
    await expect(
      peerAccount.savedData.save(savedDataArtifactFixture("preferences"), "0"),
    ).rejects.toThrow("offline");
    const approved = (await peerAccount.savedData.cached()).outbox;
    expect(approved).toHaveLength(1);
    await act(async () => provePreviousTab(second));
    await vi.waitFor(() =>
      expect(current.session?.account).toEqual(second.account),
    );
    expect((await peerAccount.savedData.cached()).outbox).toEqual(approved);
    expect((await current.savedData.cached()).outbox).toEqual(approved);
    complete({ items: [] });
    expect(String(await rejected)).toContain("session changed");
    const count = notices.length;
    const forged = new PeerChannel("tholi-account-lifecycle-v1");
    await act(async () =>
      forged.postMessage({
        type: "account-change",
        source: crypto.randomUUID(),
        scope: {
          accountId: "00000000-0000-4000-8000-000000000099",
          workspaceId: "00000000-0000-4000-8000-000000000098",
        },
      }),
    );
    forged.close();
    await vi.waitFor(() =>
      expect(current.session?.account).toEqual(second.account),
    );
    await vi.waitFor(() =>
      expect(peerAccount.session?.account).toEqual(second.account),
    );
    expect((await peerAccount.savedData.cached()).outbox).toEqual(approved);
    expect((await current.savedData.cached()).outbox).toEqual(approved);
    expect(
      transport.request.mock.calls.filter(
        (call) => call[1].endsWith("/artifacts") && call[3].method === "POST",
      ),
    ).toHaveLength(2);
    expect(notices).toHaveLength(count + 1);
    expect(JSON.stringify(notices)).not.toContain(session.csrfToken);
    expect(JSON.stringify(notices)).not.toMatch(
      /accessToken|refreshToken|csrfToken/,
    );
  } finally {
    complete({ items: [] });
    await rejected;
    act(() => peerRoot.unmount());
    peerContainer.remove();
  }
});
it("uses credentialed cookie requests and CSRF for mutations without browser token storage", async () => {
  transport.request
    .mockResolvedValueOnce(session)
    .mockResolvedValueOnce(session)
    .mockResolvedValueOnce({ items: [] });
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
  await act(async () => current.sessions());
  expect(transport.request.mock.calls[2][3]).toMatchObject({
    credentials: "include",
    method: "GET",
    headers: undefined,
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
it("sign-out and account changes cancel old work without replacing the new account", async () => {
  let complete: (value: { items: unknown[] }) => void = () => {};
  const nextSession = {
    ...session,
    account: {
      ...session.account,
      id: "00000000-0000-4000-8000-000000000004",
      workspaceId: "00000000-0000-4000-8000-000000000005",
    },
    session: {
      ...session.session,
      id: "00000000-0000-4000-8000-000000000006",
    },
  };
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
    })
    .mockResolvedValueOnce(nextSession);
  await mount();
  const pending = current.sessions();
  const rejected = expect(pending).rejects.toThrow("session changed");
  await act(async () => {
    await current.signOut();
  });
  expect(current.session).toBeUndefined();
  await act(async () => current.reload());
  expect(current.session).toEqual(nextSession);
  complete({ items: [] });
  await rejected;
  expect(current.session).toEqual(nextSession);
  expect(transport.request.mock.calls[1][3].signal.aborted).toBe(true);
});

it("requires separate account and browser consent and aborts pending collection immediately on withdrawal", async () => {
  let granted = false;
  let revision = 0;
  let complete!: (value: { recorded: boolean }) => void;
  let eventSignal: AbortSignal | undefined;
  const sent: unknown[] = [];
  transport.request.mockImplementation(
    async (_origin, path: string, _schema, options) => {
      if (path === "/api/v1/account") return session;
      if (path === "/api/v1/capabilities")
        return { capabilities: ["product-analytics"] };
      if (path.endsWith("/policies"))
        return {
          consentPolicies: [
            { purpose: "product_analytics", policyVersion: "1" },
          ],
        };
      if (path.endsWith("/consents")) {
        if (options.method === "GET") return { items: [] };
        granted = options.body.granted;
        revision++;
        return {
          id: "00000000-0000-4000-8000-000000000035",
          purpose: "product_analytics",
          policyVersion: "1",
          granted,
          revision: String(revision),
        };
      }
      if (path.endsWith("/analytics/events") && options.method === "POST") {
        sent.push(options.body);
        eventSignal = options.signal;
        return new Promise((resolve) => {
          complete = resolve;
        });
      }
      throw new Error("Unexpected account measurement request.");
    },
  );
  await act(async () =>
    root.render(
      createElement(
        PreferencesProvider,
        null,
        createElement(AccountProvider, null, createElement(AccountAnalytics)),
      ),
    ),
  );
  const choices = [
    ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ];
  expect(choices).toHaveLength(2);
  expect(choices.map((input) => input.checked)).toEqual([false, false]);
  expect(sent).toEqual([]);
  await act(async () => choices[0].click());
  expect(granted).toBe(true);
  expect(sent).toEqual([]);
  await act(async () => choices[1].click());
  expect(sent).toEqual([
    {
      schemaVersion: 1,
      eventId: expect.any(String),
      event: { name: "page_view", page: "account" },
    },
  ]);
  expect(eventSignal?.aborted).toBe(false);
  await act(async () => choices[0].click());
  expect(eventSignal?.aborted).toBe(true);
  expect(granted).toBe(false);
  await act(async () => complete({ recorded: true }));
  expect(sent).toHaveLength(1);
  expect(container.textContent).toContain(
    "Account permission withdrawn and retained product measurements removed.",
  );
});
