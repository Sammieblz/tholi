import { BrowserAdapter } from "../../../packages/browser-adapter";
import { GuidanceOverlay } from "../../../packages/overlay-ui";
import { RouteEngine } from "../../../packages/route-engine";
import { demoRoute } from "../../../routes/demo/cancellation";
import { messageSchema } from "../../../packages/route-schema";
import type { Transition } from "../../../packages/route-schema";
const marker = "__internetNavigatorLoaded";
const host = globalThis as typeof globalThis & { [marker]?: boolean };
if (!host[marker]) {
  host[marker] = true;
  const adapter = new BrowserAdapter(),
    overlay = new GuidanceOverlay();
  let engine = new RouteEngine(demoRoute);
  let cleanup: (() => void) | undefined;
  let current: Transition | undefined;
  let target: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = () => {
    chrome.runtime
      .sendMessage({ type: "SESSION_UPDATE", view: engine.view })
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
    clear();
    if (transition) {
      const result = adapter.locate(transition.target);
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
      !current ||
      !target ||
      !(event.target instanceof Node) ||
      !target.contains(event.target)
    )
      return;
    const fresh = adapter.locate(current.target);
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
      display(engine.timeout(adapter.snapshot()));
    }, step.timeoutMs);
  };
  const observe = () => {
    cleanup = adapter.observe(update);
    document.addEventListener("click", clicked, true);
  };
  chrome.runtime.onMessage.addListener((raw, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    const parsed = messageSchema.safeParse(raw);
    if (!parsed.success) return;
    switch (parsed.data.type) {
      case "START":
        teardown();
        engine = new RouteEngine(demoRoute);
        observe();
        display(engine.start(adapter.snapshot()));
        break;
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
    respond({ view: engine.view });
  });
  window.addEventListener("pagehide", () => {
    if (!["boundary", "completed", "stopped"].includes(engine.view.status))
      engine.stop(
        "Page closed or reloaded. Start again on the current screen.",
      );
    teardown();
    publish();
  });
}
