import { clippedRect, type PresentedRect } from "../browser-adapter/geometry";
let activeRect: PresentedRect | undefined;
export function currentGuidanceRect() {
  return activeRect;
}
export interface OverlayOptions {
  key?: string;
  attention?: boolean;
  warning?: boolean;
}
export class GuidanceOverlay {
  private root?: HTMLElement;
  private shadow?: ShadowRoot;
  private target?: HTMLElement;
  private tip?: HTMLElement;
  private halo?: HTMLElement;
  private glow?: HTMLElement;
  private arrow?: HTMLElement;
  private instruction = "";
  private identity = "";
  private frame = 0;
  private drawn = "";
  private reminder?: ReturnType<typeof setTimeout>;
  private pulse?: Animation;
  private entrance: Animation[] = [];
  private cancelReminder = () => {
    clearTimeout(this.reminder);
    this.reminder = undefined;
    this.pulse?.cancel();
    this.pulse = undefined;
    if (this.glow) this.glow.style.opacity = "0";
  };
  private refresh = () => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
      if (this.root) this.refresh();
    });
  };
  show(target: HTMLElement, instruction: string, options: OverlayOptions = {}) {
    const changed =
      target !== this.target ||
      [options.key || "", instruction].join("|") !== this.identity;
    this.target = target;
    this.instruction = instruction;
    if (!this.root) this.mount();
    if (options.attention === false || options.warning) this.cancelReminder();
    this.tip!.classList.toggle("warning", !!options.warning);
    if (changed) {
      this.entrance.forEach((animation) => animation.cancel());
      this.entrance = [];
      this.cancelReminder();
      this.identity = [options.key || "", instruction].join("|");
      this.tip!.querySelector(".instruction")!.textContent = instruction;
      this.tip!.classList.toggle("warning", !!options.warning);
      if (
        options.attention !== false &&
        !options.warning &&
        !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      )
        this.reminder = setTimeout(() => {
          if (
            !this.glow ||
            this.halo?.hidden ||
            document.visibilityState === "hidden" ||
            !this.glow.animate
          )
            return;
          this.pulse = this.glow.animate(
            [{ opacity: 0 }, { opacity: 0.65, offset: 0.45 }, { opacity: 0 }],
            {
              duration: 1200,
              iterations: 4,
              easing: "cubic-bezier(0.77,0,0.175,1)",
            },
          );
        }, 4000);
    }
    this.draw();
    if (
      changed &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      for (const element of [this.halo, this.tip])
        if (element?.animate)
          this.entrance.push(
            element.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: 180,
              easing: "cubic-bezier(0.23,1,0.32,1)",
            }),
          );
    }
    this.refresh();
  }
  private mount() {
    this.root = document.createElement("div");
    this.root.id = "internet-navigator-overlay";
    this.root.setAttribute("aria-hidden", "true");
    this.root.dataset.tholiUi = "";
    this.root.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    this.shadow = this.root.attachShadow({ mode: "closed" });
    this.shadow.innerHTML = `<style>:host{all:initial}*{box-sizing:border-box}.halo,.glow{position:fixed;border:3px solid #1f6b57;border-radius:10px;box-shadow:0 0 0 2px #fff,0 0 0 5px #1f6b5730;pointer-events:none}.glow{border-color:#e6af57;box-shadow:0 0 0 8px #e6af5740;opacity:0}.tip{position:fixed;width:min(278px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:hidden;padding:14px 16px;background:#faf7f0;color:#1c2522;border:1px solid #bdcdbf;border-radius:16px;font:14px/1.5 Inter,system-ui;box-shadow:0 8px 28px #0003;pointer-events:none;overflow-wrap:anywhere}.brand{display:block;color:#1f6b57;font-size:12px;font-weight:650;margin-bottom:6px}.brand::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:#e6af57;margin-right:7px}.warning{border-color:#745014}.arrow{position:fixed;background:#faf7f0;color:#1c2522;border:2px solid #1f6b57;border-radius:14px;padding:12px;font:14px Inter,system-ui;display:flex;gap:8px;align-items:center}.arrow svg{width:22px;height:22px;animation:direction 900ms cubic-bezier(.77,0,.175,1) 3}.arrow[data-direction=up]{--dx:0px;--dy:-6px}.arrow[data-direction=down]{--dx:0px;--dy:6px}.arrow[data-direction=left]{--dx:-6px;--dy:0px}.arrow[data-direction=right]{--dx:6px;--dy:0px}@keyframes direction{50%{transform:translate(var(--dx),var(--dy))}}@media(prefers-reduced-motion:reduce){.halo,.tip,.arrow svg{animation:none}}[hidden]{display:none!important}</style><div class="halo"></div><div class="glow"></div><div class="tip"><span class="brand">Tholi · Your next step</span><span class="instruction"></span></div><div class="arrow" hidden></div>`;
    this.tip = this.shadow.querySelector(".tip")!;
    this.halo = this.shadow.querySelector(".halo")!;
    this.glow = this.shadow.querySelector(".glow")!;
    this.arrow = this.shadow.querySelector(".arrow")!;
    document.documentElement.append(this.root);
    window.addEventListener("scroll", this.refresh, true);
    window.addEventListener("resize", this.refresh);
    for (const event of [
      "pointerdown",
      "keydown",
      "pagehide",
      "wheel",
      "touchstart",
    ])
      window.addEventListener(event, this.cancelReminder, true);
  }
  private scrollSurface(): PresentedRect {
    let ancestor = this.target?.parentElement;
    while (ancestor && ancestor !== document.body) {
      const style = getComputedStyle(ancestor);
      if (
        /auto|scroll/.test(style.overflow + style.overflowY + style.overflowX)
      ) {
        const r = ancestor.getBoundingClientRect();
        if (r.width && r.height) return r;
      }
      ancestor = ancestor.parentElement;
    }
    return {
      left: 0,
      top: 0,
      right: innerWidth,
      bottom: innerHeight,
      width: innerWidth,
      height: innerHeight,
    };
  }
  private draw() {
    if (!this.shadow || !this.target?.isConnected) {
      this.clear();
      return;
    }
    const style = getComputedStyle(this.target),
      raw = this.target.getBoundingClientRect(),
      surface = this.scrollSurface();
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      !raw.width ||
      !raw.height
    ) {
      this.clear();
      return;
    }
    const r = clippedRect(this.target),
      off =
        !r ||
        raw.bottom <= Math.max(0, surface.top) ||
        raw.top >= Math.min(innerHeight, surface.bottom) ||
        raw.right <= Math.max(0, surface.left) ||
        raw.left >= Math.min(innerWidth, surface.right);
    const box = r || raw;
    const key = [
      box.left,
      box.top,
      box.right,
      box.bottom,
      innerWidth,
      innerHeight,
      off,
      this.identity,
      this.instruction,
    ].join("|");
    if (key === this.drawn) return;
    this.drawn = key;
    this.halo!.hidden = off;
    this.glow!.hidden = off;
    this.arrow!.hidden = !off;
    if (off) {
      const direction =
        raw.top >= surface.bottom
          ? "down"
          : raw.bottom <= surface.top
            ? "up"
            : raw.left >= surface.right
              ? "right"
              : raw.right <= surface.left
                ? "left"
                : raw.top >= innerHeight
                  ? "down"
                  : "up";
      if (this.arrow!.dataset.direction !== direction) {
        this.arrow!.dataset.direction = direction;
        const paths = {
          down: "M12 4v16m-6-6 6 6 6-6",
          up: "M12 20V4m-6 6 6-6 6 6",
          right: "M4 12h16m-6-6 6 6-6 6",
          left: "M20 12H4m6-6-6 6 6 6",
        };
        this.arrow!.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="${paths[direction]}"/></svg><span>Scroll ${direction}</span>`;
      }
      Object.assign(this.arrow!.style, {
        left:
          Math.max(12, Math.min(surface.right - 180, innerWidth - 190)) + "px",
        top:
          Math.max(
            12,
            Math.min(surface.top + surface.height / 2, innerHeight - 60),
          ) + "px",
      });
    } else {
      for (const el of [this.halo!, this.glow!])
        Object.assign(el.style, {
          left: box.left - 5 + "px",
          top: box.top - 5 + "px",
          width: box.width + 10 + "px",
          height: box.height + 10 + "px",
        });
    }
    activeRect =
      this.target
        .closest('[role="menu"],[role="listbox"],[role="dialog"]')
        ?.getBoundingClientRect() || box;
    this.placeTip(box);
  }
  private placeTip(r: PresentedRect) {
    const tip = this.tip!,
      b = tip.getBoundingClientRect(),
      clamp = (v: number, max: number) =>
        Math.max(12, Math.min(v, Math.max(12, max)));
    const menu = this.target
      ?.closest('[role="menu"],[role="listbox"],[role="dialog"]')
      ?.getBoundingClientRect();
    const avoid = menu || r;
    const overlaps = (p: { x: number; y: number }) =>
      Math.max(
        0,
        Math.min(p.x + b.width, avoid.right) - Math.max(p.x, avoid.left),
      ) *
      Math.max(
        0,
        Math.min(p.y + b.height, avoid.bottom) - Math.max(p.y, avoid.top),
      );
    const positions = [
      { x: r.left, y: avoid.bottom + 12 },
      { x: r.left, y: avoid.top - b.height - 12 },
      { x: avoid.right + 12, y: r.top },
      { x: avoid.left - b.width - 12, y: r.top },
      { x: 12, y: 12 },
      { x: innerWidth - b.width - 12, y: 12 },
      { x: 12, y: innerHeight - b.height - 12 },
      { x: innerWidth - b.width - 12, y: innerHeight - b.height - 12 },
    ].map((p) => ({
      x: clamp(p.x, innerWidth - b.width - 12),
      y: clamp(p.y, innerHeight - b.height - 12),
    }));
    const p =
      positions.find((p) => !overlaps(p)) ||
      positions.sort((a, b) => overlaps(a) - overlaps(b))[0];
    tip.style.left = p.x + "px";
    tip.style.top = p.y + "px";
  }
  clear() {
    this.entrance.forEach((animation) => animation.cancel());
    this.entrance = [];
    activeRect = undefined;
    this.cancelReminder();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.drawn = "";
    window.removeEventListener("scroll", this.refresh, true);
    window.removeEventListener("resize", this.refresh);
    for (const event of [
      "pointerdown",
      "keydown",
      "pagehide",
      "wheel",
      "touchstart",
    ])
      window.removeEventListener(event, this.cancelReminder, true);
    const root = this.root;
    if (root) {
      root.id = "";
      root.style.transition = "opacity 120ms cubic-bezier(.23,1,.32,1)";
      root.style.opacity = "0";
      const exit = root.animate?.([{ opacity: 1 }, { opacity: 0 }], {
        duration: 120,
        easing: "cubic-bezier(.23,1,.32,1)",
      });
      if (exit?.finished)
        void exit.finished.then(
          () => root.remove(),
          () => root.remove(),
        );
      else root.remove();
    }
    this.root = undefined;
    this.shadow = undefined;
    this.target = undefined;
    this.identity = "";
  }
}
