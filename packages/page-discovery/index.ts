import {
  safeName,
  sanitizeText,
  isSensitiveElement,
} from "../privacy-redaction";
import { visible } from "../browser-adapter";
import { goalScore } from "../goal-planner";
import { hash, type PageControl, type PageSnapshot } from "../page-model";
import { StructureIndex } from "./structure";
import { interactionRisk } from "./interaction-risk";
import { formContext } from "./form-context";
export interface BoundControl {
  control: PageControl;
  element: HTMLElement;
  geometry: HTMLElement;
  destination?: HTMLElement;
}
const candidates =
  'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="menuitem"],h1,h2,h3,h4,h5,h6,[role="heading"]';
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
export function presented(element: HTMLElement): HTMLElement | undefined {
  if (
    !element.isConnected ||
    isSensitiveElement(element) ||
    element.closest('[inert],[contenteditable],[data-sensitive="true"]')
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
      const style = getComputedStyle(label),
        inputStyle = getComputedStyle(element),
        rect = label.getBoundingClientRect();
      if (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        inputStyle.display !== "none" &&
        inputStyle.visibility !== "hidden" &&
        rect.width &&
        rect.height
      )
        return label;
    }
  }
  return visible(element) ? element : undefined;
}
function nameOf(element: HTMLElement) {
  const root = element.getRootNode() as Document | ShadowRoot;
  if (!element.matches("input,select,textarea"))
    return (
      safeName(element) ||
      sanitizeText(
        element.getAttribute("title") ||
          element.querySelector("img")?.getAttribute("alt") ||
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
function contextOf(element: HTMLElement) {
  const root = element.getRootNode() as Document | ShadowRoot;
  const labelBlock = (e: Element) =>
    e.matches(headingSelector) ||
    (e.matches("div,p,span,label") &&
      e.childElementCount <= 2 &&
      !e.querySelector("input,select,textarea,a,button,[contenteditable]") &&
      !!safeName(e) &&
      safeName(e).length <= 60);
  let parent = element.parentElement;
  for (
    let depth = 0;
    parent && depth < 8;
    depth++, parent = parent.parentElement
  ) {
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
    const preceding = [...parent.children]
      .filter(
        (e) =>
          e.matches(headingSelector) &&
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
      const heading = parent.querySelector(headingSelector);
      if (heading) return safeName(heading);
    }
    if (parent.matches("main,article,body")) break;
  }
  return "";
}
function roleOf(e: HTMLElement): string {
  return (
    e.getAttribute("role") ||
    (e.matches("a")
      ? "link"
      : e.matches("h1,h2,h3,h4,h5,h6")
        ? "heading"
        : e.matches("select")
          ? "combobox"
          : e.matches('input[type="radio"]')
            ? "radio"
            : e.matches('input[type="checkbox"]')
              ? "checkbox"
              : e.matches("input,textarea")
                ? "textbox"
                : "button")
  );
}
function scopeOf(element: HTMLElement): PageControl["scope"] {
  // Local heading ownership distinguishes repeated section controls from the
  // page toolbar without relying on a site's class names or IDs.
  let parent: HTMLElement | null = element;
  for (
    let depth = 0;
    parent && depth < 5;
    depth++, parent = parent.parentElement
  ) {
    if (parent.matches("nav,header,[role=navigation]")) return "page";
    if (parent.matches("main,article,body")) break;
    const heading = parent.matches(headingSelector)
      ? parent
      : [...parent.children].find((child) => child.matches(headingSelector));
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
    return e.closest("nav,[role=navigation],header,footer")
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
  snapshot(): PageSnapshot {
    this.bindings.clear();
    const elements: HTMLElement[] = [];
    const popups: HTMLElement[] = [];
    const roots: (Document | ShadowRoot)[] = [];
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
    scan(document);
    const structureIndex = new StructureIndex(roots);
    // Keep interface controls and section structure ahead of dense article link lists.
    const priority = (e: HTMLElement) =>
      e.matches("a[href]")
        ? e.closest("nav,header,footer,[role=navigation]")
          ? 1
          : 3
        : e.matches(headingSelector)
          ? 2
          : 0;
    // Compute geometry once per candidate, rather than repeating style/layout reads
    // inside every sort comparison on a dense article.
    const ranked = elements
      .map((e) => {
        const rank = priority(e);
        const rect =
          rank === 3 && presented(e) ? e.getBoundingClientRect() : undefined;
        return {
          element: e,
          rank,
          inViewport: Number(
            !!rect && rect.top >= 0 && rect.bottom <= innerHeight,
          ),
        };
      })
      .sort(
        (a, b) =>
          a.rank - b.rank || (a.rank === 3 ? b.inViewport - a.inViewport : 0),
      );
    let partial = false;
    const controls: PageControl[] = [];
    const base = new URL(location.href);
    const forms = new Map<HTMLFormElement, PageControl["form"]>();
    for (const { element: e } of ranked) {
      if (controls.length >= 600) {
        partial = true;
        break;
      }
      if (
        e.closest(
          "#internet-navigator-overlay,[contenteditable],[data-sensitive=true]",
        ) ||
        isSensitiveElement(e)
      )
        continue;
      const rawLabel = nameOf(e);
      if (!rawLabel) continue;
      const role = roleOf(e),
        description = descriptionOf(e, rawLabel),
        popup = popupOf(e),
        context = contextOf(e),
        geometry = presented(e);
      let kind: PageControl["kind"] = "action",
        destination: HTMLElement | undefined;
      let link: PageControl["destination"];
      let navigationKey: string | undefined;
      if (e.matches(headingSelector)) {
        kind = "section";
        destination = e;
      } else if (role === "button" && popup) kind = "expand";
      else if (e.matches('input[type="radio"],[role="radio"]')) kind = "choice";
      else if (
        e.matches('input[type="checkbox"],[role="checkbox"],[role="switch"]')
      )
        kind = "toggle";
      else if (e.matches("select")) kind = "select";
      else if (
        e.matches("input,textarea,[role=combobox]") &&
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
      if (e.matches("a[href]") && kind !== "expand") {
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
            destination =
              root.getElementById(decodeURIComponent(url.hash.slice(1))) ||
              undefined;
            if (destination) kind = "section";
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
      const risk = interactionRisk(e, kind, rawLabel, description);
      const structure = structureIndex.of(e);
      const form = formContext(e, forms);
      const scope =
        structure.headings.some((h) => h.level > 1) &&
        e.closest("section nav,section [role=navigation]")
          ? "section"
          : scopeOf(e);
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
          !e.matches(":disabled") && e.getAttribute("aria-disabled") !== "true",
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
            sectionRect.top >= 0 &&
            sectionRect.bottom <= innerHeight &&
            sectionRect.left >= 0 &&
            sectionRect.right <= innerWidth
          : undefined,
        selected: e.hasAttribute("aria-selected")
          ? e.getAttribute("aria-selected") === "true"
          : undefined,
        revealIds: [],
        destination: link,
        navigationKey,
        targetLanguage,
        options,
        form,
        ...risk,
      };
      controls.push(control);
      this.bindings.set(id, {
        control,
        element: e,
        geometry: geometry || e,
        destination,
      });
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
      if (!control.visible || control.kind !== "expand" || !control.popup)
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
    const state = controls
      .map((c) =>
        [
          c.signature,
          c.visible,
          c.enabled,
          c.checked,
          c.expanded,
          c.selected,
          c.options?.map((o) => o.selected).join(","),
        ].join(":"),
      )
      .sort()
      .join("|");
    const fingerprint = hash(state);
    const freshness = hash(state + controls.map((c) => c.id).join("|"));
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
      partial,
    };
  }
}
