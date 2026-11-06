// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  PrivateLearningPanel,
  type PrivateLearningPanelProps,
} from "../../../packages/ui/PrivateLearningPanel";

const state = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  requestAccess: vi.fn(),
  connect: vi.fn(),
  account: undefined as unknown,
}));
vi.mock("../../../apps/extension/src/platform/api", () => ({
  api: { runtime: { sendMessage: state.sendMessage, connect: state.connect } },
}));
vi.mock("../../../apps/extension/src/platform/site-access", () => ({
  requestBackendAccess: state.requestAccess,
}));
vi.mock("../../../apps/web/src/features/account/session", () => ({
  useAccount: () => state.account,
}));
import { PrivateLearningSettings } from "../../../apps/extension/src/ui/features/account/PrivateLearningSettings";
import { SiteLearningControls } from "../../../apps/web/src/features/account/SiteLearningControls";

let root: Root;
let container: HTMLDivElement;
const settings = () => ({
  origin: "https://example.test",
  revision: "1",
  collect: false,
  use: false,
  updatedAt: null,
});
const account = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
};
const pinned = () => ({
  sessionId: "00000000-0000-4000-8000-000000000003",
  tabId: 7,
  documentId: "native-document",
  origin: settings().origin,
  routeId: "live",
  routeVersion: "1",
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  state.connect.mockReturnValue({
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    disconnect: vi.fn(),
  });
  state.requestAccess.mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = async (element: ReactNode) => {
  await act(async () => root.render(element));
};
const button = (name: string, within: ParentNode = container) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === name,
  )!;
const click = async (name: string, within?: ParentNode) => {
  await act(async () => button(name, within).click());
};
const panel = (): PrivateLearningPanelProps => ({
  origin: settings().origin,
  settings: settings(),
  busy: false,
  onSave: vi.fn(),
  onRefresh: vi.fn(),
  onForget: vi.fn(),
});

test("shared learning choices remain acknowledged, labeled and disabled while unknown or busy", async () => {
  const props = panel();
  await render(createElement(PrivateLearningPanel, props));
  const input = container.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  expect(input.closest("label")?.textContent).toContain(
    "Save future website knowledge",
  );
  await act(async () => input.click());
  expect(props.onSave).toHaveBeenCalledExactlyOnceWith({
    collect: true,
    use: false,
  });
  expect(input.checked).toBe(false);
  expect(container.textContent).toContain("not uploaded automatically");
  await render(createElement(PrivateLearningPanel, { ...props, busy: true }));
  expect(container.querySelector("fieldset")?.disabled).toBe(true);
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  await render(
    createElement(PrivateLearningPanel, {
      ...props,
      settings: undefined,
      error: "Refresh before retrying.",
    }),
  );
  expect(container.querySelector("fieldset")?.disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Refresh before retrying.",
  );
  await click("Refresh learning settings");
  expect(props.onRefresh).toHaveBeenCalledOnce();
});

test("cloud deletion requires the existing accessible confirmation primitive and preserves cancellation", async () => {
  const props = panel();
  await render(createElement(PrivateLearningPanel, props));
  await click("Forget cloud knowledge");
  const dialog = document.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain(
    "Local memory, saved routes and conversation excerpts are unchanged",
  );
  expect(props.onForget).not.toHaveBeenCalled();
  await click("Cancel", dialog);
  expect(props.onForget).not.toHaveBeenCalled();
  await click("Forget cloud knowledge");
  await click(
    "Forget cloud knowledge",
    document.querySelector('[role="alertdialog"]')!,
  );
  expect(props.onForget).toHaveBeenCalledOnce();
});

test("extension enabling starts the native grant in the original gesture and reductions never request one", async () => {
  let confirmed = settings();
  state.sendMessage.mockImplementation(async (message) => {
    if (message.type === "GET_SESSION") return pinned();
    if (message.type === "SAVED_DATA_SITE_SETTINGS") return confirmed;
    if (message.type === "SAVED_DATA_SITE_CONFIGURE") {
      confirmed = {
        ...confirmed,
        collect: message.choice.collect,
        use: message.choice.use,
        revision: "2",
      };
      return confirmed;
    }
    throw new Error("Unexpected RPC.");
  });
  await render(
    createElement(PrivateLearningSettings, {
      account,
      serviceOrigin: "https://service.example.test",
    }),
  );
  let approve!: (allowed: boolean) => void;
  state.requestAccess.mockReturnValue(
    new Promise<boolean>((resolve) => {
      approve = resolve;
    }),
  );
  await act(async () =>
    container.querySelector<HTMLInputElement>("input")!.click(),
  );
  expect(state.requestAccess).toHaveBeenCalledExactlyOnceWith(
    "https://service.example.test",
  );
  expect(
    state.sendMessage.mock.calls.some(
      ([message]) => message.type === "SAVED_DATA_SITE_CONFIGURE",
    ),
  ).toBe(false);
  await act(async () => approve(true));
  expect(state.sendMessage).toHaveBeenCalledWith({
    type: "SAVED_DATA_SITE_CONFIGURE",
    scope: { accountId: account.id, workspaceId: account.workspaceId },
    choice: {
      origin: settings().origin,
      expectedRevision: "1",
      approved: true,
      collect: true,
      use: false,
    },
  });
  state.requestAccess.mockClear();
  await act(async () =>
    container.querySelector<HTMLInputElement>("input")!.click(),
  );
  expect(state.requestAccess).not.toHaveBeenCalled();
  expect(confirmed.collect).toBe(false);
});

test("extension account replacement fences an old private-learning response", async () => {
  let release!: (value: ReturnType<typeof settings>) => void;
  let reads = 0;
  state.sendMessage.mockImplementation(async (message) => {
    if (message.type === "GET_SESSION") return pinned();
    if (message.type === "SAVED_DATA_SITE_SETTINGS") {
      if (++reads === 1)
        return new Promise((resolve) => {
          release = resolve;
        });
      return settings();
    }
    throw new Error("Unexpected RPC.");
  });
  await render(
    createElement(PrivateLearningSettings, {
      account,
      serviceOrigin: "https://service.example.test",
    }),
  );
  await render(
    createElement(PrivateLearningSettings, {
      account: { ...account, id: "00000000-0000-4000-8000-000000000004" },
      serviceOrigin: "https://service.example.test",
    }),
  );
  await act(async () => release({ ...settings(), collect: true }));
  expect(container.querySelector<HTMLInputElement>("input")?.checked).toBe(
    false,
  );
});

test("website uncertain writes require a fresh review and cannot claim deletion or change local memory", async () => {
  const updateSiteSettings = vi.fn(async () => {
    throw new Error("Unknown outcome.");
  });
  state.account = {
    session: { account, session: { id: "current-session" } },
    request: vi.fn(async () => ({ capabilities: ["saved-data-schema-2"] })),
    setSavedDataView: vi.fn(),
    savedData: {
      siteSettings: vi.fn(async () => settings()),
      updateSiteSettings,
    },
  };
  await render(
    createElement(SiteLearningControls, { origin: settings().origin }),
  );
  await act(async () =>
    container.querySelector<HTMLInputElement>("input")!.click(),
  );
  expect(updateSiteSettings).toHaveBeenCalledOnce();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Cloud changes could not be confirmed",
  );
  expect(container.querySelector("fieldset")?.disabled).toBe(true);
  expect(container.textContent).not.toContain("was deleted");
  await click("Refresh learning settings");
  expect(container.querySelector("fieldset")?.disabled).toBe(false);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
