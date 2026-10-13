import { PageDiscovery } from "../../../packages/page-discovery";
import { GuidanceOverlay } from "../../../packages/overlay-ui";
import type { BoundControl } from "../../../packages/page-discovery";
import type { PageSnapshot } from "../../../packages/page-model";
import { frameVisibilityBridge } from "./frame-visibility";
const marker = "__internetNavigatorFrame080";
if (!(globalThis as any)[marker]) {
  (globalThis as any)[marker] = true;
  let discovery = new PageDiscovery(),
    overlay = new GuidanceOverlay(),
    stop: (() => void) | undefined;
  let sessionId = "",
    nonce = "",
    frameId = 0,
    documentId = "",
    selected: BoundControl | undefined,
    before: PageSnapshot | undefined;
  let visibilityCleanup: (() => void) | undefined;
  const send = (type: string, extra: Record<string, unknown>) =>
    chrome.runtime
      .sendMessage({ type, sessionId, nonce, frameId, documentId, ...extra })
      .catch(() => {});
  const snapshot = () => {
    const page = discovery.snapshot();
    void send("FRAME_OBSERVATION", { page });
    return page;
  };
  const event = (event: Event) => {
    if (!selected || !event.composedPath().includes(selected.element)) return;
    const c = selected.control;
    void send("FRAME_INTERACTION", {
      controlId: c.id,
      signature: c.signature,
      verified: false,
      page: before,
    });
    setTimeout(() => {
      const p = snapshot(),
        fresh = p.controls.find((x) => x.id === c.id);
      const verified =
        !!fresh &&
        (c.kind === "focus" ||
          (c.kind === "choice" &&
            ((fresh.checked === true && c.checked !== true) ||
              (fresh.selected === true && c.selected !== true))) ||
          (c.kind === "toggle" && fresh.checked !== c.checked) ||
          (c.kind === "range" && fresh.range?.current !== c.range?.current) ||
          (c.kind === "expand" &&
            fresh.expanded === true &&
            c.expanded !== true) ||
          (c.kind === "select" &&
            fresh.options?.some(
              (o, i) => o.selected !== c.options?.[i]?.selected,
            )));
      if (verified)
        void send("FRAME_INTERACTION", {
          controlId: c.id,
          signature: c.signature,
          verified: true,
          page: p,
        });
    }, 0);
  };
  const clear = () => {
    selected = undefined;
    before = undefined;
    overlay.clear();
  };
  const teardown = () => {
    stop?.();
    stop = undefined;
    visibilityCleanup?.();
    visibilityCleanup = undefined;
    clear();
    for (const name of ["click", "change", "focusin"] as const)
      document.removeEventListener(name, event, true);
  };
  chrome.runtime.onMessage.addListener((raw, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !raw?.type?.startsWith("FRAME_"))
      return;
    if (raw.type === "FRAME_START") {
      teardown();
      sessionId = raw.sessionId;
      nonce = raw.nonce;
      frameId = raw.frameId;
      documentId = raw.documentId;
      visibilityCleanup = frameVisibilityBridge(() =>
        sessionId ? { sessionId, nonce } : undefined,
      );
      discovery = new PageDiscovery();
      discovery.setLimit(raw.limit);
      stop = discovery.observe(snapshot);
      for (const name of ["click", "change", "focusin"] as const)
        document.addEventListener(name, event, true);
      window.parent.postMessage(
        {
          type: "INTERNET_NAVIGATOR_FRAME",
          sessionId,
          nonce,
          frameId,
          documentId,
        },
        "*",
      );
      respond({ page: snapshot() });
      return;
    }
    if (
      raw.sessionId !== sessionId ||
      raw.nonce !== nonce ||
      raw.documentId !== documentId
    ) {
      respond({ error: "Stale frame command" });
      return;
    }
    if (raw.type === "FRAME_SCAN") {
      discovery.setQuery(raw.query || "");
      respond({ page: snapshot() });
      return;
    }
    if (raw.type === "FRAME_GUIDE") {
      clear();
      const p = snapshot(),
        target = discovery.bindings.get(raw.controlId);
      if (
        !target ||
        target.control.signature !== raw.signature ||
        !target.control.visible ||
        !target.control.enabled ||
        target.control.occluded ||
        (target.control.risk === "consequential" && !raw.review)
      ) {
        respond({ error: "Stale, hidden or ineligible frame target" });
        return;
      }
      selected = target;
      before = p;
      overlay.show(target.geometry, raw.instruction);
      respond({ ok: true });
      return;
    }
    if (raw.type === "FRAME_CLEAR") {
      clear();
      respond({ ok: true });
      return;
    }
    if (raw.type === "FRAME_STOP") {
      teardown();
      sessionId = "";
      respond({ ok: true });
      return;
    }
  });
  window.addEventListener("pagehide", teardown);
}
