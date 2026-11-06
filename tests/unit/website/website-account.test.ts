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
import {
  identityAccountResponseSchema,
  identityLogoutResponseSchema,
} from "../../../packages/navigation-core/contracts-identity";
import { AccountAnalytics } from "../../../apps/web/src/features/account/AccountAnalytics";
import { PreferencesProvider } from "../../../apps/web/src/features/preferences/PreferencesProvider";
import { AccountProvidersPage } from "../../../apps/web/src/features/account/AccountProvidersPage";
import {
  PROVIDER_CATALOG_REVISION,
  getProviderDefinition,
  type ProviderConnection,
} from "../../../packages/navigation-core/contracts-providers";
import { savedDataArtifactFixture } from "../../support/saved-data-fixture";
import { providerConnectionMetadataFixture } from "../../support/provider-connection-fixture";
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
  vi.stubGlobal("FormData", window.FormData);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  config.origin = "https://api.example.test";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

const providerEndpoint = "/api/v1/account/provider-connections";
const providerMetadata = (
  revision = "1",
  status: ProviderConnection["status"] = "active",
) => providerConnectionMetadataFixture("openai", { revision, status });
function ProviderProbe() {
  current = useAccount();
  return current.session
    ? createElement(AccountProvidersPage)
    : createElement("p", null, "Signed out");
}
async function mountProviders() {
  await act(async () =>
    root.render(
      createElement(AccountProvider, null, createElement(ProviderProbe)),
    ),
  );
}
const providerSection = () =>
  [...container.querySelectorAll<HTMLElement>(".account-provider")].find(
    (section) => section.querySelector("h2")?.textContent === "OpenAI",
  )!;
function providerFields() {
  const section = providerSection();
  return {
    section,
    form: section.querySelector("form")!,
    model: section.querySelector<HTMLSelectElement>('select[name="model"]')!,
    key: section.querySelector<HTMLInputElement>('input[name="apiKey"]')!,
  };
}
async function submitProvider(secret: string) {
  const fields = providerFields();
  fields.model.value = getProviderDefinition("openai").model;
  fields.key.value = secret;
  await act(async () =>
    fields.form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  return fields;
}
async function clickAccountControl(
  label: string,
  scope: ParentNode = container,
) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent === label,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

it("AI connections send explicit account-bound model choices once, clear the password before awaiting metadata and never verify through a model call", async () => {
  let complete!: (value: ProviderConnection) => void;
  transport.request.mockImplementation(
    async (_origin, path, _schema, options) => {
      if (path === "/api/v1/account") return session;
      if (path === "/api/v1/capabilities")
        return {
          capabilities: [
            "provider-connections",
            "provider-connections-write",
            "account-binding",
          ],
        };
      if (path === providerEndpoint && options.method === "GET")
        return { catalogRevision: PROVIDER_CATALOG_REVISION, items: [] };
      if (path === providerEndpoint && options.method === "POST")
        return new Promise((resolve) => {
          complete = resolve;
        });
      throw Error("Unexpected provider or model request.");
    },
  );
  const storage = vi.spyOn(Storage.prototype, "setItem");
  await mountProviders();
  const fields = await submitProvider("synthetic-web-provider-key");
  expect(fields.key.type).toBe("password");
  expect(fields.key.value).toBe("");
  expect(fields.model.value).toBe("");
  expect(fields.section.querySelector("fieldset")?.disabled).toBe(true);
  const mutation = transport.request.mock.calls.find(
    (call) => call[1] === providerEndpoint && call[3].method === "POST",
  )!;
  expect(mutation[3]).toMatchObject({
    credentials: "include",
    requireAccountBinding: true,
    expectedAccountId: session.account.id,
    headers: { "X-Tholi-CSRF": session.csrfToken },
    body: {
      provider: "openai",
      model: getProviderDefinition("openai").model,
      catalogRevision: PROVIDER_CATALOG_REVISION,
      apiKey: "synthetic-web-provider-key",
    },
  });
  await act(async () => complete(providerMetadata()));
  expect(providerSection().textContent).toContain("Saved, unverified.");
  expect(container.textContent).toContain("No provider request was made.");
  expect(container.innerHTML).not.toContain("synthetic-web-provider-key");
  expect(storage).not.toHaveBeenCalled();
  storage.mockRestore();
  expect(
    transport.request.mock.calls.every((call) =>
      ["/api/v1/account", "/api/v1/capabilities", providerEndpoint].includes(
        call[1],
      ),
    ),
  ).toBe(true);
});

it("AI key rotation and confirmed removal preserve revision checks and never claim provider revocation", async () => {
  let row = providerMetadata();
  transport.request.mockImplementation(
    async (_origin, path, _schema, options) => {
      if (path === "/api/v1/account") return session;
      if (path === "/api/v1/capabilities")
        return {
          capabilities: [
            "provider-connections",
            "provider-connections-write",
            "account-binding",
          ],
        };
      if (path === providerEndpoint)
        return { catalogRevision: PROVIDER_CATALOG_REVISION, items: [row] };
      if (
        path === `${providerEndpoint}/${row.id}` &&
        options.method === "PATCH"
      ) {
        expect(options.body.expectedRevision).toBe("1");
        row = providerMetadata("2");
        return row;
      }
      if (
        path === `${providerEndpoint}/${row.id}` &&
        options.method === "DELETE"
      ) {
        expect(options.body).toEqual({ expectedRevision: "2" });
        row = providerMetadata("3", "removed");
        return row;
      }
      throw Error("Unexpected provider request.");
    },
  );
  await mountProviders();
  await submitProvider("synthetic-rotated-key");
  expect(providerSection().textContent).toContain("Saved, unverified.");
  await clickAccountControl("Remove from Tholi", providerSection());
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  await clickAccountControl("Cancel", document);
  expect(
    transport.request.mock.calls.some((call) => call[3].method === "DELETE"),
  ).toBe(false);
  await clickAccountControl("Remove from Tholi", providerSection());
  await clickAccountControl("Remove connection", document);
  expect(providerSection().textContent).toContain("Disconnected from Tholi.");
  expect(container.textContent).toContain(
    "It was not revoked at the provider.",
  );
  expect(
    transport.request.mock.calls.filter((call) =>
      ["PATCH", "DELETE"].includes(call[3].method),
    ),
  ).toHaveLength(2);
});

it("a lost AI-key save response requires an explicit metadata refresh and never retains or automatically resubmits the secret", async () => {
  let saved = false;
  transport.request.mockImplementation(
    async (_origin, path, _schema, options) => {
      if (path === "/api/v1/account") return session;
      if (path === "/api/v1/capabilities")
        return {
          capabilities: [
            "provider-connections",
            "provider-connections-write",
            "account-binding",
          ],
        };
      if (path === providerEndpoint && options.method === "GET")
        return {
          catalogRevision: PROVIDER_CATALOG_REVISION,
          items: saved ? [providerMetadata()] : [],
        };
      if (path === providerEndpoint && options.method === "POST") {
        saved = true;
        throw new ServiceClientError(
          "NETWORK_ERROR",
          0,
          "The response was lost.",
        );
      }
      throw Error("Unexpected provider request.");
    },
  );
  await mountProviders();
  await submitProvider("synthetic-lost-key");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Refresh connections",
  );
  expect(providerFields().key.value).toBe("");
  await clickAccountControl("Refresh connections");
  expect(providerSection().textContent).toContain("Saved, unverified.");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.innerHTML).not.toContain("synthetic-lost-key");
  expect(
    transport.request.mock.calls.filter(
      (call) => call[1] === providerEndpoint && call[3].method === "POST",
    ),
  ).toHaveLength(1);
});

it("an AI-key operation from a replaced account is aborted and cannot populate the new account view", async () => {
  let actor = session,
    complete!: (value: ProviderConnection) => void;
  transport.request.mockImplementation(
    async (_origin, path, _schema, options) => {
      if (path === "/api/v1/account") return actor;
      if (path === "/api/v1/capabilities")
        return {
          capabilities: [
            "provider-connections",
            "provider-connections-write",
            "account-binding",
          ],
        };
      if (path === providerEndpoint && options.method === "GET")
        return { catalogRevision: PROVIDER_CATALOG_REVISION, items: [] };
      if (path === providerEndpoint && options.method === "POST")
        return new Promise((resolve) => {
          complete = resolve;
        });
      throw Error("Unexpected provider request.");
    },
  );
  await mountProviders();
  await submitProvider("synthetic-old-account-key");
  const mutation = transport.request.mock.calls.find(
    (call) => call[1] === providerEndpoint && call[3].method === "POST",
  )!;
  actor = {
    ...session,
    account: {
      ...session.account,
      id: "00000000-0000-4000-8000-000000000004",
      workspaceId: "00000000-0000-4000-8000-000000000005",
    },
    session: { ...session.session, id: "00000000-0000-4000-8000-000000000006" },
  };
  await act(async () => current.reload());
  expect(mutation[3].signal.aborted).toBe(true);
  await act(async () => complete(providerMetadata()));
  expect(providerSection().textContent).toContain("No key saved.");
  expect(container.textContent).not.toContain("Connection saved.");
  expect(
    transport.request.mock.calls.filter(
      (call) => call[1] === providerEndpoint && call[3].method === "POST",
    ),
  ).toHaveLength(1);
});

it("disabled AI-key storage retains metadata and confirmed removal while every key input stays disabled", async () => {
  transport.request.mockImplementation(async (_origin, path) => {
    if (path === "/api/v1/account") return session;
    if (path === "/api/v1/capabilities")
      return { capabilities: ["provider-connections", "account-binding"] };
    if (path === providerEndpoint)
      return {
        catalogRevision: PROVIDER_CATALOG_REVISION,
        items: [providerMetadata()],
      };
    throw Error("Unexpected provider request.");
  });
  await mountProviders();
  expect(container.textContent).toContain("Key storage is disabled");
  expect(
    [...container.querySelectorAll("fieldset")].every(
      (field) => field.disabled,
    ),
  ).toBe(true);
  expect(
    [...providerSection().querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Remove from Tholi",
    )?.disabled,
  ).toBe(false);
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

it("a retained account view cannot send requests or discard a replacement account's approved cloud work", async () => {
  let actor = session;
  transport.request.mockImplementation(
    async (_origin, path, _schema, options) => {
      if (path === "/api/v1/account") return actor;
      if (path === "/api/v1/capabilities")
        return { capabilities: ["saved-data-write", "account-binding"] };
      if (path.endsWith("/artifacts") && options.method === "POST")
        throw new Error("offline");
      throw new Error("A stale account action reached transport.");
    },
  );
  await mount();
  const previous = current;
  actor = {
    ...session,
    account: {
      ...session.account,
      id: "00000000-0000-4000-8000-000000000004",
      workspaceId: "00000000-0000-4000-8000-000000000005",
    },
    session: { ...session.session, id: "00000000-0000-4000-8000-000000000006" },
  };
  await act(async () => current.reload());
  await expect(
    current.savedData.save(savedDataArtifactFixture("preferences"), "0"),
  ).rejects.toThrow("offline");
  const approved = (await current.savedData.cached()).outbox,
    sent = transport.request.mock.calls.length;
  expect(approved).toHaveLength(1);
  await expect(
    previous.request("/api/v1/account", identityAccountResponseSchema),
  ).rejects.toMatchObject({ code: "CANCELLED" });
  await expect(
    previous.request(
      "/api/v1/auth/logout",
      identityLogoutResponseSchema,
      "POST",
      { all: false },
    ),
  ).rejects.toMatchObject({ code: "CANCELLED" });
  await expect(previous.signOut()).rejects.toMatchObject({ code: "CANCELLED" });
  await expect(previous.completeDeletion()).rejects.toMatchObject({
    code: "CANCELLED",
  });
  expect(transport.request).toHaveBeenCalledTimes(sent);
  expect(current.session?.account).toEqual(actor.account);
  expect((await current.savedData.cached()).outbox).toEqual(approved);
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
