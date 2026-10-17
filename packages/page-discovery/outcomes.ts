import { visible } from "../browser-adapter";
import {
  safeName,
  sanitizeText,
  isSensitiveElement,
} from "../privacy-redaction";
import { hash } from "../page-model";
import type { OutcomeEvidence } from "../navigation-core/workflow-contracts";
function boundedText(element: Element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let text = "",
    node: Node | null,
    visited = 0;
  while ((node = walker.nextNode()) && visited++ < 100 && text.length < 300) {
    const parent = node.parentElement;
    if (
      !parent ||
      parent.closest(
        "input,textarea,select,[contenteditable],[role=textbox],[data-sensitive=true],script,style,time,[hidden],[aria-hidden=true]",
      ) ||
      isSensitiveElement(parent)
    )
      continue;
    text += " " + (node.textContent || "").slice(0, 300 - text.length);
  }
  return sanitizeText(
    text
      .replace(/\b\d+\s+(?:seconds?|minutes?|hours?|days?)\s+ago\b/gi, "")
      .replace(/\s+/g, " "),
  );
}
export function discoverOutcomes(
  roots: (Document | ShadowRoot)[],
  revision: number,
): OutcomeEvidence[] {
  const signals: OutcomeEvidence[] = [];
  const add = (e: HTMLElement, subject: string, text = boundedText(e)) => {
    if (
      signals.length >= 30 ||
      !text ||
      !visible(e) ||
      isSensitiveElement(e) ||
      e.closest("#internet-navigator-overlay,[data-tholi-ui]")
    )
      return;
    const links = [...e.querySelectorAll<HTMLAnchorElement>("a[href]")]
      .slice(0, 5)
      .map((a) => {
        try {
          const u = new URL(a.href, location.href);
          return u.origin + u.pathname;
        } catch {
          return "";
        }
      });
    signals.push({
      kind: /\b(failed|failure|error|invalid|denied)\b/i.test(text)
        ? "failure"
        : "status",
      subject: sanitizeText(subject),
      text,
      revision,
      identity: hash([e.id, ...links].join("|")),
    });
  };
  for (const root of roots) {
    // Read bounded receipt text adjacent to a semantic heading, never whole-page prose.
    for (const heading of [
      ...root.querySelectorAll<HTMLElement>(
        "main h1,main h2,[role=main] [role=heading]",
      ),
    ].slice(0, 20)) {
      const subject = safeName(heading),
        sibling = heading.nextElementSibling as HTMLElement | null;
      if (
        sibling?.matches("p") &&
        /membership|subscription|deployment|repository/i.test(subject)
      ) {
        const text = boundedText(sibling);
        if (
          /canceled|cancelled|ends|will end|has ended|cancellation confirmed|deployed|created|no (?:active )?(?:prime )?membership|not (?:an? )?prime member|membership (?:is )?(?:unavailable|inactive)/i.test(
            text,
          )
        )
          add(sibling, subject, text);
      }
    }
    for (const e of root.querySelectorAll<HTMLElement>(
      "[role=status],[role=alert],[aria-live=polite],[aria-live=assertive]",
    )) {
      const region = e.closest(
        "[aria-label],section,main,dialog,[role=dialog]",
      );
      add(
        e,
        region?.getAttribute("aria-label") ||
          region?.querySelector("h1,h2,[role=heading]")?.textContent ||
          "",
      );
      if (signals.length >= 30) return signals;
    }
    for (const dt of root.querySelectorAll<HTMLElement>("dl > dt")) {
      const label = safeName(dt),
        dd = dt.nextElementSibling as HTMLElement | null;
      if (
        !dd?.matches("dd") ||
        /password|passcode|token|secret|card|payment|bank|email/i.test(label)
      )
        continue;
      add(dd, label);
      if (signals.length >= 30) return signals;
    }
    for (const table of root.querySelectorAll<HTMLElement>(
      "table,[role=table]",
    )) {
      const label =
        table.getAttribute("aria-label") ||
        table.querySelector("caption")?.textContent ||
        table.closest("section,main")?.querySelector("h1,h2,[role=heading]")
          ?.textContent ||
        "";
      if (!label || /password|token|secret|card|payment|bank/i.test(label))
        continue;
      for (const row of [
        ...table.querySelectorAll<HTMLElement>("tbody tr,[role=row]"),
      ].slice(0, 30)) {
        add(
          row,
          label +
            " " +
            safeName(
              row.querySelector("[scope=row],[role=rowheader]") ||
                row.firstElementChild ||
                row,
            ),
        );
        if (signals.length >= 30) return signals;
      }
    }
  }
  return signals;
}
