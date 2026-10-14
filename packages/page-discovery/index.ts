import {
  safeName,
  sanitizeText,
  isSensitiveElement,
} from "../privacy-redaction";
import { visible } from "../browser-adapter";
import {
  clippedRect,
  GeometrySnapshot,
  fullyUnclipped,
} from "../browser-adapter/geometry";
import { goalScore } from "../goal-planner";
import { hash, type PageControl, type PageSnapshot } from "../page-model";
import { StructureIndex } from "./structure";
import { interactionRisk } from "./interaction-risk";
import { formContext } from "./form-context";
import {
  IncrementalControlIndex,
  controlSelector,
  surfaceSelector,
} from "./incremental";
import { interfaceVocabulary } from "../navigation-core/guides";
import { discoverOutcomes } from "./outcomes";
import { discoverScreen } from "./screen-state";
import {
  accessibleName,
  accessibleRole,
  customInteraction,
} from "./accessibility";
export interface BoundControl {
  control: PageControl;
  element: HTMLElement;
  geometry: HTMLElement;
  destination?: HTMLElement;
}
const candidates = controlSelector + ',[role="slider"]';
const headingSelector = 'h1,h2,h3,h4,h5,h6,[role="heading"],legend';
export function publicPath(url: URL): string {
  return url.pathname
    .split("/")
    .map((part) => {
      try {
        return sanitizeText(decodeURIComponent(part)).replace(
          /\b\d{6,}\b/g,
          "[redacted]",
        );
      } catch {
        return "[invalid]";
      }
    })
    .join("/")
    .slice(0, 500);
}
export function presented(
  element: HTMLElement,
  geometry = new GeometrySnapshot(),
): HTMLElement | undefined {
  if (
    !element.isConnected ||
    isSensitiveElement(element) ||
    element.closest('[inert],[data-sensitive="true"]') ||
    element.parentElement?.closest("[contenteditable]")
  )
    return;
  const closed = element.closest("details:not([open])");
  if (closed && !closed.querySelector(":scope > summary")?.contains(element))
    return;
  if (element.matches('input[type="checkbox"],input[type="radio"]')) {
    const label = (element as HTMLInputElement).labels?.[0];
    if (
      label &&
      !element.closest('[hidden],[aria-hidden="true"]') &&
      !label.closest("[hidden],[inert]")
    ) {
      const style = geometry.style(label),
        inputStyle = geometry.style(element),
        rect = geometry.rect(label);
      if (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        inputStyle.display !== "none" &&
        inputStyle.visibility !== "hidden" &&
        rect.width &&
        rect.height &&
        clippedRect(label, geometry)
      )
        return label;
    }
  }
  if (visible(element, geometry)) return element;
  if (element.closest('[hidden],[aria-hidden="true"],[inert]')) return;
  const r = geometry.rect(element);
  if (!r.width || !r.height) return;
  let scrollable = false;
  for (
    let parent: HTMLElement | null = element;
    parent;
    parent =
      parent.parentElement ||
      ((parent.getRootNode() as ShadowRoot).host as HTMLElement) ||
      null
  ) {
    const style = geometry.style(parent);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    )
      return;
    if (
      parent !== element &&
      /auto|scroll/.test(style.overflow + style.overflowX + style.overflowY) &&
      (parent.scrollHeight > parent.clientHeight ||
        parent.scrollWidth > parent.clientWidth)
    )
      scrollable = true;
  }
  return scrollable ? element : undefined;
}
function nameOf(element: HTMLElement) {
  const root = element.getRootNode() as Document | ShadowRoot;
  if (
    !element.matches(
      "input,select,textarea,[contenteditable],[role=textbox],[role=searchbox]",
    )
  )
    return (
      accessibleName(element) ||
      sanitizeText(
        element.getAttribute("title") ||
          element.querySelector("img")?.getAttribute("alt") ||
          element.querySelector("svg title")?.textContent ||
          "",
      )
    );
  const refs = element
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .map((id) => root.getElementById(id))
    .filter((e): e is HTMLElement => !!e);
  const labels = (element as HTMLInputElement).labels;
  return sanitizeText(
    refs?.map(safeName).join(" ") ||
      element.getAttribute("aria-label") ||
      (element.matches(
        'input[type="submit"],input[type="button"],input[type="reset"]',
      )
        ? element.getAttribute("value")
        : "") ||
      (labels ? [...labels].map(safeName).join(" ") : "") ||
      element.getAttribute("placeholder") ||
      element.getAttribute("title") ||
      (element.matches('input[type="search"]') ? "Search" : ""),
  );
}
function descriptionOf(element: HTMLElement, label: string) {
  const root = element.getRootNode() as Document | ShadowRoot;
  const referenced = element
    .getAttribute("aria-describedby")
    ?.split(/\s+/)
    .map((id) => root.getElementById(id))
    .filter(
      (e): e is HTMLElement =>
        !!e &&
        !e.matches(
          "input,select,textarea,option,[contenteditable],[role=textbox],[role=combobox]",
        ),
    )
    .map(safeName)
    .join(" ");
  const description = sanitizeText(
    referenced ||
      element.getAttribute("aria-description") ||
      element.getAttribute("title") ||
      "",
  );
  return description !== label ? description : "";
}
function popupOf(element: HTMLElement): PageControl["popup"] {
  const value = element.getAttribute("aria-haspopup");
  if (value === "true") return "menu";
  if (value && ["menu", "listbox", "tree", "grid", "dialog"].includes(value))
    return value as PageControl["popup"];
}
function contextOf(
  element: HTMLElement,
  headingChildren = new Map<HTMLElement, Element[]>(),
  firstHeadings = new Map<HTMLElement, HTMLElement | undefined>(),
) {
  const root = element.getRootNode() as Document | ShadowRoot;
  const labelBlock = (e: Element) =>
    e.matches(headingSelector) ||
    (e.matches("div,p,span,label") &&
      e.childElementCount <= 2 &&
      !e.querySelector("input,select,textarea,a,button,[contenteditable]") &&
      !!safeName(e) &&
      safeName(e).length <= 60);
  let parent = element.parentElement;
  const firstHeading = (parent: HTMLElement) => {
    if (!firstHeadings.has(parent))
      firstHeadings.set(
        parent,
        parent.querySelector<HTMLElement>(headingSelector) || undefined,
      );
    return firstHeadings.get(parent);
  };
  for (
    let depth = 0;
    parent && depth < 8;
    depth++, parent = parent.parentElement
  ) {
    if (parent.matches("footer,[role=contentinfo]")) {
      const heading = firstHeading(parent);
      return heading ? safeName(heading) : "Footer";
    }
    if (parent.matches("details") && !element.matches("summary")) {
      const summary = parent.querySelector<HTMLElement>(":scope > summary");
      if (summary && safeName(summary)) return safeName(summary);
    }
    const aria = parent.getAttribute("aria-label");
    if (aria) return sanitizeText(aria);
    const referenced = parent
      .getAttribute("aria-labelledby")
      ?.split(/\s+/)
      .map((id) => root.getElementById(id))
      .filter((e): e is HTMLElement => !!e)
      .map(safeName)
      .join(" ");
    if (referenced) return referenced;
    let headings = headingChildren.get(parent);
    if (!headings)
      headingChildren.set(
        parent,
        (headings = [...parent.children].filter((e) =>
          e.matches(headingSelector),
        )),
      );
    const preceding = headings
      .filter(
        (e) =>
          !!(
            e.compareDocumentPosition(element) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ),
      )
      .at(-1);
    if (preceding) return safeName(preceding);
    if (element.matches('input[type="radio"],select,[role="radio"]')) {
      const previous = parent.previousElementSibling;
      if (previous && labelBlock(previous)) return safeName(previous);
      const block = [...parent.children]
        .filter(
          (e) =>
            labelBlock(e) &&
            !!(
              e.compareDocumentPosition(element) &
              Node.DOCUMENT_POSITION_FOLLOWING
            ),
        )
        .at(-1);
      if (block) return safeName(block);
    }
    if (
      parent.matches(
        "nav,[role=navigation],form,[role=search],fieldset,dialog,[role=dialog]",
      )
    ) {
      const heading = firstHeading(parent);
      if (heading) return safeName(heading);
    }
    if (parent.matches("main,article,body")) break;
  }
  return "";
}
const roleOf = accessibleRole;
function scopeOf(
  element: HTMLElement,
  childHeadings = new Map<Element, Element | undefined>(),
): PageControl["scope"] {
  // Local heading ownership distinguishes repeated section controls from the
  // page toolbar without relying on a site's class names or IDs.
  let parent: HTMLElement | null = element;
  for (
    let depth = 0;
    parent && depth < 5;
    depth++, parent = parent.parentElement
  ) {
    if (
      parent.matches(
        "nav,header,footer,[role=navigation],[role=banner],[role=contentinfo]",
      )
    )
      return "page";
    if (parent.matches("main,article,body")) break;
    if (!childHeadings.has(parent))
      childHeadings.set(
        parent,
        [...parent.children].find((child) => child.matches(headingSelector)),
      );
    const heading = parent.matches(headingSelector)
      ? parent
      : childHeadings.get(parent);
    if (heading) {
      if (heading.matches("legend")) return;
      return heading.matches("h1,[role=heading][aria-level='1']")
        ? "page"
        : "section";
    }
  }
}
function groupOf(e: HTMLElement, kind: PageControl["kind"], context: string) {
  if (
    kind === "focus" &&
    /search/i.test(nameOf(e) + " " + context + " " + e.getAttribute("type"))
  )
    return "Search";
  if (kind === "choice" || kind === "select") return context || "Preferences";
  if (kind === "toggle" || kind === "expand") return "Menus";
  if (kind === "section")
    return e.matches(headingSelector) ? "Page sections" : context || "Contents";
  if (kind === "focus") return context || "Form fields";
  if (kind === "navigation")
    return e.closest(
      "nav,[role=navigation],header,footer,[role=banner],[role=contentinfo]",
    )
      ? context || "Navigation"
      : "Page links";
  return context || "Page controls";
}
export class PageDiscovery {
  bindings = new Map<string, BoundControl>();
  private ids = new WeakMap<HTMLElement, string>();
  private nonce =
    "w" +
    Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
  private counter = 0;
  private revision = 0;
  private last = "";
  private incremental?: IncrementalControlIndex;
  private semanticCache = new Map<HTMLElement, BoundControl>();
  private query = "";
  private surfaceIds = new WeakMap<Element, string>();
  private surfaceCounter = 0;
  private surfaceId(e: HTMLElement) {
    const surface = e.closest(surfaceSelector) || document.body;
    let id = this.surfaceIds.get(surface);
    if (!id)
      this.surfaceIds.set(surface, (id = "surface-" + ++this.surfaceCounter));
    return id;
  }
  observe(callback: () => void) {
    this.incremental ||= new IncrementalControlIndex();
    this.incremental.start(callback);
    return () => this.incremental?.stop();
  }
  setQuery(query: string) {
    if (query !== this.query) {
      this.query = query;
      this.incremental?.reconcile();
    }
  }
  setLimit(limit: number) {
    this.incremental ||= new IncrementalControlIndex(limit);
    this.incremental.setLimit(limit);
  }
  setPriority(element?: HTMLElement) {
    this.incremental?.setPriority(element);
  }
  invalidate() {
    this.incremental?.invalidate();
  }
  snapshot(): PageSnapshot {
    this.bindings.clear();
    const elements: HTMLElement[] = [];
    const popups: HTMLElement[] = [];
    const roots: (Document | ShadowRoot)[] = [];
    const geometrySnapshot = new GeometrySnapshot();
    const headingChildren = new Map<HTMLElement, Element[]>();
    const firstHeadings = new Map<HTMLElement, HTMLElement | undefined>();
    const scopeHeadings = new Map<Element, Element | undefined>();
    const scan = (root: Document | ShadowRoot) => {
      roots.push(root);
      elements.push(...root.querySelectorAll<HTMLElement>(candidates));
      popups.push(
        ...root.querySelectorAll<HTMLElement>(
          '[role="dialog"],[role="menu"],[role="listbox"],[role="tree"],[role="grid"],[popover]',
        ),
      );
      for (const node of root.querySelectorAll("*"))
        if (node.shadowRoot) scan(node.shadowRoot);
    };
    if (this.incremental) {
      elements.push(...this.incremental.elements);
      roots.push(...this.incremental.roots);
      for (const root of roots)
        popups.push(
          ...root.querySelectorAll<HTMLElement>(
            'dialog,[role="dialog"],[role="menu"],[role="listbox"],[role="tree"],[role="grid"],[popover]',
          ),
        );
      for (const e of this.semanticCache.keys())
        if (!e.isConnected || !this.incremental.elements.has(e))
          this.semanticCache.delete(e);
    } else scan(document);
    const structureIndex = new StructureIndex(roots);
    const activeModal = popups
      .filter(
        (p) =>
          p.matches('dialog[open],[role="dialog"][aria-modal="true"]') &&
          presented(p),
      )
      .at(-1);
    // Reserve coverage for structure and global landmarks. Large related-link
    // navigation widgets cannot consume the entire scan before headings/footer.
    const priority = (e: HTMLElement) =>
      e.matches("a[href]")
        ? e.closest("footer,[role=contentinfo]")
          ? 2
          : e.closest("nav,header,[role=navigation],[role=banner]")
            ? e.closest("main,article,[role=main]")
              ? 4
              : 3
            : 5
        : e.matches(headingSelector)
          ? 1
          : 0;
    // Compute geometry once per candidate, rather than repeating style/layout reads
    // inside every sort comparison on a dense article.
    const queryWords =
      this.query
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu)
        ?.filter((w) => w.length > 2) || [];
    const ranked = elements
      .map((e) => {
        const rank = priority(e);
        const geometry = this.incremental
          ? undefined
          : presented(e, geometrySnapshot);
        const rect = this.incremental
          ? e.getBoundingClientRect()
          : geometry
            ? clippedRect(geometry, geometrySnapshot)
            : undefined;
        const name =
          this.semanticCache.get(e)?.control.label ||
          e.getAttribute("aria-label") ||
          e.getAttribute("title") ||
          (queryWords.length ? nameOf(e) : "");
        const relevant = queryWords.filter((w) =>
          name.toLowerCase().includes(w),
        ).length;
        return {
          element: e,
          rank,
          geometry,
          relevant,
          surface: this.incremental
            ? Number(
                !!rect?.width &&
                  !!rect.height &&
                  !!e.closest(
                    'dialog[open],[role="dialog"],[role="menu"],[role="listbox"],[popover]:popover-open',
                  ) &&
                  !e.closest('[hidden],[aria-hidden="true"]'),
              )
            : 0,
          inViewport: Number(
            !!rect?.width &&
              !!rect.height &&
              rect.top >= 0 &&
              rect.bottom <= innerHeight,
          ),
        };
      })
      .sort(
        (a, b) =>
          b.surface - a.surface ||
          b.relevant - a.relevant ||
          a.rank - b.rank ||
          b.inViewport - a.inViewport,
      );
    const budgets = [240, 100, 60, 100, 60, 40];
    const reserved = ranked.filter(
      (candidate) => budgets[candidate.rank]-- > 0,
    );
    const protectedElements = new Set(reserved.map((c) => c.element));
    const ordered = [
      ...reserved,
      ...ranked.filter((c) => !protectedElements.has(c.element)),
    ];
    let partial = false;
    const controls: PageControl[] = [];
    const base = new URL(location.href);
    const forms = new Map<HTMLFormElement, PageControl["form"]>();
    for (const { element: e, geometry: initialGeometry } of ordered) {
      if (controls.length >= 600) {
        partial = true;
        break;
      }
      if (
        e.closest("#internet-navigator-overlay,[data-sensitive=true]") ||
        isSensitiveElement(e)
      )
        continue;
      if (e.parentElement?.closest("[contenteditable]")) continue;
      const geometry = initialGeometry || presented(e, geometrySnapshot);
      let cached =
        this.incremental && !this.incremental.dirty.has(e)
          ? this.semanticCache.get(e)
          : undefined;
      if (cached?.destination && !cached.destination.isConnected)
        cached = undefined;
      if (cached) {
        const control = { ...cached.control, revealIds: [] as string[] };
        if (
          e instanceof HTMLInputElement &&
          e.matches("input[type=checkbox],input[type=radio]")
        )
          control.checked = e.checked;
        else if (e.hasAttribute("aria-checked"))
          control.checked = e.getAttribute("aria-checked") === "true";
        if (e.hasAttribute("aria-selected"))
          control.selected = e.getAttribute("aria-selected") === "true";
        else if (e.hasAttribute("aria-current"))
          control.selected = e.getAttribute("aria-current") !== "false";
        if (e.hasAttribute("aria-expanded"))
          control.expanded = e.getAttribute("aria-expanded") === "true";
        else if (
          control.kind === "expand" &&
          e instanceof HTMLInputElement &&
          e.type === "checkbox"
        )
          control.expanded = e.checked;
        else if (e.matches("summary"))
          control.expanded = e.parentElement?.hasAttribute("open");
        if (e instanceof HTMLSelectElement)
          control.options = control.options?.map((o, i) => ({
            ...o,
            selected: !!e.options[i]?.selected,
            enabled: !!e.options[i] && !e.options[i].disabled,
          }));
        const r = (geometry || e).getBoundingClientRect();
        control.visible = !!geometry;
        control.enabled =
          !e.matches(":disabled") &&
          e.getAttribute("aria-disabled") !== "true" &&
          cached.control.enabled;
        control.inViewport =
          !!geometry &&
          r.top >= 0 &&
          r.bottom <= innerHeight &&
          r.left >= 0 &&
          r.right <= innerWidth;
        control.placement = !geometry
          ? undefined
          : r.bottom <= 0
            ? "above"
            : r.top >= innerHeight
              ? "below"
              : r.right <= 0
                ? "left"
                : r.left >= innerWidth
                  ? "right"
                  : "viewport";
        control.occluded = !!activeModal && !activeModal.contains(e);
        const hitTest = (e.getRootNode() as Document).elementFromPoint?.bind(
          e.getRootNode(),
        );
        const hit =
          geometry &&
          control.inViewport &&
          hitTest?.((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        control.occluded ||=
          !!hit &&
          hit !== e &&
          !e.contains(hit) &&
          !hit.contains(e) &&
          hit !== geometry &&
          !geometry?.contains(hit) &&
          !hit.contains(geometry || e) &&
          !hit.closest("#internet-navigator-overlay");
        if (control.occluded) control.visible = false;
        if (cached.destination) {
          const d = cached.destination.getBoundingClientRect();
          control.sectionVisible =
            !!presented(cached.destination) &&
            fullyUnclipped(cached.destination, geometrySnapshot) &&
            d.top >= 0 &&
            d.bottom <= innerHeight &&
            d.left >= 0 &&
            d.right <= innerWidth;
        }
        controls.push(control);
        this.bindings.set(control.id, {
          ...cached,
          control,
          geometry: geometry || e,
        });
        continue;
      }
      const rawLabel = nameOf(e);
      if (!rawLabel) continue;
      const role = roleOf(e),
        description = descriptionOf(e, rawLabel),
        popup = popupOf(e),
        context = contextOf(e, headingChildren, firstHeadings);
      let kind: PageControl["kind"] = "action",
        destination: HTMLElement | undefined;
      let link: PageControl["destination"];
      let navigationKey: string | undefined;
      let destinationAvailable = true;
      if (e.matches(headingSelector)) {
        kind = "section";
        destination = e;
      } else if (e.matches("input[type=range],[role=slider]")) kind = "range";
      else if (popup) kind = "expand";
      else if (e.matches('[role="treeitem"][aria-expanded]')) kind = "expand";
      else if (
        e.matches(
          'input[type="radio"],[role="radio"],[role="option"],[role="treeitem"],[role="tab"],[role="menuitemradio"]',
        )
      )
        kind = "choice";
      else if (
        e.matches(
          'input[type="checkbox"],[role="checkbox"],[role="switch"],[role="menuitemcheckbox"]',
        )
      )
        kind = "toggle";
      else if (e.matches("select")) kind = "select";
      else if (
        e.matches(
          'input,textarea,[role=combobox],[role=textbox],[role=searchbox],[contenteditable="true"]',
        ) &&
        !e.matches("input[type=submit],input[type=button],input[type=reset]")
      )
        kind = "focus";
      else if (
        e.matches("summary") ||
        e.hasAttribute("aria-expanded") ||
        e.hasAttribute("aria-controls") ||
        e.hasAttribute("popovertarget")
      )
        kind = "expand";
      if (
        e.matches("a[href]") &&
        !["expand", "choice", "toggle"].includes(kind)
      ) {
        try {
          const url = new URL(e.getAttribute("href")!, base);
          if (!["http:", "https:"].includes(url.protocol)) continue;
          const path = publicPath(url);
          navigationKey = hash(url.href);
          link = {
            origin: url.origin,
            path,
            key: hash(url.origin + url.pathname),
          };
          kind = "navigation";
          if (
            url.origin === base.origin &&
            url.pathname === base.pathname &&
            url.search === base.search &&
            url.hash
          ) {
            const root = e.getRootNode() as Document | ShadowRoot;
            const anchor = root.getElementById(
              decodeURIComponent(url.hash.slice(1)),
            );
            // A fragment alone does not establish a section. Resolve it to its
            // real heading/labelled region; broken or unrelated anchors are unusable.
            const heading =
              anchor &&
              (anchor.closest<HTMLElement>(headingSelector) ||
                anchor.querySelector<HTMLElement>(
                  ":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5,:scope > h6,:scope > [role=heading]",
                ) ||
                (anchor.nextElementSibling?.matches(headingSelector)
                  ? (anchor.nextElementSibling as HTMLElement)
                  : undefined));
            const label = rawLabel.replace(/^\d+(?:\.\d+)*\s*/, "");
            const region =
              anchor?.matches("section,[role=region],main,[role=main]") &&
              (anchor.hasAttribute("aria-label") ||
                anchor.hasAttribute("aria-labelledby"))
                ? anchor
                : undefined;
            const target = heading || region;
            const genericLandmark =
              /^(?:\(?top\)?|back to top|(?:jump|skip) to (?:main )?content)$/i.test(
                label,
              );
            destinationAvailable =
              !!target &&
              (genericLandmark ||
                goalScore(label, {
                  label: safeName(target),
                  context: "",
                  kind: "section",
                }) >= 0.6);
            if (destinationAvailable) {
              destination = target;
              kind = "section";
            }
          }
          if (url.hash === "#" || e.getAttribute("href") === "#") {
            destination =
              document.querySelector<HTMLElement>("h1,main") || undefined;
            kind = "section";
          }
        } catch {
          continue;
        }
      }
      if (e.matches("summary")) kind = "expand";
      const checked = e.matches("input[type=checkbox],input[type=radio]")
        ? (e as HTMLInputElement).checked
        : e.hasAttribute("aria-checked")
          ? e.getAttribute("aria-checked") === "true"
          : e.hasAttribute("aria-selected")
            ? e.getAttribute("aria-selected") === "true"
            : undefined;
      const expanded = e.matches("summary")
        ? (e.parentElement as HTMLDetailsElement)?.open
        : e.hasAttribute("aria-expanded")
          ? e.getAttribute("aria-expanded") === "true"
          : kind === "expand" && e.matches('input[type="checkbox"]')
            ? checked
            : undefined;
      let id = this.ids.get(e);
      if (!id) {
        id = this.nonce + "-" + ++this.counter;
        this.ids.set(e, id);
      }
      let label = rawLabel;
      if (kind === "choice" && context)
        label = sanitizeText(context + ": " + label);
      const rect = (geometry || e).getBoundingClientRect();
      const sectionRect = destination?.getBoundingClientRect();
      const sectionHeading =
        destination &&
        (destination.closest<HTMLElement>(headingSelector) ||
          destination.querySelector<HTMLElement>(headingSelector) ||
          destination);
      const sectionKey = sectionHeading
        ? hash(
            sectionHeading.id ||
              sectionHeading.querySelector("[id]")?.id ||
              safeName(sectionHeading) +
                ":" +
                [...document.querySelectorAll(headingSelector)].indexOf(
                  sectionHeading,
                ),
          )
        : undefined;
      const risk =
        customInteraction(e) && role === "generic" && kind === "action"
          ? {
              risk: "consequential" as const,
              riskReason: "unknown-edit-effect" as const,
            }
          : interactionRisk(e, kind, rawLabel, description);
      const structure = structureIndex.of(e);
      const form = formContext(e, forms);
      const scope =
        structure.headings.some((h) => h.level > 1) &&
        e.closest("section nav,section [role=navigation]")
          ? "section"
          : scopeOf(e, scopeHeadings);
      const targetLanguage = e
        .getAttribute("hreflang")
        ?.match(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/)?.[0]
        .slice(0, 20);
      const options =
        e instanceof HTMLSelectElement
          ? [...e.options].slice(0, 100).map((o) => ({
              label: sanitizeText(o.label),
              selected: o.selected,
              enabled:
                !o.disabled &&
                !(
                  o.parentElement instanceof HTMLOptGroupElement &&
                  o.parentElement.disabled
                ),
            }))
          : undefined;
      const range =
        kind === "range"
          ? {
              current:
                e instanceof HTMLInputElement
                  ? e.valueAsNumber
                  : e.hasAttribute("aria-valuenow")
                    ? Number(e.getAttribute("aria-valuenow"))
                    : NaN,
              min: Number(
                e.getAttribute("min") || e.getAttribute("aria-valuemin") || 0,
              ),
              max: Number(
                e.getAttribute("max") || e.getAttribute("aria-valuemax") || 100,
              ),
            }
          : undefined;
      const control: PageControl = {
        id,
        role,
        kind,
        label,
        description,
        context,
        group: groupOf(e, kind, context),
        scope,
        structure,
        signature: hash(
          [
            role,
            kind,
            rawLabel,
            description,
            popup,
            context,
            scope,
            JSON.stringify(structure),
            JSON.stringify(form),
            risk.risk,
            risk.riskReason,
            link?.origin,
            link?.key,
            navigationKey,
            targetLanguage,
            JSON.stringify(
              options?.map(({ label, enabled }) => ({ label, enabled })),
            ),
          ].join("|"),
        ),
        visible: !!geometry,
        enabled:
          destinationAvailable &&
          !e.matches(":disabled") &&
          e.getAttribute("aria-disabled") !== "true",
        inViewport:
          !!geometry &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight &&
          rect.left >= 0 &&
          rect.right <= innerWidth,
        placement: geometry
          ? rect.bottom <= 0
            ? "above"
            : rect.top >= innerHeight
              ? "below"
              : rect.right <= 0
                ? "left"
                : rect.left >= innerWidth
                  ? "right"
                  : "viewport"
          : undefined,
        checked,
        expanded,
        popup,
        sectionKey,
        sectionVisible: sectionRect
          ? !!presented(destination!) &&
            fullyUnclipped(destination!, geometrySnapshot) &&
            sectionRect.top >= 0 &&
            sectionRect.bottom <= innerHeight &&
            sectionRect.left >= 0 &&
            sectionRect.right <= innerWidth
          : undefined,
        selected: e.hasAttribute("aria-selected")
          ? e.getAttribute("aria-selected") === "true"
          : e.hasAttribute("aria-current")
            ? e.getAttribute("aria-current") !== "false"
            : undefined,
        revealIds: [],
        destination: link,
        navigationKey,
        targetLanguage,
        options,
        range:
          range && Object.values(range).every(Number.isFinite)
            ? range
            : undefined,
        form,
        ...risk,
        surfaceId: this.surfaceId(e),
        retention:
          /(^|\.)wikipedia\.org$/.test(base.hostname) ||
          ["localhost", "127.0.0.1"].includes(base.hostname)
            ? "interface"
            : interfaceVocabulary.has(rawLabel.toLowerCase()) &&
                !context &&
                !description
              ? "interface"
              : "session",
      };
      const root = e.getRootNode() as Document | ShadowRoot;
      const hitTest = (root as Document).elementFromPoint?.bind(root);
      const hit =
        geometry &&
        control.inViewport &&
        hitTest?.((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
      control.occluded =
        (!!activeModal && !activeModal.contains(e)) ||
        (!!hit &&
          hit !== e &&
          !e.contains(hit) &&
          !hit.contains(e) &&
          hit !== geometry &&
          !geometry?.contains(hit) &&
          !hit.contains(geometry || e) &&
          !hit.closest("#internet-navigator-overlay"));
      if (control.occluded) control.visible = false;
      controls.push(control);
      this.bindings.set(id, {
        control,
        element: e,
        geometry: geometry || e,
        destination,
      });
      if (this.incremental) this.semanticCache.set(e, this.bindings.get(id)!);
    }
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement)
      active = active.shadowRoot.activeElement;
    const visiblePopups = popups.filter((p) => presented(p));
    // Search landmarks sometimes use a fallback link beside a collapsed search field,
    // without aria-controls. Treat only one ordinary link outside the form and one
    // purpose-matched field in that local landmark as a reveal hypothesis. The coach
    // must observe that exact field becoming visible before counting the step.
    for (const binding of this.bindings.values()) {
      const trigger = binding.control;
      if (
        trigger.kind !== "navigation" ||
        trigger.risk !== "ordinary" ||
        !trigger.visible ||
        binding.element.closest("form")
      )
        continue;
      const region = binding.element.closest('search,[role="search"]');
      if (!region) continue;
      const fields = [...this.bindings.values()].filter(
        (b) =>
          region.contains(b.element) &&
          b.control.kind === "focus" &&
          b.element.matches('input[type="search"],[role="searchbox"]'),
      );
      const links = [...this.bindings.values()].filter(
        (b) =>
          region.contains(b.element) &&
          b.control.visible &&
          b.control.kind === "navigation" &&
          !b.element.closest("form"),
      );
      if (
        fields.length !== 1 ||
        links.length !== 1 ||
        goalScore(trigger.label, fields[0].control) < 0.6
      )
        continue;
      trigger.kind = "expand";
      trigger.group = "Menus";
      trigger.signature = hash(trigger.signature + "|field-reveal");
      trigger.expanded = fields[0].control.visible;
      trigger.destination = undefined;
      trigger.navigationKey = undefined;
      if (!fields[0].control.visible)
        fields[0].control.revealIds = [trigger.id];
    }
    for (const binding of this.bindings.values()) {
      const control = binding.control;
      if (
        !presented(binding.element) ||
        control.kind !== "expand" ||
        !control.popup
      )
        continue;
      const root = binding.element.getRootNode() as Document | ShadowRoot;
      const owns = [
        binding.element.getAttribute("aria-controls"),
        binding.element.getAttribute("aria-owns"),
        binding.element.getAttribute("popovertarget"),
      ]
        .filter(Boolean)
        .join(" ")
        .split(/\s+/);
      const labelIds = [
        binding.element.id,
        ...(binding.element instanceof HTMLInputElement
          ? [...(binding.element.labels || [])].map((l) => l.id)
          : []),
      ].filter(Boolean);
      const matches = visiblePopups.filter((panel) => {
        if (
          owns.some(
            (id) =>
              root.getElementById(id) === panel ||
              root.getElementById(id)?.contains(panel),
          )
        )
          return true;
        if (
          panel.getRootNode() === root &&
          panel
            .getAttribute("aria-labelledby")
            ?.split(/\s+/)
            .some((id) => labelIds.includes(id))
        )
          return true;
        // Detached portals need both purpose and focus/placement evidence. An unrelated
        // dialog appearing elsewhere must not verify a click on this control.
        const heading = panel.querySelector(headingSelector);
        const name =
          panel.hasAttribute("aria-label") ||
          panel.hasAttribute("aria-labelledby")
            ? safeName(panel)
            : heading
              ? safeName(heading)
              : "";
        if (!name) return false;
        const score = goalScore(control.label.replace(/\b\d+\b/g, ""), {
          label: name,
          context: panel.getAttribute("role") || "",
          kind: "expand",
        });
        if (score < 0.6) return false;
        const trigger = binding.geometry.getBoundingClientRect(),
          rect = panel.getBoundingClientRect();
        const verticalGap = Math.max(
          0,
          rect.top - trigger.bottom,
          trigger.top - rect.bottom,
        );
        const horizontalGap = Math.max(
          0,
          rect.left - trigger.right,
          trigger.left - rect.right,
        );
        return (
          panel.contains(active) || (verticalGap <= 32 && horizontalGap <= 32)
        );
      });
      if (matches.length) {
        control.expanded = true;
      }
    }
    const revealers = [...this.bindings.values()].filter(
      (b) => ["expand", "toggle"].includes(b.control.kind) && b.control.visible,
    );
    for (const binding of this.bindings.values()) {
      if (binding.control.revealIds.length) continue;
      const ranked = revealers
        .map((revealer) => {
          if (
            revealer.element.matches("summary") &&
            binding.element !== revealer.element &&
            binding.element.closest("details") ===
              revealer.element.parentElement
          )
            return { id: revealer.control.id, distance: 0 };
          const ids = [
            revealer.element.getAttribute("aria-controls"),
            revealer.element.getAttribute("aria-owns"),
            revealer.element.getAttribute("popovertarget"),
          ]
            .filter(Boolean)
            .join(" ")
            .split(/\s+/)
            .filter(Boolean);
          if (ids.length) {
            const root = revealer.element.getRootNode() as
              Document | ShadowRoot;
            // Declared ownership is stronger than shared ancestry. A neighboring
            // hidden responsive button is not part of this control's popup.
            return ids.some((id) =>
              root.getElementById(id)?.contains(binding.element),
            )
              ? { id: revealer.control.id, distance: 0 }
              : undefined;
          }
          const parent = revealer.element.parentElement;
          // Without an explicit relationship, infer only the local widget. Broad
          // toolbar/header ancestry says nothing about which sibling a menu reveals.
          if (
            !binding.control.visible &&
            parent &&
            !parent.matches("main,article,body") &&
            parent.contains(binding.element) &&
            revealers.filter((other) => parent.contains(other.element))
              .length === 1
          )
            return { id: revealer.control.id, distance: 1 };
          return undefined;
        })
        .filter((r): r is { id: string; distance: number } => !!r)
        .sort((a, b) => a.distance - b.distance);
      const best = ranked[0]?.distance;
      binding.control.revealIds = ranked
        .filter((r) => r.distance === best)
        .slice(0, 10)
        .map((r) => r.id);
    }
    const signals = discoverOutcomes(roots, this.revision);
    const busy = roots.some((root) =>
      [...root.querySelectorAll('[aria-busy="true"]')].some((e) =>
        presented(e as HTMLElement),
      ),
    );
    const screen = discoverScreen(roots, controls, busy, signals);
    const state =
      controls
        .map((c) =>
          [
            c.signature,
            c.visible,
            c.enabled,
            c.checked,
            c.expanded,
            c.selected,
            c.range?.current,
            c.options?.map((o) => o.selected).join(","),
          ].join(":"),
        )
        .sort()
        .join("|") +
      "|" +
      JSON.stringify(signals.map(({ revision, ...s }) => s)) +
      "|busy:" +
      busy +
      "|screen:" +
      screen.kind;
    const fingerprint = hash(state);
    const freshness = hash(
      state +
        controls.map((c) => c.id).join("|") +
        "|coverage:" +
        partial +
        ":" +
        this.incremental?.complete +
        ":" +
        this.incremental?.elements.size,
    );
    if (freshness !== this.last) {
      this.revision++;
      this.last = freshness;
    }
    const path = publicPath(base),
      pageKey = hash(base.origin + base.pathname);
    const layout = innerWidth < 900 ? "compact" : "wide";
    const language = sanitizeText(document.documentElement.lang || "und").slice(
      0,
      20,
    );
    const templateKey = hash(
      [
        base.origin,
        layout,
        language,
        base.pathname.split("/").filter(Boolean)[0] || "/",
      ].join("|"),
    );
    if (this.incremental) {
      this.incremental.dirty.clear();
      this.incremental.acknowledge();
    }
    const surfaces = new Map<
      string,
      { role: string; indexed: number; projected: number; virtualized: boolean }
    >();
    for (const e of elements) {
      const key = this.surfaceId(e),
        surface = e.closest(surfaceSelector);
      const previous = surfaces.get(key) || {
        role:
          surface?.getAttribute("role") ||
          surface?.tagName.toLowerCase() ||
          "page",
        indexed: 0,
        projected: 0,
        virtualized: false,
      };
      previous.indexed++;
      previous.virtualized ||=
        (e.hasAttribute("aria-setsize") &&
          Number(e.getAttribute("aria-setsize")) > 1) ||
        !!surface?.hasAttribute("aria-rowcount");
      surfaces.set(key, previous);
    }
    for (const c of controls) {
      const s = surfaces.get(c.surfaceId || "page");
      if (s) s.projected++;
    }
    return {
      origin: base.origin,
      path,
      pageKey,
      stateKey: pageKey + ":" + fingerprint,
      fingerprint,
      templateKey,
      revision: this.revision,
      layout,
      language,
      controls,
      partial: partial || (!!this.incremental && !this.incremental.complete),
      coverage: [...surfaces].slice(0, 100).map(([surfaceId, s]) => ({
        surfaceId,
        ...s,
        complete:
          s.projected === s.indexed &&
          !s.virtualized &&
          (!this.incremental || this.incremental.complete),
        omitted: Math.max(0, s.indexed - s.projected),
      })),
      signals: signals.map((s) => ({ ...s, revision: this.revision })),
      busy,
      indexedControls: Math.min(5000, elements.length),
      screen,
    };
  }
}
