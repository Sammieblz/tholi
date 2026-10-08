import { z } from "zod";
import { messageSchema } from "../../../packages/route-schema";
import { demoRoute } from "../../../routes/demo/cancellation";
import { allowedOrigin } from "../../../packages/safety-policy";
import type { SessionView } from "../../../packages/shared-types";
const viewSchema = z
  .object({
    status: z.enum([
      "idle",
      "running",
      "waiting",
      "paused",
      "checkpoint",
      "rerouting",
      "stopped",
      "boundary",
      "completed",
    ]),
    stateId: z.string().optional(),
    instruction: z.string().max(500),
    verifiedSteps: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
    reason: z.string().max(500).optional(),
    routeId: z.literal(demoRoute.id),
    routeVersion: z.literal(demoRoute.version),
    history: z.array(z.string().max(100)).max(30),
  })
  .strict();
let session: { tabId?: number; view?: SessionView } = {};
const ready = chrome.storage.session.get("navigatorSession").then((data) => {
  session = data.navigatorSession || {};
});
const save = async () => {
  await chrome.storage.session.set({ navigatorSession: session });
};
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});
chrome.runtime.onMessage.addListener((raw, sender, respond) => {
  (async () => {
    await ready;
    if (sender.id !== chrome.runtime.id) return { error: "Invalid sender." };
    if (raw?.type === "SESSION_UPDATE") {
      const parsed = viewSchema.safeParse(raw.view);
      if (
        !parsed.success ||
        sender.tab?.id !== session.tabId ||
        !sender.url ||
        !allowedOrigin(demoRoute, new URL(sender.url).origin)
      )
        return { error: "Invalid session update." };
      session.view = parsed.data;
      await save();
      return { ok: true };
    }
    if (!sender.url?.startsWith(chrome.runtime.getURL("")))
      return { error: "Extension panel required." };
    const parsed = messageSchema.safeParse(raw);
    if (!parsed.success) return { error: "Invalid command." };
    if (parsed.data.type === "GET_SESSION") return session;
    if (parsed.data.type === "START") {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (tab?.id === undefined)
        return {
          error:
            "No active website tab was found. Select the Northstar tab and try again.",
        };
      if (!tab.url)
        return {
          error:
            "Chrome has not granted access to this tab. Reload Internet Navigator in chrome://extensions, then reopen it on the demo tab.",
        };
      if (!allowedOrigin(demoRoute, new URL(tab.url).origin))
        return {
          error:
            "This tab is not supported. Select the Northstar demo at http://127.0.0.1:5173 or http://localhost:5173.",
        };
      if (session.tabId) {
        try {
          await chrome.tabs.sendMessage(session.tabId, { type: "STOP" });
        } catch {}
      }
      session = { tabId: tab.id };
      await save();
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    }
    if (!session.tabId) return { error: "Start navigation first." };
    try {
      const reply = await chrome.tabs.sendMessage(session.tabId, parsed.data);
      if (reply?.view) {
        const view = viewSchema.parse(reply.view);
        session.view = view;
        await save();
      }
      return session;
    } catch {
      session.view = session.view
        ? {
            ...session.view,
            status: "stopped",
            instruction:
              "Page reloaded or unavailable. Start navigation again.",
          }
        : undefined;
      await save();
      return { error: "Page unavailable. Open the demo and Start again." };
    }
  })()
    .then(respond)
    .catch((error) =>
      respond({
        error:
          error instanceof Error ? error.message : "Navigation command failed.",
      }),
    );
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void ready.then(async () => {
    if (session.tabId === tabId) {
      session = {};
      await save();
    }
  });
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading")
    void ready.then(async () => {
      if (
        session.tabId === tabId &&
        session.view &&
        !["boundary", "completed", "stopped"].includes(session.view.status)
      ) {
        session.view = {
          ...session.view,
          status: "stopped",
          instruction: "Page navigation interrupted the session. Start again.",
        };
        await save();
      }
    });
});
