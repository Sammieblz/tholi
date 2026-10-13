import type { PinnedSession } from "../../../packages/route-registry/session";
import { pageSnapshotSchema } from "../../../packages/page-model";
type Frame = {
  frameId: number;
  documentId: string;
  origin: string;
  parentFrameId: number;
};
let scope:
  | {
      sessionId: string;
      tabId: number;
      nonce: string;
      frames: Map<number, Frame>;
    }
  | undefined;
const visibility = new Map<
  number,
  { visible: boolean; inViewport: boolean; placement: string }
>();
export async function stopFrames() {
  const old = scope;
  scope = undefined;
  if (old)
    await Promise.allSettled(
      [...old.frames.values()].map((f) =>
        chrome.tabs.sendMessage(
          old.tabId,
          {
            type: "FRAME_STOP",
            sessionId: old.sessionId,
            nonce: old.nonce,
            ...f,
          },
          { frameId: f.frameId },
        ),
      ),
    );
}
export async function startFrames(session: PinnedSession) {
  await stopFrames();
  visibility.clear();
  const current = (scope = {
    sessionId: session.sessionId,
    tabId: session.tabId,
    nonce: crypto.randomUUID(),
    frames: new Map<number, Frame>(),
  });
  const available = (
    (await chrome.webNavigation.getAllFrames({ tabId: session.tabId })) || []
  )
    .filter((f) => f.frameId !== 0 && /^https?:/.test(f.url))
    .slice(0, 16);
  const allowed: typeof available = [],
    missing = new Set<string>();
  for (const frame of available) {
    const origin = new URL(frame.url).origin;
    if (
      origin === session.origin ||
      (await chrome.permissions.contains({ origins: [origin + "/*"] }))
    )
      allowed.push(frame);
    else missing.add(origin);
  }
  const mainLimit = allowed.length
    ? Math.max(1000, Math.floor(5000 / (allowed.length + 1)))
    : 5000;
  await chrome.tabs
    .sendMessage(session.tabId, {
      type: "FRAME_ACCESS",
      sessionId: session.sessionId,
      origins: [...missing],
      limit: mainLimit,
      nonce: current.nonce,
    })
    .catch(() => {});
  const limit = allowed.length
    ? Math.floor((5000 - mainLimit) / allowed.length)
    : 0;
  for (const frame of allowed) {
    if (scope !== current) return;
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId: session.tabId, frameIds: [frame.frameId] },
        files: ["frame-agent.js"],
      });
      const documentId = injected[0]?.documentId;
      if (!documentId || scope !== current) continue;
      const f = {
        frameId: frame.frameId,
        documentId,
        origin: new URL(frame.url).origin,
        parentFrameId: frame.parentFrameId,
      };
      current.frames.set(f.frameId, f);
      await chrome.tabs.sendMessage(
        session.tabId,
        {
          type: "FRAME_START",
          sessionId: session.sessionId,
          nonce: current.nonce,
          ...f,
          limit,
        },
        { frameId: f.frameId },
      );
    } catch {
      missing.add(new URL(frame.url).origin);
    }
  }
}
export async function frameVisibilityMessage(
  raw: any,
  sender: chrome.runtime.MessageSender,
  session?: PinnedSession,
) {
  if (
    !scope ||
    !session ||
    sender.id !== chrome.runtime.id ||
    sender.tab?.id !== scope.tabId ||
    raw.sessionId !== scope.sessionId ||
    raw.nonce !== scope.nonce
  )
    return;
  const frame = scope.frames.get(raw.frameId);
  if (
    !frame ||
    frame.documentId !== raw.documentId ||
    (sender.frameId || 0) !== frame.parentFrameId
  )
    return;
  if (
    frame.parentFrameId === 0
      ? sender.documentId !== session.documentId
      : sender.documentId !== scope.frames.get(frame.parentFrameId)?.documentId
  )
    return;
  if (
    typeof raw.visible !== "boolean" ||
    typeof raw.inViewport !== "boolean" ||
    !["above", "below", "left", "right", "viewport"].includes(raw.placement)
  )
    return;
  visibility.set(frame.frameId, {
    visible: raw.visible,
    inViewport: raw.inViewport,
    placement: raw.placement,
  });
  for (const f of scope.frames.values()) {
    let current: Frame | undefined = f,
      shown = true,
      inViewport = true,
      placement = "viewport";
    while (current) {
      const v = visibility.get(current.frameId);
      shown &&= v?.visible === true;
      inViewport &&= v?.inViewport === true;
      if (v?.placement && v.placement !== "viewport") placement = v.placement;
      current = scope.frames.get(current.parentFrameId);
    }
    await chrome.tabs
      .sendMessage(session.tabId, {
        type: "FRAME_VISIBILITY_PARENT",
        sessionId: session.sessionId,
        frameId: f.frameId,
        documentId: f.documentId,
        visible: shown,
        inViewport,
        placement,
      })
      .catch(() => {});
  }
}
export function frameMessage(
  raw: any,
  sender: chrome.runtime.MessageSender,
  session?: PinnedSession,
) {
  if (
    !scope ||
    !session ||
    raw.sessionId !== scope.sessionId ||
    raw.nonce !== scope.nonce ||
    sender.id !== chrome.runtime.id ||
    sender.tab?.id !== scope.tabId
  )
    return;
  const frame = scope.frames.get(sender.frameId || 0);
  if (
    !frame ||
    frame.documentId !== sender.documentId ||
    frame.documentId !== raw.documentId
  )
    return;
  const page = pageSnapshotSchema.safeParse(raw.page);
  if (!page.success || page.data.origin !== frame.origin) return;
  return { frame, page: page.data };
}
export async function routeFrameGuide(raw: any, session: PinnedSession) {
  const f = scope?.frames.get(raw.reference?.frameId);
  if (
    !scope ||
    scope.sessionId !== session.sessionId ||
    !f ||
    f.documentId !== raw.reference.documentId
  )
    return { error: "Frame document changed. Replan using fresh evidence." };
  return chrome.tabs.sendMessage(
    session.tabId,
    {
      ...raw,
      type: "FRAME_GUIDE",
      sessionId: session.sessionId,
      nonce: scope.nonce,
      documentId: f.documentId,
      controlId: raw.reference.controlId,
    },
    { frameId: f.frameId },
  );
}
export async function clearFrames(session: PinnedSession) {
  if (scope?.sessionId === session.sessionId)
    await Promise.allSettled(
      [...scope.frames.values()].map((f) =>
        chrome.tabs.sendMessage(
          session.tabId,
          {
            type: "FRAME_CLEAR",
            sessionId: session.sessionId,
            nonce: scope!.nonce,
            ...f,
          },
          { frameId: f.frameId },
        ),
      ),
    );
}
