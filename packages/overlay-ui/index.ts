export class GuidanceOverlay {
  private root?: HTMLElement;
  private shadow?: ShadowRoot;
  private target?: HTMLElement;
  private instruction = "";
  private frame = 0;
  private refresh = () => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  };
  show(target: HTMLElement, instruction: string) {
    this.target = target;
    this.instruction = instruction;
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.id = "internet-navigator-overlay";
      this.root.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
      this.shadow = this.root.attachShadow({ mode: "closed" });
      document.documentElement.append(this.root);
      window.addEventListener("scroll", this.refresh, true);
      window.addEventListener("resize", this.refresh);
    }
    this.draw();
  }
  private draw() {
    if (!this.shadow || !this.target?.isConnected) {
      this.clear();
      return;
    }
    const r = this.target.getBoundingClientRect();
    const off =
      r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth;
    const x = Math.max(12, Math.min(r.left, innerWidth - 290));
    const y = Math.max(12, Math.min(r.bottom + 12, innerHeight - 115));
    this.shadow.innerHTML =
      "<style>:host{all:initial}*{box-sizing:border-box}.halo{position:fixed;border:3px solid #35d4aa;border-radius:12px;box-shadow:0 0 0 6px #35d4aa33;pointer-events:none}.tip{position:fixed;width:278px;padding:14px 16px;background:#102b2a;color:#fff;border:1px solid #35d4aa;border-radius:14px;font:14px/1.45 system-ui;box-shadow:0 8px 32px #0004;pointer-events:none}.brand{display:block;color:#78efd0;font-size:10px;font-weight:800;letter-spacing:1.5px;margin-bottom:6px}.cursor{position:fixed;color:#35d4aa;font:28px system-ui;text-shadow:0 0 2px #000;pointer-events:none}.arrow{position:fixed;right:20px;top:45%;background:#102b2a;color:#78efd0;border:1px solid #35d4aa;border-radius:14px;padding:14px;font:18px system-ui;pointer-events:none}@media(prefers-reduced-motion:no-preference){.halo{transition:top .12s,left .12s}}</style>";
    const tip = document.createElement("div");
    tip.className = "tip";
    tip.style.left = x + "px";
    tip.style.top = y + "px";
    const brand = document.createElement("span");
    brand.className = "brand";
    brand.textContent = "INTERNET NAVIGATOR · COACH";
    tip.append(brand, document.createTextNode(this.instruction));
    this.shadow.append(tip);
    if (off) {
      const arrow = document.createElement("div");
      arrow.className = "arrow";
      arrow.textContent =
        r.top > innerHeight
          ? "↓ Scroll down"
          : r.bottom < 0
            ? "↑ Scroll up"
            : r.left > innerWidth
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
      cursor.style.left = r.right + 8 + "px";
      cursor.style.top = r.top - 12 + "px";
      this.shadow.append(halo, cursor);
    }
  }
  clear() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener("scroll", this.refresh, true);
    window.removeEventListener("resize", this.refresh);
    this.root?.remove();
    this.root = undefined;
    this.shadow = undefined;
    this.target = undefined;
  }
}
