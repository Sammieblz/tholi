import { describe, expect, it } from "vitest";
import type { SessionView } from "../../../packages/shared-types/index";
import { present } from "../../../packages/ui/presentation";
import {
  presentRouteProgress,
  routeProgressNodes,
} from "../../../packages/ui/route-progress";

function view(): SessionView {
  return {
    routeId: "navigator.live",
    routeVersion: "1",
    status: "running",
    instruction: "Open Account menu",
    selectedControlId: "account",
    verifiedSteps: 0,
    confidence: 0.95,
    history: [],
    goalPlan: {
      goal: "Account settings",
      source: "semantics",
      status: "guiding",
      confidence: 0.95,
      reason: "Live menu",
      steps: [
        { controlId: "account", label: "Account menu", outcome: "Menu opens" },
      ],
      route: {
        strategy: "fastest",
        clicks: 2,
        minSeconds: 2,
        maxSeconds: 10,
        complete: false,
        basis: "estimated",
        predictions: [{ label: "Account settings", evidence: "predicted" }],
      },
    },
  } as SessionView;
}
describe("route progress stays grounded as the path changes", () => {
  it("shows an open end for discovery, never a percentage or an invented click node", () => {
    const v = view();
    v.goalPlan!.route!.clicks = 50;
    const p = presentRouteProgress(v, present(v))!;
    expect(p.next.map((n) => n.label)).toEqual([
      "Account menu",
      "Account settings",
    ]);
    expect(p.complete).toBe(false);
    expect(routeProgressNodes(p).map((n) => n.state)).toEqual([
      "current",
      "upcoming",
      "more",
      "destination",
    ]);
    expect(p.arrived).toBe(false);
  });
  it("checks only verified history and the actual terminal outcome", () => {
    const v = view();
    v.verifiedSteps = 1;
    let p = presentRouteProgress(v, present(v))!;
    expect(routeProgressNodes(p)[0].state).toBe("verified");
    v.goalPlan!.status = "completed";
    expect(presentRouteProgress(v, present(v))!.arrived).toBe(false);
    v.status = "completed";
    p = presentRouteProgress(v, present(v))!;
    expect(p.arrived).toBe(true);
    expect(p.next).toEqual([]);
    expect(routeProgressNodes(p).map((n) => n.state)).toEqual([
      "verified",
      "destination",
    ]);
  });
  it("does not reuse future steps after Stop, a new query, or unresolved recovery", () => {
    const v = view();
    expect(
      presentRouteProgress(v, present(v, "Finding route")),
    ).toBeUndefined();
    v.status = "stopped";
    expect(presentRouteProgress(v, present(v))).toBeUndefined();
    v.status = "rerouting";
    v.goalPlan!.status = "unresolved";
    expect(presentRouteProgress(v, present(v))!.next).toEqual([]);
  });
  it("uses task-local checkpoint counts rather than all earlier queued tasks", () => {
    const v = view();
    v.verifiedSteps = 99;
    v.journey = {
      id: "journey",
      totalVerified: 72,
      progress: Array.from({ length: 30 }, (_, i) => ({
        label: `Control ${i}`,
      })),
    } as SessionView["journey"];
    const p = presentRouteProgress(v, present(v))!;
    expect(p.verified).toBe(72);
    const nodes = routeProgressNodes(p);
    expect(nodes.length).toBeLessThanOrEqual(7);
    expect(nodes.find((n) => n.state === "current")?.number).toBe(73);
    expect(nodes.find((n) => n.number === 72)?.label).toBe("Control 29");
  });
  it("merges the live-chain forecast overlap but preserves repeated menu labels", () => {
    const v = view();
    v.goalPlan!.steps.push({
      controlId: "settings",
      label: "Account settings",
      outcome: "Settings opens",
    });
    const p = presentRouteProgress(v, present(v))!;
    expect(p.next).toHaveLength(2);
    v.goalPlan!.route!.predictions.push({
      label: "Account settings",
      evidence: "documented",
    });
    expect(presentRouteProgress(v, present(v))!.next).toHaveLength(3);
  });
  it("only shows a finite route when the full forecast is available", () => {
    const v = view();
    v.goalPlan!.route!.complete = true;
    expect(presentRouteProgress(v, present(v))!.complete).toBe(true);
    v.goalPlan!.route!.available = false;
    expect(presentRouteProgress(v, present(v))!.complete).toBe(false);
    v.goalPlan!.route!.available = true;
    v.goalPlan!.route!.clicks = 3;
    expect(presentRouteProgress(v, present(v))!.complete).toBe(false);
  });
});
