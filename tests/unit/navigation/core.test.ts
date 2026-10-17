import matrix from "../../browser/acceptance/matrix.json" with { type: "json" };
import { describe, it, expect } from "vitest";
import { demoRoute } from "../../../routes/demo/cancellation";
import { routeSchema } from "../../../packages/route-schema/index";
import { RouteEngine } from "../../../packages/route-engine/index";
import { localize } from "../../../packages/state-localizer/index";
import { rankTargets } from "../../../packages/semantic-locator/index";
import { guidancePolicy } from "../../../packages/safety-policy/index";
import type { UIState } from "../../../packages/shared-types/index";
function ui(id: string): UIState {
  const s = demoRoute.states.find((s) => s.id === id)!;
  return {
    platform: "web",
    application: "demo",
    origin: demoRoute.origins[0],
    pathname: s.urlPatterns[0],
    modal: !!s.modal,
    landmarks: s.landmarks.map((l, i) => ({
      id: "c" + i,
      role: l.role,
      name: l.names[0],
      context: "Subscription",
      visible: true,
      enabled: true,
    })),
  };
}
describe("route contract", () => {
  it("rejects graph references and executable fields", () => {
    expect(
      routeSchema.safeParse({ ...demoRoute, startStates: ["missing"] }).success,
    ).toBe(false);
    expect(
      routeSchema.safeParse({ ...demoRoute, script: "alert(1)" }).success,
    ).toBe(false);
  });
  it("rejects transitions out of the final boundary", () => {
    expect(
      routeSchema.safeParse({
        ...demoRoute,
        transitions: [
          ...demoRoute.transitions,
          { ...demoRoute.transitions[0], id: "unsafe", from: "confirmation" },
        ],
      }).success,
    ).toBe(false);
  });
});
describe("verified engine", () => {
  it("never counts clicks as completed transitions", () => {
    const e = new RouteEngine(demoRoute);
    const t = e.start(ui("home"))!;
    e.wait(t);
    expect(e.view.verifiedSteps).toBe(0);
    e.update(ui("home"));
    expect(e.view.status).toBe("waiting");
    e.update(ui("account"));
    expect(e.view.verifiedSteps).toBe(1);
  });
  it("finishes at a hard stop without claiming subscription cancellation", () => {
    const e = new RouteEngine(demoRoute);
    let next = e.start(ui("home"))!;
    for (const id of [
      "account",
      "billing",
      "plan",
      "retention",
      "confirmation",
    ]) {
      e.wait(next);
      next = e.update(ui(id))!;
    }
    expect(e.view.status).toBe("boundary");
    expect(e.view.verifiedSteps).toBe(5);
    expect(e.update(ui("success"))).toBeUndefined();
    expect(e.view.status).toBe("boundary");
  });
  it("reroutes a known wrong turn without fake progress", () => {
    const e = new RouteEngine(demoRoute);
    e.start(ui("home"));
    const next = e.update(ui("profile"));
    expect(next?.to).toContain("account");
    expect(e.view.status).toBe("rerouting");
    expect(e.view.verifiedSteps).toBe(0);
    e.update(ui("profile"));
    expect(e.view.status).toBe("rerouting");
  });
  it("pauses login and observes again only after explicit resume", () => {
    const e = new RouteEngine(demoRoute);
    e.start(ui("home"));
    e.wait(demoRoute.transitions[0]);
    e.update(ui("login"));
    expect(e.view.status).toBe("checkpoint");
    e.update(ui("account"));
    expect(e.view.stateId).toBe("login");
    e.resume(ui("account"));
    expect(e.view.stateId).toBe("account");
  });
  it("waits for delayed render, then stops on timeout without success evidence", () => {
    const e = new RouteEngine(demoRoute);
    e.start(ui("home"));
    e.wait(demoRoute.transitions[0]);
    const unknown = { ...ui("home"), landmarks: [] };
    e.update(unknown);
    expect(e.view.status).toBe("waiting");
    e.timeout(unknown);
    expect(e.view.status).toBe("stopped");
    expect(e.view.verifiedSteps).toBe(0);
  });
  it("stops on unknown state and unexpected origin", () => {
    const e = new RouteEngine(demoRoute);
    e.start(ui("home"));
    e.update({ ...ui("account"), origin: "https://evil.example" });
    expect(e.view.status).toBe("stopped");
    const u = new RouteEngine(demoRoute);
    u.start({ ...ui("home"), landmarks: [] });
    expect(u.view.status).toBe("stopped");
  });
  it("cannot continue after stop or pause", () => {
    const e = new RouteEngine(demoRoute);
    e.start(ui("home"));
    e.pause();
    expect(e.update(ui("account"))).toBeUndefined();
    e.stop();
    expect(e.update(ui("account"))).toBeUndefined();
  });
  it("only declares success from route-defined visible confirmation", () => {
    const e = new RouteEngine(demoRoute);
    e.start(ui("success"));
    expect(e.view.status).toBe("completed");
    const u = new RouteEngine(demoRoute);
    u.start({ ...ui("success"), landmarks: [] });
    expect(u.view.status).toBe("stopped");
  });
});
describe("semantic confidence gates", () => {
  it("uses modal evidence to distinguish same URL states", () => {
    expect(localize(demoRoute, ui("retention")).stateId).toBe("retention");
    expect(localize(demoRoute, ui("plan")).stateId).toBe("plan");
  });
  it("rejects equal states instead of guessing", () => {
    const route = {
      ...demoRoute,
      states: [demoRoute.states[0], { ...demoRoute.states[0], id: "same" }],
    };
    expect(localize(route, ui("home")).stateId).toBeUndefined();
  });
  it("matches alternate labels while rejecting hidden/disabled duplicates", () => {
    const target = demoRoute.transitions.find(
      (t) => t.id === "manage-plan",
    )!.target;
    const l = {
      id: "good",
      role: "button",
      name: "Manage plan",
      context: "Subscription",
      visible: true,
      enabled: true,
    };
    expect(
      rankTargets(target, [
        l,
        { ...l, id: "hidden", visible: false },
        { ...l, id: "disabled", enabled: false },
      ]).id,
    ).toBe("good");
    expect(
      rankTargets(target, [l, { ...l, id: "duplicate" }]).id,
    ).toBeUndefined();
  });
  it("rejects contradictory destructive context", () => {
    const target = demoRoute.transitions[0].target;
    expect(
      rankTargets(target, [
        {
          id: "bad",
          role: "button",
          name: "Account",
          context: "Delete account",
          visible: true,
          enabled: true,
        },
      ]).id,
    ).toBeUndefined();
  });
  it("never authorizes consequential, high-stakes or unauthorized guidance", () => {
    for (const risk of [
      "consequential",
      "high-stakes",
      "unauthorized",
    ] as const)
      expect(
        guidancePolicy({ ...demoRoute.transitions[0], risk }).allowed,
      ).toBe(false);
  });
});

const golden: Record<
  string,
  {
    path: string;
    heading: string;
    modal?: boolean;
    target?: string;
    status?: string;
  }
> = {
  home: { path: "/", heading: "Your workspace", target: "Account" },
  account: { path: "/account", heading: "Account overview", target: "Billing" },
  billing: {
    path: "/billing",
    heading: "Billing & subscription",
    target: "Manage subscription",
  },
  plan: {
    path: "/plan",
    heading: "Manage your plan",
    target: "Cancel subscription",
  },
  profile: {
    path: "/profile",
    heading: "Profile settings",
    target: "Back to account",
  },
  retention: {
    path: "/plan",
    heading: "Before you go",
    modal: true,
    target: "Continue cancellation",
  },
  login: {
    path: "/login",
    heading: "Sign in to Northstar",
    status: "checkpoint",
  },
  confirmation: {
    path: "/confirm",
    heading: "Confirm cancellation",
    status: "boundary",
  },
  success: {
    path: "/success",
    heading: "Subscription canceled",
    status: "completed",
  },
  unknown: { path: "/", heading: "Unrecognized screen", status: "stopped" },
  conflicting: { path: "/", heading: "Account overview", status: "stopped" },
  ambiguous: { path: "/", heading: "Your workspace", status: "stopped" },
  "origin-change": { path: "/", heading: "Your workspace", status: "stopped" },
};

describe("declared authored state oracle", () => {
  it.each(matrix.authoredStates)(
    "validates %s without a browser or duplicate viewport",
    (id) => {
      const g = golden[id];
      const ui: UIState = {
        platform: "web",
        application: "fixture",
        origin:
          id === "origin-change"
            ? "https://unrelated.example"
            : "http://127.0.0.1:5173",
        pathname: g.path,
        modal: !!g.modal,
        landmarks: [
          {
            id: "heading",
            role: "heading",
            name: g.heading,
            context: "",
            visible: true,
            enabled: true,
          },
          ...(g.target
            ? [
                {
                  id: "target",
                  role: "button",
                  name: g.target,
                  context: "Subscription",
                  visible: true,
                  enabled: true,
                },
              ]
            : []),
        ],
      };
      const route =
        id === "ambiguous"
          ? {
              ...demoRoute,
              states: [
                ...demoRoute.states,
                { ...demoRoute.states[0], id: "duplicate" },
              ],
            }
          : demoRoute;
      const engine = new RouteEngine(route);
      const next = engine.start(ui);
      if (next)
        expect(rankTargets(next.target, ui.landmarks).id).toBe("target");
      expect(engine.view.status).toBe(g.status || "running");
      if (g.status !== "stopped") expect(engine.view.stateId).toBe(id);
    },
  );
});
