import { it, expect } from "vitest";
import { rankTargets } from "../../../packages/semantic-locator/index";
import {
  targetSchema,
  sessionViewSchema,
} from "../../../packages/route-schema/index";
import { RouteEngine } from "../../../packages/route-engine/index";
import { demoRoute } from "../../../routes/demo/cancellation";
import { validPinnedView } from "../../../packages/route-registry/session";
const ui = (id: string) => ({
  platform: "web" as const,
  application: "demo",
  origin: demoRoute.origins[0],
  pathname: demoRoute.states.find((s) => s.id === id)!.urlPatterns[0] || "/",
  modal: false,
  landmarks: demoRoute.states
    .find((s) => s.id === id)!
    .landmarks.map((l, i) => ({
      id: "c" + i,
      role: l.role,
      name: l.names[0],
      context: "",
      visible: true,
      enabled: true,
    })),
});
it("explains rejected targets without retaining page names or context", () => {
  const target = targetSchema.parse({
    role: "button",
    names: ["Account"],
    disallowedNearbyText: ["danger"],
  });
  const result = rankTargets(target, [
    {
      id: "c1",
      role: "button",
      name: "private@example.com danger",
      context: "secret",
      visible: true,
      enabled: true,
    },
    {
      id: "c2",
      role: "button",
      name: "Account",
      context: "",
      visible: true,
      enabled: false,
    },
  ]);
  expect(result.id).toBeUndefined();
  expect(result.candidates[0].rejected).toBe(true);
  expect(result.candidates.flatMap((c) => c.reasons)).toContain(
    "contradiction",
  );
  expect(result.candidates.flatMap((c) => c.reasons)).toContain("disabled");
  expect(JSON.stringify(result)).not.toMatch(/private|secret/);
});
it("records expected and observed transitions with validated evidence", () => {
  const engine = new RouteEngine(demoRoute);
  const t = engine.start(ui("home"))!;
  engine.wait(t);
  engine.update(ui("account"));
  expect(engine.view.diagnostics?.transitions[0]).toMatchObject({
    outcome: "verified",
    observed: "account",
    expected: t.to,
  });
  expect(sessionViewSchema.safeParse(engine.view).success).toBe(true);
});
it("rejects arbitrary diagnostic text and foreign route identifiers", () => {
  const e = new RouteEngine(demoRoute);
  e.start(ui("home"));
  const pin = {
    sessionId: "00000000-0000-4000-8000-000000000001",
    tabId: 1,
    routeId: demoRoute.id,
    routeVersion: demoRoute.version,
  };
  expect(validPinnedView(pin, e.view)).toBeDefined();
  const copy = structuredClone(e.view);
  copy.diagnostics!.expected = ["foreign-state"];
  expect(validPinnedView(pin, copy)).toBeUndefined();
  copy.diagnostics!.expected = [];
  copy.diagnostics!.localization!.reason = "page secret";
  expect(sessionViewSchema.safeParse(copy).success).toBe(false);
});
