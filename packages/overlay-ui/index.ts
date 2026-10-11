export class GuidanceOverlay {
  private root?: HTMLElement;
  private shadow?: ShadowRoot;
  private target?: HTMLElement;
  private instruction = "";
  private frame = 0;
  private drawn = "";
  private refresh = () => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
      if (this.root) this.refresh();
    });
  };
  show(target: HTMLElement, instruction: string) {
    this.target = target;
    this.instruction = instruction;
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.id = "internet-navigator-overlay";
      this.root.setAttribute("aria-hidden", "true");
      this.root.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
      this.shadow = this.root.attachShadow({ mode: "closed" });
      document.documentElement.append(this.root);
      window.addEventListener("scroll", this.refresh, true);
      window.addEventListener("resize", this.refresh);
    }
    this.draw();
    this.refresh();
  }
  private draw() {
    if (!this.shadow || !this.target?.isConnected) {
      this.clear();
      return;
    }
    const r = this.target.getBoundingClientRect(),
      style = getComputedStyle(this.target);
    if (
      !r.width ||
      !r.height ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      this.clear();
      return;
    }
    const key = [
      r.left,
      r.top,
      r.right,
      r.bottom,
      innerWidth,
      innerHeight,
      this.instruction,
    ].join("|");
    if (key === this.drawn) return;
    this.drawn = key;
    const off =
      r.bottom <= 0 ||
      r.top >= innerHeight ||
      r.right <= 0 ||
      r.left >= innerWidth;
    this.shadow.innerHTML =
      "<style>:host{all:initial}*{box-sizing:border-box}.halo{position:fixed;border:3px solid #35d4aa;border-radius:12px;box-shadow:0 0 0 6px #35d4aa33;pointer-events:none}.tip{position:fixed;width:min(278px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:hidden;padding:14px 16px;background:#102b2a;color:#fff;border:1px solid #35d4aa;border-radius:14px;font:14px/1.45 system-ui;box-shadow:0 8px 32px #0004;pointer-events:none;overflow-wrap:anywhere}.brand{display:block;color:#78efd0;font-size:10px;font-weight:800;letter-spacing:1.5px;margin-bottom:6px}.cursor{position:fixed;color:#35d4aa;font:28px system-ui;text-shadow:0 0 2px #000;pointer-events:none}.arrow{position:fixed;right:20px;top:45%;background:#102b2a;color:#78efd0;border:1px solid #35d4aa;border-radius:14px;padding:14px;font:18px system-ui;pointer-events:none}</style>";
    const tip = document.createElement("div");
    tip.className = "tip";
    tip.style.visibility = "hidden";
    const brand = document.createElement("span");
    brand.className = "brand";
    brand.textContent = "INTERNET NAVIGATOR · COACH";
    tip.append(brand, document.createTextNode(this.instruction));
    this.shadow.append(tip);
    const box = tip.getBoundingClientRect();
    const clamp = (value: number, max: number) =>
      Math.max(12, Math.min(value, Math.max(12, max)));
    const x = clamp(r.left, innerWidth - box.width - 12),
      y = clamp(r.bottom + 12, innerHeight - box.height - 12);
    const placements = [
      { x, y: r.bottom + 12 },
      { x, y: r.top - box.height - 12 },
      { x: r.right + 18, y: clamp(r.top, innerHeight - box.height - 12) },
      {
        x: r.left - box.width - 18,
        y: clamp(r.top, innerHeight - box.height - 12),
      },
    ];
    const fits = (p: { x: number; y: number }) =>
      p.x >= 12 &&
      p.y >= 12 &&
      p.x + box.width <= innerWidth - 12 &&
      p.y + box.height <= innerHeight - 12;
    const corners = [
      { x: 12, y: 12 },
      { x: clamp(innerWidth - box.width - 12, innerWidth), y: 12 },
      { x: 12, y: clamp(innerHeight - box.height - 12, innerHeight) },
      {
        x: clamp(innerWidth - box.width - 12, innerWidth),
        y: clamp(innerHeight - box.height - 12, innerHeight),
      },
    ];
    const overlap = (p: { x: number; y: number }) =>
      Math.max(0, Math.min(p.x + box.width, r.right) - Math.max(p.x, r.left)) *
      Math.max(0, Math.min(p.y + box.height, r.bottom) - Math.max(p.y, r.top));
    const placement = placements.find(fits) ||
      corners.sort((a, b) => overlap(a) - overlap(b))[0] || { x, y };
    tip.style.left = placement.x + "px";
    tip.style.top = placement.y + "px";
    tip.style.visibility = "visible";
    if (off) {
      const arrow = document.createElement("div");
      arrow.className = "arrow";
      arrow.textContent =
        r.top >= innerHeight
          ? "↓ Scroll down"
          : r.bottom <= 0
            ? "↑ Scroll up"
            : r.left >= innerWidth
              ? "→ Scroll right"
              : "← Scroll left";
      this.shadow.append(arrow);
    } else {
      const halo = document.createElement("div");
      halo.className = "halo";
      Object.assign(halo.style, {
        left: r.left - 5 + "px",
        top: r.top - 5 + "px",
        width: r.width + 10 + "px",
        height: r.height + 10 + "px",
      });
      const cursor = document.createElement("div");
      cursor.className = "cursor";
      cursor.textContent = "◇";
      cursor.style.left =
        Math.max(0, Math.min(r.right + 8, innerWidth - 28)) + "px";
      cursor.style.top =
        Math.max(0, Math.min(r.top - 12, innerHeight - 28)) + "px";
      this.shadow.append(halo, cursor);
    }
  }
  clear() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.drawn = "";
    window.removeEventListener("scroll", this.refresh, true);
    window.removeEventListener("resize", this.refresh);
    this.root?.remove();
    this.root = undefined;
    this.shadow = undefined;
    this.target = undefined;
  }
}
