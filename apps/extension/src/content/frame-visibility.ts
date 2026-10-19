import { api } from "../platform/api";
import { clippedRect } from "../../../../packages/browser-adapter/geometry";
import { visible } from "../../../../packages/browser-adapter/index";
const frames = new Map<
  number,
  {
    element: HTMLIFrameElement;
    documentId: string;
    sessionId: string;
    nonce: string;
    last: string;
  }
>();
export const frameElement = (id: number) => frames.get(id)?.element;
export function frameVisibilityBridge(
  scope: () => { sessionId: string; nonce: string } | undefined,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    timer = undefined;
    const current = scope();
    if (!current) return;
    for (const [frameId, f] of frames) {
      if (
        f.sessionId !== current.sessionId ||
        f.nonce !== current.nonce ||
        !f.element.isConnected
      ) {
        frames.delete(frameId);
        continue;
      }
      const rect = clippedRect(f.element),
        inViewport =
          !!rect &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight &&
          rect.left >= 0 &&
          rect.right <= innerWidth;
      const modal = [
        ...document.querySelectorAll<HTMLElement>(
          "dialog[open],[role=dialog][aria-modal=true]",
        ),
      ].find((e) => visible(e));
      let shown = visible(f.element) && (!modal || modal.contains(f.element));
      if (shown && inViewport) {
        const r = rect!,
          points = [
            [r.left + 2, r.top + 2],
            [r.right - 2, r.top + 2],
            [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
            [r.left + 2, r.bottom - 2],
            [r.right - 2, r.bottom - 2],
          ];
        shown = points.every(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return (
            hit === f.element || !!hit?.closest("#internet-navigator-overlay")
          );
        });
      }
      const state = {
        visible: shown,
        inViewport: shown && inViewport,
        placement: !rect
          ? "viewport"
          : rect.bottom <= 0
            ? "above"
            : rect.top >= innerHeight
              ? "below"
              : rect.right <= 0
                ? "left"
                : rect.left >= innerWidth
                  ? "right"
                  : "viewport",
      };
      const key = JSON.stringify(state);
      if (key === f.last) continue;
      f.last = key;
      void api.runtime
        .sendMessage({
          type: "FRAME_VISIBILITY",
          sessionId: current.sessionId,
          nonce: current.nonce,
          frameId,
          documentId: f.documentId,
          ...state,
        })
        .catch(() => {});
    }
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(update, 50);
  };
  const message = (event: MessageEvent) => {
    const current = scope(),
      data = event.data;
    if (
      !event.isTrusted ||
      !current ||
      data?.type !== "INTERNET_NAVIGATOR_FRAME" ||
      data.sessionId !== current.sessionId ||
      data.nonce !== current.nonce
    )
      return;
    const element = [
      ...document.querySelectorAll<HTMLIFrameElement>("iframe"),
    ].find((e) => e.contentWindow === event.source);
    if (!element) return;
    frames.set(data.frameId, {
      element,
      documentId: data.documentId,
      ...current,
      last: "",
    });
    schedule();
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    childList: true,
    attributeFilter: [
      "class",
      "style",
      "hidden",
      "inert",
      "aria-modal",
      "open",
    ],
  });
  window.addEventListener("message", message);
  window.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  return () => {
    clearTimeout(timer);
    observer.disconnect();
    window.removeEventListener("message", message);
    window.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
    frames.clear();
  };
}
