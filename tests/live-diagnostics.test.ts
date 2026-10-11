import { it, expect } from "vitest";
import { inspectGoal, planGoal } from "../packages/goal-planner";
import {
  appendVerification,
  liveReport,
  liveReportSchema,
  updateObservation,
} from "../packages/live-diagnostics";
import {
  LIVE_ROUTE_ID,
  LIVE_VERSION,
  type PageControl,
  type PageSnapshot,
} from "../packages/page-model";
import { mergeObservation } from "../packages/site-memory";
function control(
  n: number,
  label: string,
  extra: Partial<PageControl> = {},
): PageControl {
  return {
    id: `w0000000000000000-${n}`,
    signature: "SENTINEL_SIGNATURE_" + n,
    label,
    role: "button",
    kind: "expand",
    context: "",
    group: "",
    visible: true,
    enabled: true,
    inViewport: true,
    revealIds: [],
    risk: "ordinary",
    ...extra,
  };
}
function page(controls: PageControl[]): PageSnapshot {
  return {
    origin: "https://secret.example",
    path: "/SENTINEL_PATH",
    pageKey: "private",
    stateKey: "private:closed",
    templateKey: "private",
    fingerprint: "SENTINEL_STRUCTURE",
    revision: 4,
    layout: "wide",
    language: "en",
    controls,
    partial: false,
  };
}
it("explains language versus unrelated tools without changing the planner decision", () => {
  const p = page([
    control(1, "37 languages", {
      description: "Read this article in another language",
    }),
    control(2, "Tools"),
    control(3, "Change language variant", {
      visible: false,
      revealIds: ["w0000000000000000-2"],
    }),
    control(4, "Languages", { visible: false }),
    control(5, "Languages", { enabled: false }),
  ]);
  const inspected = inspectGoal(p, "Change language");
  expect(inspected.plan).toEqual(planGoal(p, "Change language"));
  expect(inspected.diagnostics.candidates[0].id).toBe(p.controls[0].id);
  expect(
    inspected.diagnostics.candidates.find((c) => c.id === p.controls[3].id)
      ?.reasons,
  ).toContain("hidden-unreachable");
  expect(
    inspected.diagnostics.candidates.find((c) => c.id === p.controls[4].id)
      ?.reasons,
  ).toContain("disabled");
  for (const c of inspected.diagnostics.candidates) {
    const e = c.evidence;
    const replay =
      e.qualified && e.preference && e.requested
        ? Math.max(
            0,
            Math.min(
              1,
              e.weighted / e.requested - e.specificity + e.adjustment,
            ),
          )
        : 0;
    expect(c.score).toBeCloseTo(Math.max(0, replay - (c.visible ? 0 : 0.06)));
  }
});
it("exports bounded evidence without labels, goals, descriptions, paths or forged free text", () => {
  const p = page(
    Array.from({ length: 70 }, (_, i) =>
      control(i + 1, "Help SENTINEL_LABEL", {
        description: "SENTINEL_DESCRIPTION",
        role: "SENTINEL_ROLE",
      }),
    ),
  );
  const diagnostics = updateObservation(p);
  diagnostics.planning = inspectGoal(p, "Help SENTINEL_GOAL").diagnostics;
  for (let i = 0; i < 40; i++)
    Object.assign(
      diagnostics,
      appendVerification(diagnostics, {
        signature: "12345678",
        kind: "focus",
        beforeRevision: 1,
        revision: 2,
        from: "12345678",
        to: "87654321",
        outcome: "verified",
        evidence: "field-focus",
      }),
    );
  const view = {
    routeId: LIVE_ROUTE_ID,
    routeVersion: LIVE_VERSION,
    status: "running" as const,
    instruction: "SENTINEL_INSTRUCTION",
    verifiedSteps: 0,
    confidence: 0,
    history: [],
    page: p,
    liveDiagnostics: diagnostics,
  };
  const report = liveReport(view, "diagnostics");
  expect(JSON.stringify(report)).not.toMatch(
    /SENTINEL|secret\.example|"goal":|"page":/,
  );
  expect(report.diagnostics!.planning!.candidates).toHaveLength(50);
  expect(report.diagnostics!.planning!.truncated).toBe(true);
  expect(report.diagnostics!.events).toHaveLength(30);
  expect(report.diagnostics!.events[0].sequence).toBe(11);
  expect(
    liveReportSchema.safeParse({ ...report, rawHtml: "secret" }).success,
  ).toBe(false);
  const bad = structuredClone(report);
  (bad.diagnostics!.events[0] as any).evidence = "SENTINEL_INJECTION";
  expect(liveReportSchema.safeParse(bad).success).toBe(false);
});
it("records observed route provenance and freshness independently of inferred links", () => {
  const p = page([
    control(1, "Settings", {
      kind: "navigation",
      destination: { origin: pOrigin(), path: "/settings", key: "next" },
    }),
  ]);
  const next = {
    ...p,
    pageKey: "next",
    stateKey: "next:closed",
    controls: [control(2, "Language", { kind: "select" })],
  };
  let memory = mergeObservation(undefined, p);
  memory = mergeObservation(memory, next, {
    from: p.stateKey,
    to: next.stateKey,
    signature: p.controls[0].signature,
    label: "Settings",
  });
  const result = inspectGoal(p, "Language", memory);
  expect(result.plan.source).toBe("memory");
  expect(result.diagnostics.memory!.path).toHaveLength(1);
  expect(result.diagnostics.memory!.path[0].evidence).toBe("observed");
  expect(result.diagnostics.memory!.pageVersion).toBe(1);
  memory.transitions.forEach((t) => (t.evidence = "inferred"));
  expect(inspectGoal(p, "Language", memory).plan.status).toBe("unresolved");
});
function pOrigin() {
  return "https://secret.example";
}
