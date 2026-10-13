import { z } from "zod";
import {
  journeySchema,
  type PageSnapshot,
  type TaskJourney,
  type GoalPlan,
} from "../page-model";
import { requestSchema, type NavigationRequest } from "./contracts";
import { ledgerEntrySchema } from "./navigation-actions";
export { ledgerEntrySchema } from "./navigation-actions";
export const suspendedJourneySchema = z
  .object({
    id: z.string().uuid(),
    journey: journeySchema,
    request: requestSchema,
    origin: z.string(),
    tabId: z.number().int(),
    pausedAt: z.number(),
  })
  .strict();
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type SuspendedJourney = z.infer<typeof suspendedJourneySchema>;
export function sameDestination(a: NavigationRequest, b: NavigationRequest) {
  const normalize = (s: string) =>
    s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  const key = (request: NavigationRequest) =>
    JSON.stringify(
      request.tasks.map((t) => [
        t.operation,
        normalize(t.contextTarget || t.target),
        normalize(t.desiredValue || ""),
        t.scope,
        t.qualifiers.map(normalize),
        t.exclusions.map(normalize),
        !!t.negatedOnly,
      ]),
    );
  return key(a) === key(b);
}
export function suspendJourney(
  journey: TaskJourney,
  request: NavigationRequest,
  origin: string,
  tabId: number,
): SuspendedJourney | undefined {
  if (["completed", "canceled"].includes(request.status)) return;
  return suspendedJourneySchema.parse({
    id: journey.id,
    journey: structuredClone(journey),
    request: {
      ...structuredClone(request),
      status: "paused",
      resumeStatus:
        request.status === "blocked"
          ? "blocked"
          : request.status === "clarification"
            ? "clarification"
            : "active",
    },
    origin,
    tabId,
    pausedAt: Date.now(),
  });
}
export function appendLedger(
  ledger: LedgerEntry[],
  page: PageSnapshot,
  tabId: number,
  documentId: string,
  navigationEvent = false,
) {
  const last = ledger.at(-1);
  if (
    last?.state === page.stateKey &&
    last.tabId === tabId &&
    last.documentId === documentId &&
    !navigationEvent
  )
    return ledger;
  const previous = [...ledger].reverse().find((e) => e.tabId === tabId);
  const navigation =
    navigationEvent ||
    !previous ||
    previous.documentId !== documentId ||
    (!!previous.path && previous.path !== page.path);
  return [
    ...ledger,
    {
      id: crypto.randomUUID(),
      tabId,
      documentId,
      origin: page.origin,
      state: page.stateKey,
      at: Date.now(),
      navigation,
      path: page.path,
      previous: navigation ? previous?.id : previous?.previous,
      labels: page.controls
        .filter((c) => c.visible && c.enabled)
        .slice(0, 100)
        .map((c) => c.label),
      surfaces: (page.coverage || []).map((s) => s.surfaceId).slice(0, 100),
    },
  ].slice(-200);
}
const words = (s: string) =>
  (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).map((w) =>
    w.replace(/ies$/, "y").replace(/s$/, ""),
  );
export function returnPlan(
  page: PageSnapshot,
  goal: string,
  ledger: LedgerEntry[],
  tabId: number,
  exclusions: string[] = [],
): GoalPlan | undefined {
  // The nearest observed predecessor is the only browser-Back step we can name.
  const current = [...ledger]
    .reverse()
    .find((e) => e.tabId === tabId && e.state === page.stateKey);
  const previous = ledger.find((e) => e.id === current?.previous);
  const relevant = (entry: LedgerEntry) =>
    entry.origin === page.origin &&
    entry.labels.some((label) => {
      const tokens = words(label);
      return (
        words(goal)
          .filter(
            (w) =>
              ![
                "show",
                "me",
                "how",
                "to",
                "a",
                "the",
                "please",
                "help",
                "find",
                "open",
              ].includes(w),
          )
          .some((w) => tokens.includes(w)) &&
        !exclusions.some((ex) => words(ex).some((w) => tokens.includes(w)))
      );
    });
  let ancestor = previous,
    reachable = false;
  const seen = new Set<string>();
  while (
    ancestor &&
    !seen.has(ancestor.id) &&
    ancestor.origin === page.origin
  ) {
    seen.add(ancestor.id);
    if (relevant(ancestor)) {
      reachable = true;
      break;
    }
    ancestor = ledger.find((e) => e.id === ancestor?.previous);
  }
  if (previous && previous.state !== page.stateKey && reachable)
    return {
      goal,
      status: "guiding",
      source: "memory",
      confidence: 0.8,
      steps: [],
      action: {
        kind: "history-back",
        entryId: previous.id,
        tabId,
        expectedState: previous.state,
      },
      reason:
        "Use browser Back once to return to an observed navigation surface. Your destination is retained; arrival will be checked.",
    };
  const other = [...ledger]
    .reverse()
    .find((e) => e.tabId !== tabId && relevant(e));
  if (other)
    return {
      goal,
      status: "guiding",
      source: "memory",
      confidence: 0.8,
      steps: [],
      action: {
        kind: "tab-switch",
        entryId: other.id,
        tabId: other.tabId,
        expectedState: other.state,
      },
      reason:
        "Return to the associated website tab. Its current page will be checked before guidance continues.",
    };
  const close = page.controls.find(
    (c) =>
      c.visible &&
      c.enabled &&
      c.risk === "ordinary" &&
      /^(close|back|return|cancel)(?:\s+(?:menu|dialog|panel|navigation))?$/i.test(
        c.label,
      ) &&
      (c.structure?.regions.some((r) => /dialog|menu/.test(r.role)) ||
        /dialog|menu|popover/i.test(c.context)) &&
      !exclusions.some((ex) =>
        words(ex).some((w) => words(c.label).includes(w)),
      ),
  );
  if (close)
    return {
      goal,
      status: "guiding",
      source: "semantics",
      confidence: 0.6,
      exploration: true,
      steps: [
        {
          controlId: close.id,
          label: close.label,
          outcome: "The observed surface closes.",
        },
      ],
      action: {
        kind: "close-surface",
        controlId: close.id,
        signature: close.signature,
      },
      reason:
        "Close this observed surface to reveal navigation behind it. Your destination is retained.",
    };
}
