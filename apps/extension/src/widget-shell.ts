import { currentGuidanceRect } from "../../../packages/overlay-ui";
let host: HTMLElement | undefined, frame: HTMLIFrameElement | undefined;
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
    size = { ...size, ...next };
    clamp();
  }
}
export function unmountWidget() {
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
  host.style.cssText =
    "position:fixed;z-index:2147483646;box-sizing:border-box;border:1px solid #bdcdbf;border-radius:18px;overflow:hidden;box-shadow:0 12px 36px #0003;background:#faf7f0;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML =
    '<style>*{box-sizing:border-box}.handle{height:28px;background:#e5ede5;display:flex;align-items:center;justify-content:space-between;padding:0 8px;font:12px system-ui;color:#1c2522;cursor:move;touch-action:none}.handle:focus-visible,.resize:focus-visible{outline:2px solid #1f6b57;outline-offset:-2px}.resize{position:absolute;bottom:0;right:0;width:28px;height:28px;cursor:nwse-resize;touch-action:none;background:#e5ede5;border:0;color:#1f6b57;border-radius:8px 0 0}.handle button{background:transparent;border:0;color:inherit;cursor:pointer}iframe{border:0;width:100%;height:calc(100% - 28px);display:block}</style><div class="handle" tabindex="0" role="group" aria-label="Move widget. Use arrow keys. Shift and arrow keys resize."><span>Tholi</span><button aria-label="Reset widget position">Reset</button></div><button class="resize" aria-label="Resize widget. Use arrow keys."><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 20 20 8M14 20l6-6"/></svg></button>';
  frame = document.createElement("iframe");
  frame.title = "Tholi guidance widget";
  frame.src = url;
  shadow.append(frame);
  document.documentElement.append(host);
  clamp();
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
    if (!e.key.startsWith("Arrow")) return;
    e.preventDefault();
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
    size = { width: 360, height: 420, x: innerWidth - 376, y: 16 };
    clamp();
    persist();
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
