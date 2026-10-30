import type { PageControl } from "../page-model";
import { safeName, sanitizeText } from "../privacy-redaction";
import {
  clippedRect,
  type GeometrySnapshot,
} from "../browser-adapter/geometry";
import { PERCEPTION_LIMITS, type DiscoveryPerception } from "./perception";

const headings = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
const boundaries =
  'main,article,nav,header,footer,aside,dialog,form,fieldset,[role="main"],[role="navigation"],[role="banner"],[role="contentinfo"],[role="dialog"],[role="search"],[role="region"],[role="complementary"],[role="toolbar"]';
const perceptionBoundaries =
  boundaries +
  ',section,[role="menu"],[role="listbox"],[role="tree"],[role="grid"],[popover]';
function parent(element: Element): Element | null {
  return (
    element.parentElement ||
    (element.getRootNode() instanceof ShadowRoot
      ? (element.getRootNode() as ShadowRoot).host
      : null)
  );
}
function level(element: Element) {
  return Math.min(
    6,
    Math.max(
      1,
      Number(element.getAttribute("aria-level") || element.tagName.slice(1)) ||
        2,
    ),
  );
}
function regionName(element: Element) {
  if (
    element.hasAttribute("aria-label") ||
    element.hasAttribute("aria-labelledby")
  )
    return safeName(element);
  const heading = [...element.children].find((e) =>
    e.matches(headings + ",legend"),
  );
  return heading ? safeName(heading) : "";
}
function regionRole(element: Element) {
  return (
    element.getAttribute("role") ||
    (element.hasAttribute("popover") ? "popover" : "") ||
    (
      {
        nav: "navigation",
        header: "banner",
        footer: "contentinfo",
        aside: "complementary",
        article: "article",
        fieldset: "group",
      } as Record<string, string>
    )[element.localName] ||
    element.localName
  );
}

// Build one outline per structural boundary. Article headings must not lend
// their purpose to an unrelated toolbar, footer, form, or detached dialog.
export class StructureIndex {
  private regions = new Map<Element, { role: string; name: string }>();
  private childHeadings = new Map<Element, Element[]>();
  private outlines = new Map<
    Element | Document | ShadowRoot,
    {
      element: Element;
      path: NonNullable<PageControl["structure"]>["headings"];
    }[]
  >();
  private perceptionRegions = new Map<
    Element,
    Omit<DiscoveryPerception["regions"][number], "id" | "parentId"> | undefined
  >();
  constructor(
    roots: (Document | ShadowRoot)[],
    indexedHeadings?: HTMLElement[],
  ) {
    for (const root of roots) {
      const stacks = new Map<
        Element | Document | ShadowRoot,
        NonNullable<PageControl["structure"]>["headings"]
      >();
      const available = indexedHeadings
        ? indexedHeadings
            .filter((heading) => heading.getRootNode() === root)
            .sort((a, b) =>
              a === b
                ? 0
                : a.compareDocumentPosition(b) &
                    Node.DOCUMENT_POSITION_FOLLOWING
                  ? -1
                  : 1,
            )
        : [...root.querySelectorAll(headings)];
      for (const heading of available) {
        if (
          heading.closest(
            '[contenteditable],[data-sensitive="true"],#internet-navigator-overlay,[data-tholi-ui]',
          )
        )
          continue;
        const label = safeName(heading);
        if (!label) continue;
        const boundary = heading.closest(boundaries) || root;
        const stack = (stacks.get(boundary) || []).filter(
          (h) => h.level < level(heading),
        );
        stack.push({ level: level(heading), label });
        stacks.set(boundary, stack);
        const entries = this.outlines.get(boundary) || [];
        entries.push({ element: heading, path: stack });
        this.outlines.set(boundary, entries);
      }
    }
  }
  /** Current frame-local ancestors. No document-wide scan or editable text. */
  perceptionOf(element: HTMLElement, geometry: GeometrySnapshot) {
    const chain: {
      element: Element;
      region: NonNullable<ReturnType<StructureIndex["describeRegion"]>>;
    }[] = [];
    let ancestor: Element | null = element;
    let depth = 0;
    for (
      ;
      ancestor && depth < PERCEPTION_LIMITS.ancestorWalkDepth;
      ancestor = parent(ancestor), depth++
    ) {
      const region = this.describeRegion(ancestor, geometry);
      if (region) chain.unshift({ element: ancestor, region });
      if (chain.length > PERCEPTION_LIMITS.ancestorDepth) break;
    }
    return { chain, truncated: !!ancestor };
  }
  private describeRegion(element: Element, geometry: GeometrySnapshot) {
    if (this.perceptionRegions.has(element))
      return this.perceptionRegions.get(element);
    const style = geometry.style(element),
      horizontal =
        /^(auto|scroll)$/.test(style.overflowX || style.overflow) &&
        element.scrollWidth > element.clientWidth,
      vertical =
        /^(auto|scroll)$/.test(style.overflowY || style.overflow) &&
        element.scrollHeight > element.clientHeight,
      semantic = element.matches(perceptionBoundaries);
    if (
      (!semantic && !horizontal && !vertical) ||
      element.closest(
        '[contenteditable],[data-sensitive="true"],#internet-navigator-overlay,[data-tholi-ui]',
      )
    ) {
      this.perceptionRegions.set(element, undefined);
      return;
    }
    const box = clippedRect(element, geometry),
      label = regionName(element),
      role = semantic ? regionRole(element) : "scroll-container";
    const region: Omit<
      DiscoveryPerception["regions"][number],
      "id" | "parentId"
    > = {
      role: /^[a-z][a-z0-9-]{0,39}$/.test(role) ? role : "region",
      ...(label ? { label } : {}),
      ...(box
        ? {
            bounds: {
              x: box.left,
              y: box.top,
              width: box.width,
              height: box.height,
            },
          }
        : {}),
      ...((horizontal || vertical) &&
      element.clientWidth > 0 &&
      element.clientHeight > 0
        ? {
            scroll: {
              horizontal,
              vertical,
              left: element.scrollLeft,
              top: element.scrollTop,
              clientWidth: element.clientWidth,
              clientHeight: element.clientHeight,
              scrollWidth: element.scrollWidth,
              scrollHeight: element.scrollHeight,
            },
          }
        : {}),
    };
    this.perceptionRegions.set(element, region);
    return region;
  }
  of(element: HTMLElement): NonNullable<PageControl["structure"]> {
    const root = element.getRootNode() as Document | ShadowRoot;
    const boundary = element.closest(boundaries) || root;
    const entries = this.outlines.get(boundary) || [];
    const entry = [...entries]
      .reverse()
      .find(
        (h) =>
          h.element === element ||
          !!(
            h.element.compareDocumentPosition(element) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ),
      );
    const path = [...(entry?.path || [])];
    const regions: NonNullable<PageControl["structure"]>["regions"] = [];
    for (
      let ancestor: Element | null = element, depth = 0;
      ancestor && depth < 16;
      ancestor = parent(ancestor), depth++
    ) {
      if (ancestor.matches(boundaries)) {
        let region = this.regions.get(ancestor);
        if (!region) {
          region = {
            role: sanitizeText(regionRole(ancestor)).slice(0, 40),
            name: regionName(ancestor),
          };
          this.regions.set(ancestor, region);
        }
        regions.unshift(region);
      }
      // Nested navigation still belongs to its enclosing section. Its heading
      // is evidence only when it precedes the control in that section.
      if (ancestor.matches("section,main,article,[role=main]")) {
        let children = this.childHeadings.get(ancestor);
        if (!children) {
          children = [...ancestor.children].filter((e) => e.matches(headings));
          this.childHeadings.set(ancestor, children);
        }
        const heading = children.find(
          (e) =>
            e.matches(headings) &&
            (ancestor.matches("section") || level(e) === 1) &&
            !!(
              e.compareDocumentPosition(element) &
              Node.DOCUMENT_POSITION_FOLLOWING
            ),
        );
        if (heading) {
          const label = safeName(heading);
          if (
            label &&
            !path.some((h) => h.label === label && h.level === level(heading))
          )
            path.unshift({ level: level(heading), label });
        }
      }
    }
    return { regions: regions.slice(-4), headings: path.slice(-6) };
  }
}
