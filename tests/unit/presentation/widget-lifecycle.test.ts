// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { PinnedSession } from "../../../packages/route-registry/session";
import { dockIntent } from "../../../apps/extension/src/ui/widget/presentation-state";
import { contentMessageSchema } from "../../../packages/route-schema/index";

const id = "6692779e-ad63-4da7-82cd-a878c1ae23e1";
function environment(seed: Record<string, unknown> = {}) {
  const local: Record<string, unknown> = {
    tholiPreferences: {
      surface: "widget",
      mode: "conversation",
      advanced: false,
    },
  };
  const stored: Record<string, unknown> = { ...seed };
  const storage = (data: Record<string, unknown>) => ({
    get: vi.fn(async () => ({ ...data })),
    set: vi.fn(async (next: Record<string, unknown>) =>
      Object.assign(data, next),
    ),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }),
    setAccessLevel: vi.fn(async () => {}),
  });
  const closed = vi.fn();
  const api = {
    runtime: {
      id: "tholi-test",
      getURL: (path: string) => "chrome-extension://tholi-test/" + path,
      onConnect: { addListener: vi.fn() },
    },
    storage: { local: storage(local), session: storage(stored) },
    tabs: {
      sendMessage: vi.fn(async () => ({ ok: true })),
      get: vi.fn(async () => ({ windowId: 4 })),
    },
    webNavigation: {
      getFrame: vi.fn(async () => ({
        documentId: "document-a",
        url: "https://example.com/",
      })),
    },
    sidePanel: {
      open: vi.fn(async () => {}),
      onClosed: { addListener: closed },
    },
  };
  const session = {
    sessionId: id,
    tabId: 7,
    documentId: "document-a",
    origin: "https://example.com",
    routeId: "navigator.live",
    routeVersion: "1.0.0",
    view: {
      status: "running",
      instruction: "Open Settings",
      verifiedSteps: 3,
      history: [],
      confidence: 0.9,
    },
  } as unknown as PinnedSession;
  const sender = {
    id: api.runtime.id,
    tab: { id: 7, windowId: 4 },
    frameId: 0,
    documentId: "document-a",
  } as chrome.runtime.MessageSender;
  vi.stubGlobal("chrome", api);
  return { api, session, sender, stored, closed };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  document
    .querySelectorAll("[data-tholi-ui]")
    .forEach((element) => element.remove());
});

it("dismisses the launcher without erasing the task and stays hidden after worker restart", async () => {
  const { api, session, sender, stored } = environment();
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  const before = structuredClone(session);
  await expect(
    ui.uiMessage(
      { type: "UI_DISMISS", sessionId: id },
      { ...sender, documentId: "old-document" },
      session,
    ),
  ).rejects.toThrow("Trusted");
  await expect(
    ui.uiMessage(
      { type: "UI_DISMISS", sessionId: "old-task" },
      sender,
      session,
    ),
  ).rejects.toThrow("older task");
  await ui.uiMessage({ type: "UI_DISMISS", sessionId: id }, sender, session);
  expect(stored.tholiSurfacePresentation).toMatchObject({
    visibility: "hidden",
  });
  expect(await ui.presentationVisible(session)).toBe(false);
  expect(session).toEqual(before);
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "UNMOUNT_WIDGET" }),
    { frameId: 0 },
  );
  vi.resetModules();
  api.tabs.sendMessage.mockClear();
  const restarted =
    await import("../../../apps/extension/src/background/ui-transport");
  await restarted.mountWidget(session, true);
  expect(await restarted.presentationVisible(session)).toBe(false);
  expect(api.tabs.sendMessage).not.toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "MOUNT_WIDGET" }),
    expect.anything(),
  );
  await restarted.uiMessage(
    { type: "UI_RESTORE", sessionId: id },
    sender,
    session,
  );
  expect(stored.tholiSurfacePresentation).toMatchObject({
    visibility: "expanded",
  });
  expect(session).toEqual(before);
});

function launcherFixture() {
  const host = document.createElement("div");
  host.dataset.tholiUi = "";
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    '<button class="launcher" aria-expanded="false">Open Tholi</button><div class="launcher-actions" hidden><button class="launcher-open">Open Tholi</button><button class="launcher-remove">Remove</button></div>';
  return {
    host,
    root,
    launcher: root.querySelector<HTMLButtonElement>(".launcher")!,
    actions: root.querySelector<HTMLElement>(".launcher-actions")!,
  };
}

it("a double-click reveals removal without restoring first; a single click restores once", async () => {
  vi.useFakeTimers();
  const { bindLauncherControls } =
    await import("../../../apps/extension/src/ui/widget/launcher-controls");
  const { host, root, launcher, actions } = launcherFixture();
  const open = vi.fn(),
    remove = vi.fn(async () => {});
  const dispose = bindLauncherControls(host, root, open, remove, false);
  launcher.dispatchEvent(new MouseEvent("click", { detail: 1 }));
  vi.advanceTimersByTime(100);
  launcher.dispatchEvent(new MouseEvent("click", { detail: 2 }));
  launcher.dispatchEvent(new MouseEvent("dblclick", { detail: 2 }));
  vi.advanceTimersByTime(500);
  expect(open).not.toHaveBeenCalled();
  expect(actions.hidden).toBe(false);
  expect(root.activeElement).toBe(root.querySelector(".launcher-remove"));
  root.querySelector<HTMLButtonElement>(".launcher-remove")!.click();
  expect(remove).toHaveBeenCalledOnce();
  root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  launcher.dispatchEvent(new MouseEvent("click", { detail: 1 }));
  vi.advanceTimersByTime(400);
  expect(open).toHaveBeenCalledOnce();
  launcher.dispatchEvent(new MouseEvent("click", { detail: 1 }));
  dispose();
  vi.advanceTimersByTime(500);
  expect(open).toHaveBeenCalledOnce();
});

it("launcher controls support keyboard and context activation without delaying native sidebar opening", async () => {
  const { bindLauncherControls } =
    await import("../../../apps/extension/src/ui/widget/launcher-controls");
  const { host, root, launcher, actions } = launcherFixture();
  const open = vi.fn();
  const dispose = bindLauncherControls(host, root, open, async () => {}, true);
  launcher.dispatchEvent(new MouseEvent("click", { detail: 1 }));
  expect(open).toHaveBeenCalledOnce();
  root.dispatchEvent(
    new KeyboardEvent("keydown", { key: "F10", shiftKey: true }),
  );
  expect(actions.hidden).toBe(false);
  expect(launcher.getAttribute("aria-expanded")).toBe("true");
  root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(actions.hidden).toBe(true);
  expect(root.activeElement).toBe(launcher);
  launcher.dispatchEvent(new MouseEvent("contextmenu", { cancelable: true }));
  expect(actions.hidden).toBe(false);
  dispose();
});

it("minimizes to a launcher without pausing or replacing a journey, then restores fresh guidance", async () => {
  const { api, session, sender, stored } = environment();
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  const before = structuredClone(session);
  await ui.uiMessage({ type: "UI_MINIMIZE", sessionId: id }, sender, session);
  expect(session).toEqual(before);
  expect(stored.tholiSurfacePresentation).toMatchObject({
    sessionId: id,
    visibility: "launcher",
    surface: "widget",
  });
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "PRESENTATION_CHANGED", visible: false }),
    { frameId: 0 },
  );
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "MOUNT_WIDGET", visibility: "launcher" }),
    { frameId: 0 },
  );
  await ui.uiMessage({ type: "UI_RESTORE", sessionId: id }, sender, session);
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "PRESENTATION_CHANGED", visible: true }),
    { frameId: 0 },
  );
  expect(stored.tholiSurfacePresentation).toMatchObject({
    visibility: "expanded",
  });
  expect(session).toEqual(before);
});

it("restores a minimized presentation after worker module restart", async () => {
  const { api, session } = environment({
    tholiSurfacePresentation: {
      sessionId: id,
      surface: "widget",
      visibility: "launcher",
      revision: 6,
    },
  });
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  await ui.mountWidget(session, true);
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "MOUNT_WIDGET", visibility: "launcher" }),
    { frameId: 0 },
  );
  expect((await ui.getSurfacePresentation(session))?.revision).toBe(6);
});

it("ignores a late mount after reset and clears presentation without deleting saved preferences", async () => {
  const { api, session, stored } = environment({
    tholiSurfacePresentation: {
      sessionId: id,
      surface: "widget",
      visibility: "launcher",
      revision: 2,
    },
  });
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  await ui.getSurfacePresentation(session);
  let current: PinnedSession | undefined = session;
  ui.watchNativePanels(() => current);
  const preferences = await api.storage.local.get();
  const late = ui.mountWidget(session);
  current = undefined;
  await expect(late).resolves.toBeUndefined();
  await ui.clearSurfacePresentation(session);
  expect(stored.tholiSurfacePresentation).toBeUndefined();
  expect(await api.storage.local.get()).toEqual(preferences);
});

it("rejects stale top-document and previous-session widget commands", async () => {
  const { session, sender } = environment();
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  await expect(
    ui.uiMessage(
      { type: "UI_MINIMIZE", sessionId: id },
      { ...sender, documentId: "old-document" },
      session,
    ),
  ).rejects.toThrow("Trusted");
  await expect(
    ui.uiMessage(
      { type: "UI_RESTORE", sessionId: "old-session" },
      sender,
      session,
    ),
  ).rejects.toThrow("older task");
});

it("starts native docking immediately and leaves the widget intact if Chrome rejects activation", async () => {
  const { api, session, sender, stored } = environment();
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  await ui.getSurfacePresentation(session);
  api.sidePanel.open.mockRejectedValueOnce(Error("User gesture required"));
  const attempt = ui.uiMessage(
    { type: "UI_DOCK", sessionId: id },
    sender,
    session,
  );
  expect(api.sidePanel.open).toHaveBeenCalledTimes(1);
  await expect(attempt).rejects.toThrow("User gesture");
  expect(stored.tholiSurfacePresentation).toMatchObject({
    surface: "widget",
    visibility: "expanded",
  });
  expect(api.tabs.sendMessage).not.toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "UNMOUNT_WIDGET" }),
    expect.anything(),
  );
  const before = structuredClone(session);
  await ui.uiMessage({ type: "UI_DOCK", sessionId: id }, sender, session);
  expect(stored.tholiSurfacePresentation).toMatchObject({
    surface: "sidebar",
    visibility: "expanded",
  });
  expect(session).toEqual(before);
});

it("minimizes only a matching window's native sidebar dismissal", async () => {
  const { api, session, stored, closed } = environment({
    tholiSurfacePresentation: {
      sessionId: id,
      surface: "sidebar",
      visibility: "expanded",
      revision: 0,
    },
  });
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  await ui.getSurfacePresentation(session);
  ui.watchNativePanels(() => session);
  const listener = closed.mock.calls[0][0] as (info: {
    windowId: number;
  }) => void;
  listener({ windowId: 99 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(stored.tholiSurfacePresentation).toMatchObject({
    visibility: "expanded",
  });
  listener({ windowId: 4 });
  await vi.waitFor(() =>
    expect(stored.tholiSurfacePresentation).toMatchObject({
      visibility: "launcher",
    }),
  );
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ visibility: "launcher" }),
    { frameId: 0 },
  );
});

it("only offers docking within the final24 pixels", () => {
  expect(dockIntent(616, 360, 1000)).toBe(true);
  expect(dockIntent(615, 360, 1000)).toBe(false);
});

it("accepts presentation metadata in the strict document handshake without changing older clients", () => {
  const message = {
    type: "BEGIN_SESSION",
    sessionId: id,
    routeId: "navigator.live",
    routeVersion: "1.0.0",
  };
  expect(contentMessageSchema.safeParse(message).success).toBe(true);
  const current = contentMessageSchema.parse({
    ...message,
    presentationVisible: false,
    presentationRevision: 4,
  });
  expect(current).toMatchObject({
    presentationVisible: false,
    presentationRevision: 4,
  });
  expect(
    contentMessageSchema.safeParse({ ...message, presentationVisible: "false" })
      .success,
  ).toBe(false);
});

it("suppresses DOM and visual highlights while preserving the ability to restore", async () => {
  environment();
  const { GuidanceOverlay, setGuidanceVisible } =
    await import("../../../packages/overlay-ui/index");
  const { showVisual } =
    await import("../../../apps/extension/src/content/visual-guidance");
  const target = document.createElement("button");
  document.body.append(target);
  const overlay = new GuidanceOverlay();
  setGuidanceVisible(false);
  overlay.show(target, "Open Settings");
  expect(document.getElementById("internet-navigator-overlay")).toBeNull();
  expect(
    showVisual(
      { kind: "visual", box: { x: 1, y: 1, width: 30, height: 20 } } as never,
      0,
      Date.now(),
    ),
  ).toBe(false);
  expect(document.getElementById("navigator-visual-suggestion")).toBeNull();
  setGuidanceVisible(true);
  overlay.clear();
  target.remove();
});
