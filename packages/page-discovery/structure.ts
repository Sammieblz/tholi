import type { PageControl } from "../page-model";
import { safeName, sanitizeText } from "../privacy-redaction";

const headings = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
const boundaries =
  'main,article,nav,header,footer,aside,dialog,form,fieldset,[role="main"],[role="navigation"],[role="banner"],[role="contentinfo"],[role="dialog"],[role="search"],[role="region"],[role="complementary"],[role="toolbar"]';
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
  private outlines = new Map<
    Element | Document | ShadowRoot,
    {
      element: Element;
      path: NonNullable<PageControl["structure"]>["headings"];
    }[]
  >();
  constructor(roots: (Document | ShadowRoot)[]) {
    for (const root of roots) {
      const stacks = new Map<
        Element | Document | ShadowRoot,
        NonNullable<PageControl["structure"]>["headings"]
      >();
      for (const heading of root.querySelectorAll(headings)) {
        if (
          heading.closest(
            '[contenteditable],[data-sensitive="true"],#internet-navigator-overlay',
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
        const heading = [...ancestor.children].find(
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
