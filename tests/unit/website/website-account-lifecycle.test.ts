// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { accountExportPartSchema } from "../../../packages/navigation-core/contracts-account";
import { IndexedDBCloudDataStore } from "../../../packages/site-memory/cloud-data";
import { savedDataArtifactFixture } from "../../support/saved-data-fixture";
const transport = vi.hoisted(() => ({ request: vi.fn() }));
const view = vi.hoisted(() => ({ summary: undefined as unknown }));
vi.mock("../../../apps/web/src/config/project", () => ({
  serviceApiOrigin: "https://api.example.test",
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
vi.mock(
  "../../../apps/web/src/features/account/useAccountSummary",
  async (original) => ({
    ...(await original<
      typeof import("../../../apps/web/src/features/account/useAccountSummary")
    >()),
    useAccountSummary: () => view.summary,
  }),
);
vi.mock("../../../apps/web/src/features/account/AccountAnalytics", () => ({
  AccountAnalytics: () => null,
}));
vi.mock("../../../apps/web/src/app/router", () => ({
  SiteLink: ({
    to,
    children,
    ...props
  }: {
    to: string;
    children: React.ReactNode;
  }) => createElement("a", { ...props, href: to }, children),
}));
import {
  AccountProvider,
  useAccount,
} from "../../../apps/web/src/features/account/session";
import { WelcomePage } from "../../../apps/web/src/features/account/WelcomePage";
import {
  accountFileMetadata,
  readAccountFile,
} from "../../../apps/web/src/features/account/AccountFileDelivery";
const origin = "https://api.example.test";
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
    expiresAt: "2030-01-01T00:00:00Z",
  },
  csrfToken: "c".repeat(43),
};
let current: ReturnType<typeof useAccount>,
  root: Root,
  container: HTMLDivElement;
function Probe({ security }: { security: boolean }) {
  current = useAccount();
  return security
    ? createElement(WelcomePage, { path: "/account/security" })
    : null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
  vi.resetAllMocks();
  view.summary = {
    loading: false,
    errors: {},
    refresh: vi.fn(),
    profile: {
      accountId: session.account.id,
      verifiedEmail: null,
      provider: {
        managementUrl: null,
        recoveryAvailable: false,
        verificationAvailable: false,
      },
    },
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount(security = false) {
  await act(async () =>
    root.render(
      createElement(AccountProvider, null, createElement(Probe, { security })),
    ),
  );
}
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent === text,
  )!;
async function click(text: string) {
  await act(async () => button(text).click());
}

it("account export and deletion availability stays unknown while discovery is pending or fails and becomes actionable only after a successful response", async () => {
  let ready!: (capabilities: string[]) => void, fail!: (reason: Error) => void;
  transport.request.mockImplementation(async (_origin, path, schema) => {
    if (path === "/api/v1/account") return schema.parse(session);
    if (path === "/api/v1/account/sessions") return schema.parse({ items: [] });
    if (path === "/api/v1/capabilities")
      return new Promise((resolve, reject) => {
        ready = (capabilities) => resolve({ capabilities });
        fail = reject;
      });
    if (path === "/api/v1/account/exports?limit=10")
      return schema.parse({ items: [] });
    throw new Error("Unexpected availability request.");
  });
  const absentClaims = () => {
    expect(container.textContent).not.toContain(
      "Account export is not available from this service",
    );
    expect(container.textContent).not.toContain(
      "Account deletion is not enabled on this service",
    );
  };
  await mount(true);
  expect(container.textContent).toContain(
    "Checking account export and deletion availability.",
  );
  absentClaims();
  expect(!!button("Delete account")).toBe(false);
  await act(async () => ready(["account-export", "account-deletion"]));
  expect(!!button("Export account data")).toBe(true);
  expect(
    container.querySelector("#account-delete-confirmation"),
  ).not.toBeNull();
  absentClaims();
  await mount(false);
  await mount(true);
  absentClaims();
  await act(async () =>
    fail(new Error("Private discovery diagnostic must not render")),
  );
  expect(container.textContent).toContain(
    "Account export and deletion availability could not be checked.",
  );
  expect(container.textContent).not.toContain("Private discovery diagnostic");
  expect(!!button("Delete account")).toBe(false);
  absentClaims();
  await mount(false);
  await mount(true);
  await act(async () => ready([]));
  expect(container.textContent).toContain(
    "Account export is not available from this service",
  );
  expect(container.textContent).toContain(
    "Account deletion is not enabled on this service",
  );
  expect(
    transport.request.mock.calls.every((call) => call[3].method === "GET"),
  ).toBe(true);
});

it.each(["metadata-id", "foreign-account", "generation", "digest", "valid"])(
  "private account-export delivery binds metadata, actor, generation and declared digest before returning content (%s)",
  async (mode) => {
    const file = {
        id: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        revision: "1",
        expiresAt: "2030-01-01T00:00:00Z",
        status: "ready",
      },
      generation = crypto.randomUUID(),
      part = accountExportPartSchema.parse({
        schemaVersion: 1,
        kind: "account-export-part",
        generation,
        accountId: session.account.id,
        workspaceId: null,
        cutoff: "2026-10-31T12:00:00Z",
        section: "profile",
        items: [
          {
            accountId: session.account.id,
            revision: "1",
            createdAt: "2026-10-01T12:00:00Z",
            updatedAt: "2026-10-31T12:00:00Z",
          },
        ],
      }),
      bytes = Buffer.from(JSON.stringify(part)),
      expected = {
        generation,
        part: {
          fileId: file.id,
          section: "profile" as const,
          workspaceId: null,
          count: 1,
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      };
    const delivered =
      mode === "foreign-account"
        ? { ...part, accountId: crypto.randomUUID() }
        : mode === "generation"
          ? { ...part, generation: crypto.randomUUID() }
          : mode === "digest"
            ? { ...part, items: [{ ...part.items[0], revision: "2" }] }
            : part;
    transport.request.mockImplementation(async (_origin, path, schema) => {
      if (path === "/api/v1/account") return schema.parse(session);
      if (path === `/api/v1/account/files/${file.id}`)
        return schema.parse({
          ...file,
          id: mode === "metadata-id" ? crypto.randomUUID() : file.id,
        });
      if (path.endsWith("/link"))
        return schema.parse({
          url: `${origin}/api/v1/account/files/${file.id}/download?token=synthetic-token`,
          expiresAt: file.expiresAt,
        });
      if (path.includes("/download?")) return schema.parse(delivered);
      throw new Error("Unexpected private-file request.");
    });
    await mount();
    const signal = new AbortController().signal;
    if (mode === "metadata-id") {
      await expect(
        accountFileMetadata(current, file.id, signal),
      ).rejects.toThrow();
      expect(
        transport.request.mock.calls.some((call) => call[1].endsWith("/link")),
      ).toBe(false);
    } else {
      const metadata = await accountFileMetadata(current, file.id, signal),
        reading = readAccountFile(
          current,
          metadata,
          accountExportPartSchema,
          4096,
          signal,
          expected,
        );
      if (mode === "valid") await expect(reading).resolves.toEqual(part);
      else await expect(reading).rejects.toThrow();
    }
  },
);

it("deletion is not announced before acceptance and accepted cleanup signs out and clears only cloud state even while the network is offline", async () => {
  const posted = vi.fn();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      onmessage = null;
      postMessage = posted;
      close() {}
    },
  );
  let accept!: (result: unknown) => void,
    offline = false;
  transport.request.mockImplementation(
    async (_origin, path, schema, options) => {
      if (offline) throw new Error("Network offline after server acceptance.");
      if (path === "/api/v1/account") return schema.parse(session);
      if (path === "/api/v1/account/sessions")
        return schema.parse({ items: [] });
      if (path === "/api/v1/capabilities")
        return {
          capabilities: [
            "account-deletion",
            "saved-data-write",
            "account-binding",
          ],
        };
      if (path.endsWith("/artifacts") && options.method === "POST")
        throw new Error("offline");
      if (path === "/api/v1/account/deletion")
        return new Promise((resolve) => {
          accept = (value) => resolve(schema.parse(value));
        });
      throw new Error("Unexpected account lifecycle request.");
    },
  );
  await mount(true);
  await expect(
    current.savedData.save(savedDataArtifactFixture("preferences"), "0"),
  ).rejects.toThrow("offline");
  expect((await current.savedData.cached()).outbox).toHaveLength(1);
  const confirmation = container.querySelector<HTMLInputElement>(
    "#account-delete-confirmation",
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(confirmation, "DELETE");
    confirmation.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Delete account");
  await click("Request account deletion");
  expect(accept).toBeTypeOf("function");
  expect(container.textContent).not.toContain(
    "Your account deletion request was accepted",
  );
  const sent = transport.request.mock.calls.length;
  offline = true;
  await act(async () =>
    accept({
      requestId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      status: "deletion_pending",
      signedOut: true,
      retained: [
        "identity-and-abuse-prevention",
        "financial-liabilities",
        "security-audit",
        "deletion-tombstones",
      ],
    }),
  );
  expect(container.textContent).toContain(
    "Your account deletion request was accepted. You are signed out while deletion continues.",
  );
  expect(current.session).toBeUndefined();
  const store = new IndexedDBCloudDataStore();
  expect(
    (
      await store.read(
        {
          serviceOrigin: origin,
          accountId: session.account.id,
          workspaceId: session.account.workspaceId,
        },
        () => {},
      )
    ).outbox,
  ).toEqual([]);
  expect(transport.request).toHaveBeenCalledTimes(sent);
  expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({
    type: "account-change",
    scope: null,
  });
});

it("confirmed sign-out preserves its explicit provider link after the security view unmounts and never reuses it for a later account", async () => {
  let actor = session;
  transport.request.mockImplementation(async (_origin, path, schema) => {
    if (path === "/api/v1/account") return schema.parse(actor);
    if (path === "/api/v1/account/sessions") return schema.parse({ items: [] });
    if (path === "/api/v1/capabilities") return { capabilities: [] };
    if (path === "/api/v1/auth/logout")
      return schema.parse({
        signedOut: true,
        providerLogoutUrl: "https://identity.example.test/logout",
      });
    throw new Error("Unexpected sign-out request.");
  });
  await mount(true);
  const originalSignOut = current.signOut;
  let closing!: Promise<string>;
  vi.spyOn(current, "signOut").mockImplementation(
    (all) => (closing = originalSignOut(all)),
  );
  await act(async () => {
    button("Sign out").click();
    await closing;
  });
  expect(current.session).toBeUndefined();
  const provider = container.querySelector<HTMLAnchorElement>(
    'a[href="https://identity.example.test/logout"]',
  )!;
  expect(provider.textContent).toBe(
    "Review sign-out with your identity provider",
  );
  expect(provider.target).toBe("_blank");
  expect(provider.rel).toContain("noopener");
  expect(provider.rel).toContain("noreferrer");
  expect(container.textContent).toContain("Signed out of Tholi.");
  actor = {
    ...session,
    account: {
      ...session.account,
      id: "00000000-0000-4000-8000-000000000004",
      workspaceId: "00000000-0000-4000-8000-000000000005",
    },
    session: { ...session.session, id: "00000000-0000-4000-8000-000000000006" },
  };
  view.summary = { loading: false, errors: {}, refresh: vi.fn() };
  await act(async () => current.reload());
  expect(current.session?.account).toEqual(actor.account);
  expect(
    container.querySelector('a[href="https://identity.example.test/logout"]'),
  ).toBeNull();
  await act(async () => current.signOut());
  expect(current.session).toBeUndefined();
  expect(
    container.querySelector('a[href="https://identity.example.test/logout"]'),
  ).toBeNull();
});
