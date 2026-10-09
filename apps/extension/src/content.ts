import { BrowserAdapter } from "../../../packages/browser-adapter";
import { GuidanceOverlay } from "../../../packages/overlay-ui";
import { RouteEngine } from "../../../packages/route-engine";
import { routeRegistry } from "../../../packages/route-registry";
import { allowedOrigin } from "../../../packages/safety-policy";
import { contentMessageSchema } from "../../../packages/route-schema";
import type { Transition } from "../../../packages/route-schema";
const marker = "__internetNavigatorLoaded";
const host = globalThis as typeof globalThis & { [marker]?: boolean };
if (!host[marker]) {
  host[marker] = true;
  const adapter = new BrowserAdapter(),
    overlay = new GuidanceOverlay();
  let engine: RouteEngine | undefined;
  let sessionId: string | undefined;
  let cleanup: (() => void) | undefined;
  let current: Transition | undefined;
  let target: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = () => {
    if (!engine || !sessionId) return;
    chrome.runtime
      .sendMessage({ type: "SESSION_UPDATE", sessionId, view: engine.view })
      .catch(() => {});
  };
  const clear = () => {
    overlay.clear();
    target = undefined;
    current = undefined;
  };
  const teardown = () => {
    cleanup?.();
    cleanup = undefined;
    clearTimeout(timer);
    timer = undefined;
    clear();
    document.removeEventListener("click", clicked, true);
  };
  const display = (transition: Transition | undefined) => {
    if (!engine) return;
    clear();
    if (transition) {
      const result = adapter.locate(transition.target);
      engine.view.diagnostics!.target = {
        ...result,
        candidates: result.candidates.slice(0, 50),
      };
      if (!result.id) {
        engine.stop(result.reason);
      } else {
        const element = adapter.elements.get(result.id);
        if (element) {
          current = transition;
          target = element;
          overlay.show(element, engine.view.instruction);
        }
      }
    }
    if (
      ["stopped", "boundary", "completed", "checkpoint"].includes(
        engine.view.status,
      )
    )
      teardown();
    publish();
  };
  const update = () => {
    if (!engine) return;
    const next = engine.update(adapter.snapshot());
    if (engine.view.status === "waiting") {
      overlay.clear();
      publish();
      return;
    }
    clearTimeout(timer);
    timer = undefined;
    display(next);
  };
  const clicked = (event: MouseEvent) => {
    if (
      !engine ||
      !current ||
      !target ||
      !(event.target instanceof Node) ||
      !target.contains(event.target)
    )
      return;
    const fresh = adapter.locate(current.target);
    engine.view.diagnostics!.target = {
      ...fresh,
      candidates: fresh.candidates.slice(0, 50),
    };
    if (!fresh.id || adapter.elements.get(fresh.id) !== target) {
      engine.stop("The target changed. Start again after checking the page.");
      teardown();
      publish();
      return;
    }
    const step = current;
    engine.wait(step);
    clear();
    publish();
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (engine) display(engine.timeout(adapter.snapshot()));
    }, step.timeoutMs);
  };
  const observe = () => {
    cleanup = adapter.observe(update);
    document.addEventListener("click", clicked, true);
  };
  chrome.runtime.onMessage.addListener((raw, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    const parsed = contentMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === "BEGIN_SESSION") {
      const route = routeRegistry.get(message.routeId, message.routeVersion);
      if (!route || !allowedOrigin(route, location.origin)) {
        respond({
          error: "Route is unavailable or unsupported on this origin.",
        });
        return;
      }
      teardown();
      sessionId = message.sessionId;
      engine = new RouteEngine(route);
      observe();
      display(engine.start(adapter.snapshot()));
    } else {
      if (!engine || message.sessionId !== sessionId) {
        respond({ error: "Stale session command." });
        return;
      }
      switch (message.action) {
        case "PAUSE":
          engine.pause();
          teardown();
          publish();
          break;
        case "RESUME":
          if (["paused", "checkpoint"].includes(engine.view.status)) {
            teardown();
            observe();
            display(engine.resume(adapter.snapshot()));
          }
          break;
        case "STOP":
          engine.stop();
          teardown();
          publish();
          break;
      }
    }
    respond({ view: engine?.view });
  });
  window.addEventListener("pagehide", () => {
    if (!engine) return;
    if (!["boundary", "completed", "stopped"].includes(engine.view.status))
      engine.stop(
        "Page closed or reloaded. Start again on the current screen.",
      );
    teardown();
    publish();
  });
}
