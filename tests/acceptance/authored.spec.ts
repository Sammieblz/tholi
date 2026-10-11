import { test, expect } from "@playwright/test";
import matrix from "./matrix.json" with { type: "json" };
import { demoRoute } from "../../routes/demo/cancellation";
import { RouteEngine } from "../../packages/route-engine";
import { rankTargets } from "../../packages/semantic-locator";
import { sample, attachCase } from "../support/acceptance-runner";
import type { UIState } from "../../packages/shared-types";
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
test("declared authored target and state oracle", async ({}, info) => {
  const errors: string[] = [];
  for (const id of matrix.authoredStates) {
    const result = sample(`${info.project.name}/authored/${id}`, "authored");
    try {
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
      if (next) {
        const located = rankTargets(next.target, ui.landmarks);
        result.targets.push(located.id === "target");
      }
      if (engine.view.stateId)
        result.verifications.push(engine.view.stateId === id);
      if (result.verifications.includes(false)) result.falseSuccess++;
      result.completed =
        engine.view.status === (g.status || "running") &&
        (g.status === "stopped" || engine.view.stateId === id) &&
        result.targets.every(Boolean);
      result.stopped = engine.view.status === "stopped";
      expect(result.completed).toBe(true);
    } catch (error) {
      errors.push(id + ": " + String(error).slice(0, 160));
    } finally {
      await attachCase(info, result);
    }
  }
  expect(errors).toEqual([]);
});
