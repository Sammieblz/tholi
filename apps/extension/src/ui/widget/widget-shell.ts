import { currentGuidanceRect } from "../../../../../packages/overlay-ui";
import { widgetStyles } from "./widget-styles";
import { contrastPageTheme } from "../../../../../packages/ui/page-theme";
import {
  wayfinderMarkup,
  wayfinderStyles,
  updateWayfinder,
  type WayfinderState,
} from "../../../../../packages/ui/wayfinder";
import { dockIntent } from "./presentation-state";
import { bindLauncherControls } from "./launcher-controls";
import {
  widgetDensity,
  widgetLayoutActions,
  type WidgetDensity,
  type WidgetLayoutAction,
} from "../../../../../packages/ui/widget-density";
let host: HTMLElement | undefined, frame: HTMLIFrameElement | undefined;
let shadowRoot: ShadowRoot | undefined;
let minimized = false;
let currentPhase = "idle";
let currentMarker: WayfinderState | undefined;
let movement: Animation | undefined;
const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
let size = { width: 360, height: 420, x: 16, y: 16 },
  focused = false,
  dragging = false,
  cleanup: (() => void) | undefined;
function clamp() {
  size.width = Math.min(Math.max(240, size.width), innerWidth - 16);
  size.height = Math.min(Math.max(180, size.height), innerHeight - 16);
  size.x = Math.max(8, Math.min(size.x, innerWidth - size.width - 8));
  size.y = Math.max(8, Math.min(size.y, innerHeight - size.height - 8));
  draw();
}
function draw() {
  if (host && !minimized)
    host.dataset.density = widgetDensity(
      size.width - 2,
      size.height - 30,
      host.dataset.density as WidgetDensity | undefined,
    );
  if (host)
    Object.assign(host.style, {
      left:
        (minimized
          ? Math.min(innerWidth - 52, size.x + size.width - 44)
          : size.x) + "px",
      top: size.y + "px",
      width: (minimized ? 44 : size.width) + "px",
      height: (minimized ? 44 : size.height) + "px",
    });
}
export function moveWidgetAside() {
  if (minimized) return;
  const r = currentGuidanceRect();
  const candidates = [
    { x: 8, y: 8 },
    { x: innerWidth - size.width - 8, y: 8 },
    { x: 8, y: innerHeight - size.height - 8 },
    { x: innerWidth - size.width - 8, y: innerHeight - size.height - 8 },
  ];
  const next = candidates
    .filter(
      (p) =>
        !r ||
        r.right < p.x ||
        r.left > p.x + size.width ||
        r.bottom < p.y ||
        r.top > p.y + size.height,
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - size.x, a.y - size.y) -
        Math.hypot(b.x - size.x, b.y - size.y),
    )[0];
  if (next) {
    const previous = { ...size };
    size = { ...size, ...next };
    clamp();
    movement?.cancel();
    if (!reducedMotion() && host?.animate)
      movement = host.animate(
        [
          {
            transform: `translate(${previous.x - size.x}px,${previous.y - size.y}px)`,
          },
          { transform: "translate(0,0)" },
        ],
        { duration: 240, easing: "cubic-bezier(0.77,0,0.175,1)" },
      );
  }
}
export function expandWidgetShell() {
  if (!host || minimized) return undefined;
  movement?.cancel();
  size = { ...size, width: 420, height: 620 };
  clamp();
  return { ...size };
}
export function applyWidgetLayout(action: WidgetLayoutAction) {
  if (!host || minimized || !widgetLayoutActions.includes(action))
    return undefined;
  movement?.cancel();
  if (action === "reset")
    size = { width: 360, height: 420, x: innerWidth - 376, y: 16 };
  else if (action === "left") size.x -= 48;
  else if (action === "right") size.x += 48;
  else if (action === "up") size.y -= 48;
  else if (action === "down") size.y += 48;
  else {
    const delta = action === "larger" ? 48 : -48;
    size.width += delta;
    size.height += delta;
  }
  clamp();
  return { ...size };
}
export function unmountWidget() {
  movement?.cancel();
  movement = undefined;
  cleanup?.();
  cleanup = undefined;
  host?.remove();
  host = undefined;
  frame = undefined;
  shadowRoot = undefined;
}
function markerState(phase: string): WayfinderState {
  if (["initializing", "planning", "recovering"].includes(phase))
    return "planning";
  if (["clarification", "access", "review", "authentication"].includes(phase))
    return "attention";
  if (phase === "verifying") return "verifying";
  if (["guiding", "paused", "arrived"].includes(phase))
    return phase as WayfinderState;
  return "idle";
}
export function updateWidgetShell(phase: string, state?: WayfinderState) {
  currentPhase = phase;
  currentMarker = state;
  const marker = shadowRoot?.querySelector<HTMLElement>(".tholi-wayfinder");
  if (marker) {
    updateWayfinder(marker, state || markerState(phase));
  }
  const launcher = shadowRoot?.querySelector<HTMLButtonElement>(".launcher");
  if (launcher) {
    const attention = ["clarification", "access", "review"].includes(phase);
    launcher.setAttribute(
      "aria-label",
      attention
        ? "Open Tholi. Your task needs attention."
        : phase === "arrived"
          ? "Open Tholi. Destination verified."
          : "Open Tholi",
    );
    launcher.title = attention ? "Tholi needs your attention" : "Open Tholi";
  }
}
export async function mountWidgetShell(
  url: string,
  sessionId: string,
  bounds?: typeof size,
  visibility: "expanded" | "launcher" = "expanded",
  phase = "idle",
  surface: "sidebar" | "widget" = "widget",
  marker?: WayfinderState,
) {
  if (!url.startsWith(chrome.runtime.getURL("widget.html") + "?grant=")) return;
  unmountWidget();
  minimized = visibility === "launcher";
  if (bounds) size = { ...bounds };
  else size = { width: 360, height: 420, x: innerWidth - 376, y: 16 };
  host = document.createElement("div");
  host.id = "tholi-widget";
  host.dataset.tholiUi = "";
  host.dataset.tholiTheme = contrastPageTheme();
  host.style.cssText =
    "position:fixed;z-index:2147483646;box-sizing:border-box;border:1px solid #809087;border-radius:14px;overflow:hidden;box-shadow:0 4px 12px #0001,0 16px 40px #0003;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadowRoot = shadow;
  const svg = (path: string) =>
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
  if (minimized) {
    host.dataset.minimized = "true";
    host.style.borderRadius = "50%";
    shadow.innerHTML = `<style>${widgetStyles}${wayfinderStyles}</style><button class="launcher" aria-label="Open Tholi" aria-expanded="false" aria-controls="tholi-launcher-actions" aria-describedby="tholi-launcher-help" aria-keyshortcuts="Shift+F10">${wayfinderMarkup({ state: marker || markerState(phase), instance: "launcher" })}</button><span class="launcher-help" id="tholi-launcher-help">Right-click or press Shift+F10 for controls. Double-click the floating widget launcher to reveal Remove.</span><div class="launcher-actions" id="tholi-launcher-actions" role="group" aria-label="Tholi launcher controls" hidden><button class="launcher-open">Open Tholi</button><button class="launcher-remove" aria-label="Remove Tholi from this page">${svg("m6 6 12 12M18 6 6 18")}<span>Remove</span></button></div><div class="launcher-notice" hidden role="status"></div>`;
    const showRecovery = (message: string) => {
      if (!host?.isConnected) return;
      host.style.overflow = "visible";
      const notice = shadow.querySelector<HTMLElement>(".launcher-notice")!;
      notice.textContent = message;
      notice.hidden = false;
    };
    const open = () => {
      const failed = () =>
        showRecovery(
          "Click Tholi in Chrome's toolbar to reopen it. Your task is retained.",
        );
      void chrome.runtime
        .sendMessage({
          type: surface === "sidebar" ? "UI_DOCK" : "UI_RESTORE",
          sessionId,
        })
        .then((reply) => {
          if (reply?.error) failed();
        })
        .catch(failed);
    };
    const remove = async () => {
      try {
        const reply = await chrome.runtime.sendMessage({
          type: "UI_DISMISS",
          sessionId,
        });
        if (!reply?.ok) throw Error("Dismissal unavailable");
      } catch (error) {
        showRecovery(
          "Could not hide Tholi. Try Remove again. Your task is retained.",
        );
        throw error;
      }
    };
    const clearControls = bindLauncherControls(
      host,
      shadow,
      open,
      remove,
      surface === "sidebar",
    );
    document.documentElement.append(host);
    clamp();
    const visibilityChanged = () =>
      updateWidgetShell(currentPhase, currentMarker);
    currentPhase = phase;
    updateWidgetShell(phase, marker);
    window.addEventListener("resize", clamp);
    document.addEventListener("visibilitychange", visibilityChanged);
    cleanup = () => {
      clearControls();
      window.removeEventListener("resize", clamp);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
    return;
  }
  shadow.innerHTML = `<style>${widgetStyles}</style><div class="handle" tabindex="0" role="group" aria-label="Move widget. Use arrow keys. Shift and arrow keys resize."><span>Tholi</span><div><button class="minimize" aria-label="Minimize Tholi" title="Minimize Tholi">${svg("m6 6 12 12M18 6 6 18")}</button></div></div><div class="dock-preview" hidden>Release to dock</div><div class="shell-notice" hidden role="status"></div><button class="resize" aria-label="Resize widget. Use arrow keys.">${svg("M8 20 20 8M14 20l6-6")}</button>`;
  frame = document.createElement("iframe");
  frame.title = "Tholi guidance widget";
  frame.src = url;
  shadow.append(frame);
  document.documentElement.append(host);
  clamp();
  if (!reducedMotion() && host.animate)
    movement = host.animate(
      [
        { opacity: 0, transform: "translateY(6px) scale(.98)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ],
      { duration: 180, easing: "cubic-bezier(0.23,1,0.32,1)" },
    );
  const handle = shadow.querySelector<HTMLElement>(".handle")!,
    resize = shadow.querySelector<HTMLElement>(".resize")!;
  const persist = () =>
    void chrome.runtime
      .sendMessage({ type: "UI_WIDGET_BOUNDS", sessionId, bounds: size })
      .catch(() => {});
  const dock = () => {
    // Called directly by pointerup/click to preserve Chrome user activation.
    void chrome.runtime
      .sendMessage({ type: "UI_DOCK", sessionId })
      .then((reply) => {
        if (!reply?.error) return;
        const notice = shadow.querySelector<HTMLElement>(".shell-notice");
        if (notice) {
          notice.textContent =
            "Click Dock to sidebar or the Tholi toolbar icon. Your task is retained.";
          notice.hidden = false;
        }
      })
      .catch(() => {});
  };
  shadow.querySelector<HTMLButtonElement>(".minimize")!.onclick = () => {
    void chrome.runtime
      .sendMessage({ type: "UI_MINIMIZE", sessionId })
      .catch(() => {});
  };
  const pointer = (e: PointerEvent, resizing: boolean) => {
    if (
      e.button !== 0 ||
      dragging ||
      (e.target as Element).closest(".handle button")
    )
      return;
    e.preventDefault();
    movement?.cancel();
    dragging = true;
    const el = e.currentTarget as HTMLElement,
      begin = { ...size },
      x = e.clientX,
      y = e.clientY;
    el.setPointerCapture(e.pointerId);
    if (frame) frame.style.pointerEvents = "none";
    const move = (v: PointerEvent) => {
      size = resizing
        ? {
            ...begin,
            width: begin.width + v.clientX - x,
            height: begin.height + v.clientY - y,
          }
        : { ...begin, x: begin.x + v.clientX - x, y: begin.y + v.clientY - y };
      clamp();
      shadow.querySelector<HTMLElement>(".dock-preview")!.hidden =
        resizing ||
        !dockIntent(size.x, size.width, innerWidth) ||
        Math.hypot(v.clientX - x, v.clientY - y) < 12;
    };
    const end = (event: PointerEvent) => {
      dragging = false;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      if (frame) frame.style.pointerEvents = "";
      const preview = shadow.querySelector<HTMLElement>(".dock-preview")!;
      const shouldDock = !preview.hidden && event.type !== "pointercancel";
      preview.hidden = true;
      if (shouldDock) dock();
      persist();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };
  handle.onpointerdown = (e) => pointer(e, false);
  resize.onpointerdown = (e) => pointer(e, true);
  const keys = (e: KeyboardEvent, resizing: boolean) => {
    if ((e.target as Element).closest("button") && !resizing) return;
    if (!e.key.startsWith("Arrow")) return;
    e.preventDefault();
    movement?.cancel();
    const dx = e.key === "ArrowRight" ? 16 : e.key === "ArrowLeft" ? -16 : 0,
      dy = e.key === "ArrowDown" ? 16 : e.key === "ArrowUp" ? -16 : 0;
    if (resizing || e.shiftKey) {
      size.width += dx;
      size.height += dy;
    } else {
      size.x += dx;
      size.y += dy;
    }
    clamp();
    persist();
  };
  handle.onkeydown = (e) => keys(e, false);
  resize.onkeydown = (e) => keys(e, true);
  const focus = () => {
    focused = document.activeElement === host;
  };
  window.addEventListener("focus", focus, true);
  window.addEventListener("blur", focus, true);
  window.addEventListener("resize", clamp);
  const timer = setInterval(() => {
    if (focused || dragging) return;
    const r = currentGuidanceRect();
    if (!r) return;
    if (
      r.right > size.x &&
      r.left < size.x + size.width &&
      r.bottom > size.y &&
      r.top < size.y + size.height
    ) {
      moveWidgetAside();
    }
  }, 250);
  cleanup = () => {
    clearInterval(timer);
    window.removeEventListener("resize", clamp);
    window.removeEventListener("focus", focus, true);
    window.removeEventListener("blur", focus, true);
  };
}
