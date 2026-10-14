import { customControlSelector, customInteraction } from "./accessibility";
export const controlSelector =
  customControlSelector +
  "," +
  'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"],[role="treeitem"],[role="textbox"],[role="searchbox"],[contenteditable="true"],h1,h2,h3,h4,h5,h6,[role="heading"]';
export const surfaceSelector =
  'dialog,[role="dialog"],[role="menu"],[role="listbox"],[role="tree"],[role="grid"],[popover],nav,header,footer,[role="navigation"],[role="banner"],[role="contentinfo"],main,[role="main"]';

/** DOM-only scheduler. It never clicks, reads input values or retains page text. */
export class IncrementalControlIndex {
  readonly elements = new Set<HTMLElement>();
  readonly roots = new Set<Document | ShadowRoot>();
  readonly dirty = new Set<HTMLElement>();
  complete = false;
  saturated = false;
  slices: number[] = [];
  private walkers: TreeWalker[] = [];
  private queued = new WeakSet<Node>();
  private observers = new Map<Document | ShadowRoot, MutationObserver>();
  private timer?: ReturnType<typeof setTimeout>;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private sweep?: ReturnType<typeof setInterval>;
  private stopped = true;
  private notify = () => {};
  private changed = false;
  private lastFlush = 0;
  private priority?: HTMLElement;
  constructor(public limit = 5000) {}
  setLimit(limit: number) {
    this.limit = Math.max(1, Math.min(5000, limit));
    for (const e of [...this.elements].slice(this.limit))
      this.elements.delete(e);
  }
  start(notify: () => void) {
    if (!this.stopped) return;
    this.stopped = false;
    this.notify = notify;
    this.prune();
    for (const element of this.elements) this.dirty.add(element);
    this.attach(document);
    // Seed structural controls first; the document walk fills the remaining
    // index cooperatively. Headings/footer survive dense link collections.
    for (const selector of [
      'footer a,[role="contentinfo"] a',
      'dialog[open] button,[role="dialog"] button,[role="menu"] [role="menuitem"]',
      "h1,h2,h3",
      "header a,nav a",
      "button,input,select,textarea,summary",
    ]) {
      let count = 0;
      for (const e of document.querySelectorAll<HTMLElement>(selector)) {
        this.add(e);
        if (++count >= 200) break;
      }
    }
    this.enqueue(document.documentElement);
    clearTimeout(this.timer);
    this.timer = undefined;
    this.drain();
    for (const name of ["focusin", "change", "input", "pointerover"] as const)
      document.addEventListener(name, this.event, true);
    for (const name of ["scroll", "resize", "popstate", "hashchange"] as const)
      window.addEventListener(name, this.layout, true);
    // Safety reconciliation is chunked, idle-priority and bounded. This catches
    // an open shadow root attached to an existing host without DOM mutations.
    this.sweep = setInterval(() => {
      if (!this.walkers.length) this.enqueue(document.documentElement);
    }, 30000);
  }
  setPriority(element?: HTMLElement) {
    this.priority = element;
  }
  reconcile() {
    this.enqueue(document.documentElement, true);
    clearTimeout(this.timer);
    this.timer = undefined;
    this.drain();
  }
  acknowledge() {
    this.changed = false;
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
  }
  invalidate(element?: HTMLElement) {
    if (element) this.mark(element);
    else for (const e of this.elements) this.dirty.add(e);
    this.changed = true;
  }
  private add(e: HTMLElement) {
    if (
      (!e.matches(controlSelector + ', [role="slider"]') &&
        !customInteraction(e)) ||
      e.closest("#internet-navigator-overlay,[data-tholi-ui]")
    )
      return;
    if (!this.elements.has(e) && this.elements.size >= this.limit) {
      this.saturated = true;
      const rank = this.priorityRank(e);
      if (!rank) return;
      const candidates = [...this.elements];
      const victim =
        candidates.find(
          (c) => c !== this.priority && this.priorityRank(c) === 0,
        ) ||
        candidates.find(
          (c) => c !== this.priority && this.priorityRank(c) < rank,
        );
      if (!victim) return;
      this.elements.delete(victim);
      this.dirty.delete(victim);
    }
    if (this.elements.has(e)) return;
    this.elements.add(e);
    this.dirty.add(e);
    this.changed = true;
  }
  private priorityRank(e: HTMLElement) {
    if (e === this.priority || e === document.activeElement) return 6;
    const popup = e.closest(
      'dialog[open],[role="dialog"],[role="menu"],[role="listbox"],[popover]:popover-open',
    );
    if (
      popup &&
      !popup.closest('[hidden],[aria-hidden="true"]') &&
      popup.getBoundingClientRect().height > 0
    )
      return 5;
    if (e.closest('footer,header,nav,[role="contentinfo"],[role="navigation"]'))
      return 4;
    if (e.matches('h1,h2,h3,[role="heading"]')) return 3;
    return e.matches('button,input,select,textarea,summary,[role="combobox"]')
      ? 2
      : 0;
  }
  private mark(e: HTMLElement) {
    let current: HTMLElement | null = e;
    for (
      let depth = 0;
      current && depth < 8;
      depth++, current = current.parentElement
    ) {
      if (this.elements.has(current)) this.dirty.add(current);
    }
    if (e.matches('h1,h2,h3,h4,h5,h6,[role="heading"]')) {
      const region = e.closest(surfaceSelector) || e.parentElement;
      if (region)
        for (const c of this.elements)
          if (region.contains(c)) this.dirty.add(c);
    }
    this.changed = true;
  }
  private attach(root: Document | ShadowRoot) {
    if (this.roots.has(root)) return;
    this.roots.add(root);
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        const e =
          r.target instanceof Element
            ? r.target
            : r.target instanceof ShadowRoot
              ? r.target.host
              : r.target.parentElement;
        if (!e || e.closest("#internet-navigator-overlay,[data-tholi-ui]")) continue;
        if (
          r.type === "attributes" &&
          [
            "class",
            "style",
            "hidden",
            "inert",
            "aria-hidden",
            "aria-expanded",
            "aria-busy",
          ].includes(r.attributeName!)
        ) {
          this.mark(e as HTMLElement);
          for (const c of this.elements) if (e.contains(c)) this.dirty.add(c);
        } else this.mark(e as HTMLElement);
        if (
          r.type === "attributes" &&
          e.matches(controlSelector + ', [role="slider"]')
        ) {
          this.add(e as HTMLElement);
          this.dirty.add(e as HTMLElement);
        }
        for (const node of r.addedNodes)
          if (node instanceof Element) this.enqueue(node, true);
        if (r.removedNodes.length) this.prune();
      }
      this.scheduleFlush();
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "role",
        "aria-label",
        "aria-labelledby",
        "aria-describedby",
        "aria-description",
        "aria-controls",
        "aria-owns",
        "aria-expanded",
        "aria-checked",
        "aria-selected",
        "aria-current",
        "aria-valuenow",
        "aria-valuemin",
        "aria-valuemax",
        "aria-disabled",
        "aria-busy",
        "aria-hidden",
        "aria-haspopup",
        "href",
        "title",
        "disabled",
        "hidden",
        "inert",
        "class",
        "style",
        "open",
        "tabindex",
        "contenteditable",
      ],
    });
    this.observers.set(root, observer);
  }
  private enqueue(root: Element, foreground = false) {
    if (this.queued.has(root) || this.stopped) return;
    this.queued.add(root);
    this.complete = false;
    this.add(root as HTMLElement);
    if (root.shadowRoot) {
      this.attach(root.shadowRoot);
      for (const child of root.shadowRoot.children)
        this.enqueue(child, foreground);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    if (foreground) this.walkers.unshift(walker);
    else this.walkers.push(walker);
    this.schedule();
  }
  private schedule() {
    if (!this.timer && !this.stopped)
      this.timer = setTimeout(() => this.drain(), 0);
  }
  private drain() {
    this.timer = undefined;
    const start = performance.now();
    while (this.walkers.length && performance.now() - start < 8) {
      const walker = this.walkers[0],
        node = walker.nextNode() as HTMLElement | null;
      if (!node) {
        this.queued.delete(walker.root);
        this.walkers.shift();
        continue;
      }
      if (node.closest("#internet-navigator-overlay,[data-tholi-ui]")) continue;
      this.add(node);
      if (node.shadowRoot) {
        this.attach(node.shadowRoot);
        for (const child of node.shadowRoot.children) this.enqueue(child);
      }
    }
    this.slices.push(performance.now() - start);
    if (this.slices.length > 1000) this.slices.shift();
    const complete = !this.walkers.length && !this.saturated;
    if (complete !== this.complete) this.changed = true;
    this.complete = complete;
    this.scheduleFlush();
    if (this.walkers.length) this.schedule();
  }
  private prune() {
    for (const e of this.elements)
      if (!e.isConnected) {
        this.elements.delete(e);
        this.dirty.delete(e);
        this.changed = true;
      }
    for (const root of this.roots)
      if (root instanceof ShadowRoot && !root.host.isConnected) {
        this.observers.get(root)?.disconnect();
        this.observers.delete(root);
        this.roots.delete(root);
      }
    if (this.elements.size < this.limit) this.saturated = false;
  }
  private scheduleFlush() {
    if (this.flushTimer || this.stopped || !this.changed) return;
    this.flushTimer = setTimeout(
      () => {
        this.flushTimer = undefined;
        this.changed = false;
        this.lastFlush = performance.now();
        this.notify();
      },
      Math.max(0, Math.min(100, 250 - (performance.now() - this.lastFlush))),
    );
  }
  private event = (event: Event) => {
    const e = event.composedPath().find((n) => n instanceof HTMLElement) as
      HTMLElement | undefined;
    if (e) {
      this.mark(e);
      if (e.shadowRoot) {
        this.attach(e.shadowRoot);
        for (const child of e.shadowRoot.children) this.enqueue(child, true);
      }
      const root = e.getRootNode();
      if (root instanceof ShadowRoot) {
        this.attach(root);
        for (const child of root.children) this.enqueue(child);
      }
      const surface = e.closest(surfaceSelector);
      if (surface) this.enqueue(surface);
    }
    this.scheduleFlush();
  };
  private layout = () => {
    this.changed = true;
    if (this.priority) this.dirty.add(this.priority);
    this.scheduleFlush();
  };
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.flushTimer);
    clearInterval(this.sweep);
    this.timer = this.flushTimer = undefined;
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    this.roots.clear();
    this.walkers = [];
    this.queued = new WeakSet();
    for (const name of ["focusin", "change", "input", "pointerover"] as const)
      document.removeEventListener(name, this.event, true);
    for (const name of ["scroll", "resize", "popstate", "hashchange"] as const)
      window.removeEventListener(name, this.layout, true);
  }
}
