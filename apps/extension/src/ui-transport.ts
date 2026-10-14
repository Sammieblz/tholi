import { z } from "zod";
import type { PinnedSession } from "../../../packages/route-registry/session";
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
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
let surface = "sidebar";
void chrome.storage.local.get("tholiPreferences").then((d) => {
  surface = d.tholiPreferences?.surface || "sidebar";
});
export function preferredSurface() {
  return surface;
}
const grants = new Map<
  number,
  {
    nonce: string;
    documentId: string;
    frameId?: number;
    widgetDocument?: string;
  }
>();
const ports = new Set<chrome.runtime.Port>();
export function isPanel(sender: chrome.runtime.MessageSender) {
  return (
    sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL("sidepanel.html")
  );
}
export function isWidget(
  sender: chrome.runtime.MessageSender,
  session?: PinnedSession,
) {
  const g =
    session && sender.tab?.id === session.tabId
      ? grants.get(session.tabId)
      : undefined;
  return (
    !!g &&
    g.documentId === session?.documentId &&
    sender.id === chrome.runtime.id &&
    sender.frameId === g.frameId &&
    sender.documentId === g.widgetDocument &&
    sender.url === chrome.runtime.getURL("widget.html") + "?grant=" + g.nonce
  );
}
export function trustedUi(
  sender: chrome.runtime.MessageSender,
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
chrome.runtime.onConnect.addListener((port) => {
  const sender = port.sender || {},
    g = sender.tab ? grants.get(sender.tab.id!) : undefined;
  const widget =
    port.name === "tholi-widget" &&
    g &&
    sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL("widget.html") + "?grant=" + g.nonce &&
    sender.frameId === g.frameId &&
    sender.documentId === g.widgetDocument;
  if (!widget && (port.name !== "tholi-panel" || !isPanel(sender))) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});
export async function mountWidget(session?: PinnedSession, force = false) {
  if (!session?.documentId) return;
  const { tholiPreferences, tholiWidgetBounds } =
    await chrome.storage.local.get(["tholiPreferences", "tholiWidgetBounds"]);
  if (tholiPreferences?.surface !== "widget") return;
  const old = grants.get(session.tabId);
  if (old?.documentId === session.documentId && !force) return;
  const current = await chrome.webNavigation
    .getFrame({ tabId: session.tabId, frameId: 0 })
    .catch(() => undefined);
  if (
    current?.documentId !== session.documentId ||
    !/^https?:/.test(current.url)
  )
    return;
  const grant = { nonce: crypto.randomUUID(), documentId: session.documentId };
  grants.set(session.tabId, grant);
  try {
    await chrome.tabs.sendMessage(
      session.tabId,
      {
        type: "MOUNT_WIDGET",
        sessionId: session.sessionId,
        url: chrome.runtime.getURL("widget.html") + "?grant=" + grant.nonce,
        bounds: boundsSchema.safeParse(tholiWidgetBounds).success
          ? tholiWidgetBounds
          : undefined,
      },
      { frameId: 0 },
    );
  } catch {
    grants.delete(session.tabId);
  }
}
export async function uiMessage(
  raw: any,
  sender: chrome.runtime.MessageSender,
  session?: PinnedSession,
) {
  if (raw.type === "UI_WIDGET_BOUNDS") {
    if (
      !session ||
      sender.id !== chrome.runtime.id ||
      sender.tab?.id !== session.tabId ||
      sender.frameId !== 0 ||
      sender.documentId !== session.documentId ||
      raw.sessionId !== session.sessionId
    )
      throw Error("Widget position requires the current authorized document.");
    await chrome.storage.local.set({
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
      sender.id !== chrome.runtime.id ||
      g.documentId !== session?.documentId ||
      sender.url !==
        chrome.runtime.getURL("widget.html") + "?grant=" + g.nonce ||
      !sender.frameId
    )
      throw Error("Widget requires a fresh authorized document.");
    // Chrome omits extension-origin subframes from webNavigation's website
    // inventory. Use its unforgeable runtime frame/document identity and the
    // one-use capability mounted inside the top document's closed shadow root.
    const parent = await chrome.webNavigation.getFrame({
      tabId: session!.tabId,
      frameId: 0,
    });
    if (
      parent?.documentId !== g.documentId ||
      !sender.documentId ||
      sender.documentLifecycle !== "active"
    )
      throw Error("Widget frame does not belong to this journey.");
    if (g.frameId !== undefined && g.frameId !== sender.frameId)
      throw Error("Widget is already bound to another frame.");
    g.frameId = sender.frameId;
    g.widgetDocument = sender.documentId;
    return { ok: true };
  }
  if (!trustedUi(sender, session))
    throw Error("Trusted Tholi interface required.");
  if (raw.type === "UI_WIDGET_MOVE") {
    if (session)
      await chrome.tabs.sendMessage(
        session.tabId,
        { type: "MOVE_WIDGET", sessionId: session.sessionId },
        { frameId: 0 },
      );
    return { ok: true };
  }
  if (raw.type === "UI_WIDGET_STATUS")
    return { ready: !!session && !!grants.get(session.tabId)?.widgetDocument };
  if (raw.type === "UI_GET") {
    const [{ tholiPreferences }, data] = await Promise.all([
      chrome.storage.local.get("tholiPreferences"),
      chrome.storage.session.get(["tholiConversation", "tholiDraft"]),
    ]);
    return {
      preferences: prefsSchema.safeParse(tholiPreferences).success
        ? tholiPreferences
        : defaultPrefs,
      messages: data.tholiConversation || [],
      draft: data.tholiDraft || "",
    };
  }
  if (raw.type === "UI_SAVE") {
    if (raw.preferences) {
      const p = prefsSchema.parse(raw.preferences);
      surface = p.surface;
      await chrome.storage.local.set({ tholiPreferences: p });
      if (p.surface === "widget") await mountWidget(session);
      else if (session) {
        await chrome.tabs
          .sendMessage(
            session.tabId,
            { type: "UNMOUNT_WIDGET", sessionId: session.sessionId },
            { frameId: 0 },
          )
          .catch(() => {});
        grants.delete(session.tabId);
      }
    }
    if (typeof raw.draft === "string")
      await chrome.storage.session.set({
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
    const data = await chrome.storage.session.get("tholiConversation"),
      messages = data.tholiConversation || [];
    if (!messages.some((x: any) => x.id === m.id))
      await chrome.storage.session.set({
        tholiConversation: [...messages, m].slice(-80),
      });
    invalidateUi();
    return { ok: true };
  }
  if (raw.type === "UI_OPEN_SIDEBAR") {
    if (!session) throw Error("No current website.");
    if (sender.tab?.windowId === undefined)
      throw Error("Open Tholi from its toolbar icon to use the sidebar.");
    await chrome.sidePanel.open({ windowId: sender.tab.windowId });
    return { ok: true };
  }
  if (raw.type === "UI_WIDGET_EXPAND") {
    if (session) {
      await chrome.storage.local.remove("tholiWidgetBounds");
      await mountWidget(session, true);
    }
    return { ok: true };
  }
  throw Error("Unknown interface command.");
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
