import { currentGuidanceRect } from "../../../../../packages/overlay-ui";
import { widgetStyles } from "./widget-styles";
import { contrastPageTheme } from "../../../../../packages/ui/page-theme";
let host: HTMLElement | undefined, frame: HTMLIFrameElement | undefined;
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
  if (host)
    Object.assign(host.style, {
      left: size.x + "px",
      top: size.y + "px",
      width: size.width + "px",
      height: size.height + "px",
    });
}
export function moveWidgetAside() {
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
export function unmountWidget() {
  movement?.cancel();
  movement = undefined;
  cleanup?.();
  cleanup = undefined;
  host?.remove();
  host = undefined;
  frame = undefined;
}
export async function mountWidgetShell(
  url: string,
  sessionId: string,
  bounds?: typeof size,
) {
  if (!url.startsWith(chrome.runtime.getURL("widget.html") + "?grant=")) return;
  unmountWidget();
  if (bounds) size = { ...bounds };
  else size = { width: 360, height: 420, x: innerWidth - 376, y: 16 };
  host = document.createElement("div");
  host.id = "tholi-widget";
  host.dataset.tholiUi = "";
  host.dataset.tholiTheme = contrastPageTheme();
  host.style.cssText =
    "position:fixed;z-index:2147483646;box-sizing:border-box;border:1px solid #809087;border-radius:14px;overflow:hidden;box-shadow:0 4px 12px #0001,0 16px 40px #0003;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>${widgetStyles}</style><div class="handle" tabindex="0" role="group" aria-label="Move widget. Use arrow keys. Shift and arrow keys resize."><span>Tholi</span><div><button aria-label="Reset widget position">Reset</button><button class="layout-toggle" aria-label="Widget layout" aria-expanded="false">Layout</button></div></div><div class="layout" hidden role="group" aria-label="Widget position and size"><p>Position</p><div><button data-move="left">Left</button><button data-move="right">Right</button><button data-move="up">Up</button><button data-move="down">Down</button></div><p>Size</p><div><button data-size="smaller">Smaller</button><button data-size="larger">Larger</button></div><button class="layout-close">Done</button></div><button class="resize" aria-label="Resize widget. Use arrow keys."><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 20 20 8M14 20l6-6"/></svg></button>`;
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
    };
    const end = () => {
      dragging = false;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      if (frame) frame.style.pointerEvents = "";
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
  shadow.querySelector(".handle button")!.addEventListener("click", () => {
    movement?.cancel();
    size = { width: 360, height: 420, x: innerWidth - 376, y: 16 };
    clamp();
    persist();
  });
  const layout = shadow.querySelector<HTMLElement>(".layout")!,
    toggle = shadow.querySelector<HTMLButtonElement>(".layout-toggle")!;
  const closeLayout = () => {
    layout.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  };
  toggle.onclick = () => {
    layout.hidden = !layout.hidden;
    toggle.setAttribute("aria-expanded", String(!layout.hidden));
    if (!layout.hidden)
      layout.querySelector<HTMLButtonElement>("button")!.focus();
  };
  layout.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeLayout();
    }
  });
  layout.querySelector(".layout-close")!.addEventListener("click", closeLayout);
  layout
    .querySelectorAll<HTMLButtonElement>("[data-move],[data-size]")
    .forEach((button) => {
      button.onclick = () => {
        movement?.cancel();
        if (button.dataset.move) {
          size.x +=
            button.dataset.move === "left"
              ? -48
              : button.dataset.move === "right"
                ? 48
                : 0;
          size.y +=
            button.dataset.move === "up"
              ? -48
              : button.dataset.move === "down"
                ? 48
                : 0;
        } else {
          const delta = button.dataset.size === "larger" ? 48 : -48;
          size.width += delta;
          size.height += delta;
        }
        clamp();
        persist();
      };
    });
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
