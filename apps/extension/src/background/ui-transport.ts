import { protectLocalSettings } from "../platform/private-settings";
import {
  openNativeSidebar,
  nativePanelEvents,
  hasNativeSidebar,
} from "../platform/sidebar";
import { api, type Runtime } from "../platform/api";
import { z } from "zod";
import type { PinnedSession } from "../../../../packages/route-registry/session";
import { present } from "../../../../packages/ui/presentation";
import { widgetLayoutActions } from "../../../../packages/ui/widget-density";
import {
  initialPresentation,
  surfacePresentationSchema,
  updatePresentation,
  type SurfacePresentation,
} from "../ui/widget/presentation-state";
import { setFramePresentation } from "./frame-coordinator";
const prefsSchema = z
  .object({
    mode: z.enum(["guide", "conversation"]),
    surface: z.enum(["sidebar", "widget"]),
    advanced: z.boolean(),
  })
  .strict();
const defaultPrefs = { mode: "guide", surface: "sidebar", advanced: false };
const boundsSchema = z
  .object({
    width: z.number().finite().min(1).max(16384),
    height: z.number().finite().min(1).max(16384),
    x: z.number().finite().min(0).max(16384),
    y: z.number().finite().min(0).max(16384),
  })
  .strict();
void protectLocalSettings().catch(() => {});
let surface = hasNativeSidebar() ? "sidebar" : "widget";
void api.storage.local.get("tholiPreferences").then((d) => {
  surface = hasNativeSidebar()
    ? d.tholiPreferences?.surface || "sidebar"
    : "widget";
});
export async function rememberSurface(next: "sidebar" | "widget") {
  surface = next;
  const { tholiPreferences } = await api.storage.local.get("tholiPreferences");
  const preferences = prefsSchema.safeParse(tholiPreferences);
  const current = preferences.success ? preferences.data : defaultPrefs;
  if (current.surface !== next)
    await api.storage.local.set({
      tholiPreferences: { ...current, surface: next },
    });
}
export function preferredSurface(session?: PinnedSession) {
  return session && presentation?.sessionId === session.sessionId
    ? presentation.surface
    : surface;
}
let presentation: SurfacePresentation | undefined;
let sessionProvider: (() => PinnedSession | undefined) | undefined;
const currentSession = (session: PinnedSession) =>
  !sessionProvider || sessionProvider() === session;
const presentationReady = api.storage.session
  .get("tholiSurfacePresentation")
  .then((data) => {
    const parsed = surfacePresentationSchema.safeParse(
      data.tholiSurfacePresentation,
    );
    if (parsed.success) presentation = parsed.data;
  });
export async function getSurfacePresentation(session?: PinnedSession) {
  await presentationReady;
  if (!session) return undefined;
  if (!currentSession(session))
    throw Error("The task changed. Use the current Tholi interface.");
  if (presentation?.sessionId !== session.sessionId) {
    const { tholiPreferences } =
      await api.storage.local.get("tholiPreferences");
    if (!currentSession(session)) throw Error("The task changed.");
    presentation = initialPresentation(
      session.sessionId,
      !hasNativeSidebar() || tholiPreferences?.surface === "widget"
        ? "widget"
        : "sidebar",
    );
    await api.storage.session.set({
      tholiSurfacePresentation: presentation,
    });
  }
  return presentation;
}
export async function presentationVisible(session?: PinnedSession) {
  return (
    ((await getSurfacePresentation(session))?.visibility || "expanded") ===
    "expanded"
  );
}
export async function clearSurfacePresentation(session?: PinnedSession) {
  if (session) {
    await api.tabs
      .sendMessage(
        session.tabId,
        {
          type: "UNMOUNT_WIDGET",
          sessionId: session.sessionId,
        },
        { frameId: 0 },
      )
      .catch(() => {});
    grants.delete(session.tabId);
    mounted.delete(session.tabId);
  }
  presentation = undefined;
  await api.storage.session.remove("tholiSurfacePresentation");
}
async function changePresentation(
  session: PinnedSession,
  change: Partial<Pick<SurfacePresentation, "surface" | "visibility">>,
) {
  const current = (await getSurfacePresentation(session))!;
  if (!currentSession(session)) throw Error("The task changed.");
  const next = (presentation = updatePresentation(current, change));
  await api.storage.session.set({ tholiSurfacePresentation: next });
  if (!currentSession(session) || presentation !== next) return presentation;
  if (change.surface) await rememberSurface(change.surface);
  if (!currentSession(session) || presentation !== next) return presentation;
  const visible = next.visibility === "expanded";
  await Promise.allSettled([
    api.tabs.sendMessage(
      session.tabId,
      {
        type: "PRESENTATION_CHANGED",
        sessionId: session.sessionId,
        visible,
        revision: next.revision,
      },
      { frameId: 0 },
    ),
    setFramePresentation(session, visible, next.revision),
  ]);
  await mountWidget(session);
  invalidateUi();
  return presentation;
}
const mounted = new Map<number, { documentId: string; visibility: string }>();
const grants = new Map<
  number,
  {
    nonce: string;
    documentId: string;
    frameId?: number;
    widgetDocument?: string;
  }
>();
const ports = new Set<Runtime.Port>();
export function isPanel(sender: Runtime.MessageSender) {
  return (
    sender.id === api.runtime.id &&
    sender.url === api.runtime.getURL("sidepanel.html")
  );
}
export function isWidget(
  sender: Runtime.MessageSender,
  session?: PinnedSession,
) {
  const g =
    session && sender.tab?.id === session.tabId
      ? grants.get(session.tabId)
      : undefined;
  return (
    !!g &&
    g.documentId === session?.documentId &&
    sender.id === api.runtime.id &&
    sender.frameId === g.frameId &&
    sender.documentId === g.widgetDocument &&
    sender.url === api.runtime.getURL("widget.html") + "?grant=" + g.nonce
  );
}
export function trustedUi(
  sender: Runtime.MessageSender,
  session?: PinnedSession,
) {
  return isPanel(sender) || isWidget(sender, session);
}
export function invalidateUi() {
  for (const port of ports) {
    try {
      port.postMessage({ type: "SESSION_CHANGED" });
    } catch {
      ports.delete(port);
    }
  }
}
api.runtime.onConnect.addListener((port) => {
  const sender = port.sender || {},
    g = sender.tab ? grants.get(sender.tab.id!) : undefined;
  const widget =
    port.name === "tholi-widget" &&
    g &&
    sender.id === api.runtime.id &&
    sender.url === api.runtime.getURL("widget.html") + "?grant=" + g.nonce &&
    sender.frameId === g.frameId &&
    sender.documentId === g.widgetDocument;
  if (!widget && (port.name !== "tholi-panel" || !isPanel(sender))) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});
const mounting = new Map<
  number,
  { documentId: string; promise: Promise<void> }
>();
export async function mountWidget(session?: PinnedSession, force = false) {
  if (!session?.documentId) return;
  let previous;
  while ((previous = mounting.get(session.tabId))) {
    await previous.promise;
    if (!force && previous.documentId === session.documentId) return;
  }
  const promise = mountWidgetOnce(session, force);
  const entry = { documentId: session.documentId, promise };
  mounting.set(session.tabId, entry);
  try {
    await promise;
  } finally {
    if (mounting.get(session.tabId) === entry) mounting.delete(session.tabId);
  }
}
async function mountWidgetOnce(session?: PinnedSession, force = false) {
  if (!session?.documentId) return;
  // Session replacement/reset is an expected race for fire-and-forget saves.
  // Explicit UI commands still receive stale-session errors from their guards.
  const state = await getSurfacePresentation(session).catch(() => undefined);
  if (!state) return;
  const { tholiWidgetBounds } =
    await api.storage.local.get("tholiWidgetBounds");
  const current = await api.webNavigation
    .getFrame({ tabId: session.tabId, frameId: 0 })
    .catch(() => undefined);
  if (
    !currentSession(session) ||
    presentation !== state ||
    current?.documentId !== session.documentId ||
    !/^https?:/.test(current.url)
  )
    return;
  if (
    state.visibility === "hidden" ||
    (state.visibility === "expanded" && state.surface === "sidebar")
  ) {
    if (mounted.has(session.tabId) || state.visibility === "hidden")
      await api.tabs
        .sendMessage(
          session.tabId,
          {
            type: "UNMOUNT_WIDGET",
            sessionId: session.sessionId,
          },
          { frameId: 0 },
        )
        .catch(() => {});
    mounted.delete(session.tabId);
    grants.delete(session.tabId);
    return;
  }
  const old = mounted.get(session.tabId);
  const view = present(session.view);
  const phase = view.phase;
  if (
    old?.documentId === session.documentId &&
    old.visibility === state.visibility &&
    !force
  ) {
    await api.tabs
      .sendMessage(
        session.tabId,
        {
          type: "UPDATE_WIDGET",
          sessionId: session.sessionId,
          phase,
          visibility: state.visibility,
          marker: view.marker,
        },
        { frameId: 0 },
      )
      .catch(() => {});
    return;
  }
  const grant = { nonce: crypto.randomUUID(), documentId: session.documentId };
  grants.delete(session.tabId);
  if (state.visibility === "expanded") grants.set(session.tabId, grant);
  try {
    await api.tabs.sendMessage(
      session.tabId,
      {
        type: "MOUNT_WIDGET",
        sessionId: session.sessionId,
        url: api.runtime.getURL("widget.html") + "?grant=" + grant.nonce,
        visibility: state.visibility,
        phase,
        marker: view.marker,
        surface: state.surface,
        bounds: boundsSchema.safeParse(tholiWidgetBounds).success
          ? tholiWidgetBounds
          : undefined,
      },
      { frameId: 0 },
    );
    mounted.set(session.tabId, {
      documentId: session.documentId,
      visibility: state.visibility,
    });
  } catch {
    grants.delete(session.tabId);
    mounted.delete(session.tabId);
  }
}
const shellCommands = new Set([
  "UI_WIDGET_BOUNDS",
  "UI_MINIMIZE",
  "UI_DISMISS",
  "UI_RESTORE",
  "UI_DOCK",
]);
const pendingDockWindows = new Set<number>();
function currentShell(sender: Runtime.MessageSender, session?: PinnedSession) {
  return (
    !!session?.documentId &&
    sender.id === api.runtime.id &&
    sender.tab?.id === session.tabId &&
    sender.frameId === 0 &&
    sender.documentId === session.documentId
  );
}
// Native open must run directly in the user gesture's message turn. Never
// queue it behind planning, storage reads, or a document handshake.
export async function dockSidebar(
  sender: Runtime.MessageSender,
  session?: PinnedSession,
) {
  if (
    !session ||
    (!trustedUi(sender, session) && !currentShell(sender, session))
  )
    throw Error("Docking requires the current authorized interface.");
  const tabId = session.tabId,
    documentId = session.documentId;
  const previous = presentation;
  const windowId = sender.tab?.windowId;
  if (windowId === undefined)
    throw Error("Open Tholi from its toolbar icon to use the sidebar.");
  // Start the privileged API call before the first await.
  pendingDockWindows.add(windowId);
  try {
    await openNativeSidebar(windowId);
    const frame = await api.webNavigation
      .getFrame({ tabId, frameId: 0 })
      .catch(() => undefined);
    if (
      !currentSession(session) ||
      session.tabId !== tabId ||
      session.documentId !== documentId ||
      frame?.documentId !== documentId ||
      (previous && presentation !== previous)
    )
      throw Error("The website changed. Your task is retained.");
    return await changePresentation(session, {
      surface: "sidebar",
      visibility: "expanded",
    });
  } finally {
    pendingDockWindows.delete(windowId);
  }
}
export async function minimizeSurface(session: PinnedSession) {
  return changePresentation(session, { visibility: "launcher" });
}
export async function restoreSurface(
  session: PinnedSession,
  surface?: "sidebar" | "widget",
) {
  return changePresentation(session, {
    visibility: "expanded",
    ...(surface ? { surface } : {}),
  });
}
export async function uiMessage(
  raw: any,
  sender: Runtime.MessageSender,
  session?: PinnedSession,
) {
  if (
    shellCommands.has(raw.type) &&
    currentShell(sender, session) &&
    raw.sessionId !== session?.sessionId
  )
    throw Error("The widget belongs to an older task.");
  const shell = shellCommands.has(raw.type) && currentShell(sender, session);
  if (
    raw.type === "UI_DOCK" ||
    raw.type === "UI_OPEN_SIDEBAR" ||
    (raw.type === "UI_RESTORE" &&
      presentation?.sessionId === session?.sessionId &&
      presentation?.surface === "sidebar")
  ) {
    const state = await dockSidebar(sender, session);
    return { ok: true, presentation: state };
  }
  if (raw.type === "UI_WIDGET_BOUNDS") {
    if (
      !session ||
      sender.id !== api.runtime.id ||
      sender.tab?.id !== session.tabId ||
      sender.frameId !== 0 ||
      sender.documentId !== session.documentId ||
      raw.sessionId !== session.sessionId
    )
      throw Error("Widget position requires the current authorized document.");
    await api.storage.local.set({
      tholiWidgetBounds: boundsSchema.parse(raw.bounds),
    });
    return { ok: true };
  }
  if (raw.type === "UI_REGISTER") {
    const g =
      session && sender.tab?.id === session.tabId
        ? grants.get(session.tabId)
        : undefined;
    if (
      !g ||
      sender.id !== api.runtime.id ||
      g.documentId !== session?.documentId ||
      sender.url !== api.runtime.getURL("widget.html") + "?grant=" + g.nonce ||
      !sender.frameId
    )
      throw Error("Widget requires a fresh authorized document.");
    // Chrome omits extension-origin subframes from webNavigation's website
    // inventory. Use its unforgeable runtime frame/document identity and the
    // one-use capability mounted inside the top document's closed shadow root.
    const parent = await api.webNavigation.getFrame({
      tabId: session!.tabId,
      frameId: 0,
    });
    if (
      parent?.documentId !== g.documentId ||
      !sender.documentId ||
      ((sender as Runtime.MessageSender & { documentLifecycle?: string })
        .documentLifecycle !== undefined &&
        (sender as Runtime.MessageSender & { documentLifecycle?: string })
          .documentLifecycle !== "active")
    )
      throw Error("Widget frame does not belong to this journey.");
    if (g.frameId !== undefined && g.frameId !== sender.frameId)
      throw Error("Widget is already bound to another frame.");
    g.frameId = sender.frameId;
    g.widgetDocument = sender.documentId;
    return { ok: true };
  }
  if (!trustedUi(sender, session) && !shell)
    throw Error("Trusted Tholi interface required.");
  if (raw.type === "UI_MINIMIZE") {
    if (!session) throw Error("No current journey.");
    return { ok: true, presentation: await minimizeSurface(session) };
  }
  if (raw.type === "UI_DISMISS") {
    if (!session) throw Error("No current journey.");
    return {
      ok: true,
      presentation: await changePresentation(session, { visibility: "hidden" }),
    };
  }
  if (raw.type === "UI_RESTORE") {
    if (!session) throw Error("No current journey.");
    return { ok: true, presentation: await restoreSurface(session, "widget") };
  }
  if (raw.type === "UI_WIDGET_MOVE") {
    if (session)
      await api.tabs.sendMessage(
        session.tabId,
        { type: "MOVE_WIDGET", sessionId: session.sessionId },
        { frameId: 0 },
      );
    return { ok: true };
  }
  if (raw.type === "UI_WIDGET_LAYOUT") {
    const action = z.enum(widgetLayoutActions).parse(raw.action);
    if (!session) throw Error("No current journey.");
    const result = await api.tabs.sendMessage(
      session.tabId,
      { type: "LAYOUT_WIDGET", sessionId: session.sessionId, action },
      { frameId: 0 },
    );
    if (boundsSchema.safeParse(result?.bounds).success)
      await api.storage.local.set({ tholiWidgetBounds: result.bounds });
    return { ok: true };
  }
  if (raw.type === "UI_WIDGET_STATUS")
    return { ready: !!session && !!grants.get(session.tabId)?.widgetDocument };
  if (raw.type === "UI_GET") {
    const [{ tholiPreferences }, data] = await Promise.all([
      api.storage.local.get("tholiPreferences"),
      api.storage.session.get(["tholiConversation", "tholiDraft"]),
    ]);
    const current = await getSurfacePresentation(session);
    const preferences = prefsSchema.safeParse(tholiPreferences).success
      ? tholiPreferences
      : defaultPrefs;
    return {
      preferences: current
        ? { ...preferences, surface: current.surface }
        : preferences,
      messages: data.tholiConversation || [],
      draft: data.tholiDraft || "",
      presentation: current,
    };
  }
  if (raw.type === "UI_SAVE") {
    if (raw.preferences) {
      const p = prefsSchema.parse(raw.preferences);
      surface = p.surface;
      await api.storage.local.set({ tholiPreferences: p });
      if (session) await restoreSurface(session, p.surface);
    }
    if (typeof raw.draft === "string")
      await api.storage.session.set({
        tholiDraft: raw.draft.slice(0, 1000),
      });
    invalidateUi();
    return { ok: true };
  }
  if (raw.type === "UI_APPEND") {
    const m = z
      .object({
        id: z.string().max(1200),
        role: z.enum(["user", "guide"]),
        text: z.string().max(1500),
        at: z.number().finite(),
      })
      .strict()
      .parse(raw.message);
    const data = await api.storage.session.get("tholiConversation"),
      messages = data.tholiConversation || [];
    if (!messages.some((x: any) => x.id === m.id))
      await api.storage.session.set({
        tholiConversation: [...messages, m].slice(-80),
      });
    invalidateUi();
    return { ok: true };
  }
  if (raw.type === "UI_WIDGET_EXPAND") {
    if (session) {
      const expanded = await api.tabs
        .sendMessage(
          session.tabId,
          {
            type: "EXPAND_WIDGET",
            sessionId: session.sessionId,
          },
          { frameId: 0 },
        )
        .catch(() => undefined);
      if (boundsSchema.safeParse(expanded?.bounds).success)
        await api.storage.local.set({ tholiWidgetBounds: expanded.bounds });
    }
    return { ok: true };
  }
  throw Error("Unknown interface command.");
}
type PanelLifecycleEvent = {
  addListener(
    listener: (info: { windowId: number; tabId?: number }) => void,
  ): void;
};
export function watchNativePanels(
  currentSession: () => PinnedSession | undefined,
) {
  sessionProvider = currentSession;
  const panelEvents = nativePanelEvents() as
    | (ReturnType<typeof nativePanelEvents> & {
        onClosed?: PanelLifecycleEvent;
        onOpened?: PanelLifecycleEvent;
      })
    | undefined;
  panelEvents?.onOpened?.addListener((info) => {
    if (pendingDockWindows.has(info.windowId)) return;
    const session = currentSession();
    if (!session) return;
    void (async () => {
      const tab = await api.tabs.get(session.tabId).catch(() => undefined);
      if (
        currentSession() !== session ||
        tab?.windowId !== info.windowId ||
        (info.tabId !== undefined && info.tabId !== session.tabId)
      )
        return;
      await restoreSurface(session, "sidebar");
    })().catch(() => {});
  });
  panelEvents?.onClosed?.addListener((info) => {
    const session = currentSession();
    if (!session) return;
    void (async () => {
      const tab = await api.tabs.get(session.tabId).catch(() => undefined);
      const state = await getSurfacePresentation(session);
      if (
        currentSession() !== session ||
        tab?.windowId !== info.windowId ||
        (info.tabId !== undefined && info.tabId !== session.tabId) ||
        state?.surface !== "sidebar" ||
        state.visibility !== "expanded"
      )
        return;
      await minimizeSurface(session);
    })().catch(() => {});
  });
  // Port disconnects are intentionally not interpreted as dismissal: a page
  // reload, UI crash, or worker restart can disconnect a port too.
}
export const widgetCommands = new Set([
  "GET_CONTEXT",
  "GET_SESSION",
  "GET_PAGE",
  "SET_GOAL",
  "CLARIFY",
  "PAUSE",
  "RESUME",
  "STOP",
  "NLP_SUGGEST",
  "GET_JOURNEYS",
  "RESUME_JOURNEY",
  "DELETE_JOURNEY",
  "WORKFLOW_ENTITY",
  "WORKFLOW_ACTION",
  "SKIP_TASK",
]);
