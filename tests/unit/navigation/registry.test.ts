import { describe, it, expect } from "vitest";
import {
  createRegistry,
  routeRegistry,
  previewRoute,
} from "../../../packages/route-registry/index";
import {
  restoreSession,
  validPinnedView,
  sessionLocked,
} from "../../../packages/route-registry/session";
import {
  messageSchema,
  contentMessageSchema,
} from "../../../packages/route-schema/index";
import { demoRoute } from "../../../routes/demo/cancellation";
import { billingRoute } from "../../../routes/demo/billing";
import { RouteEngine } from "../../../packages/route-engine/index";
const pin = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  tabId: 1,
  routeId: demoRoute.id,
  routeVersion: demoRoute.version,
};
describe("bundled route registry", () => {
  it("lists two tasks only on supported origins", () => {
    expect(
      routeRegistry.forOrigin("http://127.0.0.1:5173").map((r) => r.id),
    ).toEqual([demoRoute.id, billingRoute.id]);
    for (const origin of [
      "https://example.com",
      "http://127.0.0.1:5174",
      "http://localhost.evil:5173",
    ])
      expect(routeRegistry.forOrigin(origin)).toEqual([]);
  });
  it("rejects duplicate IDs and invalid route packs", () => {
    expect(() => createRegistry([demoRoute, demoRoute])).toThrow();
    expect(() => createRegistry([{ id: "broken" }])).toThrow();
  });
  it("does not silently substitute a version or mutate registry data", () => {
    expect(routeRegistry.get(demoRoute.id, "missing")).toBeUndefined();
    expect(routeRegistry.get("missing")).toBeUndefined();
    const route = routeRegistry.get(demoRoute.id)!;
    route.title = "modified";
    route.origins.push("https://evil.example");
    expect(routeRegistry.get(demoRoute.id)!.title).toBe(demoRoute.title);
    expect(routeRegistry.forOrigin("https://evil.example")).toEqual([]);
  });
  it("previews only task metadata", () => {
    expect(previewRoute(billingRoute).title).toBe("Find billing details");
    expect(previewRoute(billingRoute)).not.toHaveProperty("states");
  });
  it("requires an explicit route and version on Start", () => {
    expect(messageSchema.safeParse({ type: "START" }).success).toBe(false);
    expect(
      messageSchema.safeParse({
        type: "START",
        routeId: demoRoute.id,
        routeVersion: demoRoute.version,
      }).success,
    ).toBe(true);
    expect(
      contentMessageSchema.safeParse({ type: "BEGIN_SESSION", ...pin }).success,
    ).toBe(false);
  });
});
describe("route-pinned sessions", () => {
  const cancelView = new RouteEngine(demoRoute).view,
    billingView = new RouteEngine(billingRoute).view;
  it("accepts matching updates and rejects route/version substitution", () => {
    expect(validPinnedView(pin, cancelView)).toBeDefined();
    expect(validPinnedView(pin, billingView)).toBeUndefined();
    expect(
      validPinnedView(pin, { ...cancelView, routeVersion: "9.9.9" }),
    ).toBeUndefined();
    expect(
      validPinnedView(pin, { ...cancelView, stateId: "invented" }),
    ).toBeUndefined();
  });
  it("restores only an available pinned version", () => {
    expect(restoreSession({ ...pin, view: cancelView })).toBeDefined();
    expect(restoreSession({ ...pin, routeVersion: "removed" })).toBeUndefined();
    expect(restoreSession({ ...pin, view: billingView })).toBeUndefined();
    expect(restoreSession({ tabId: 1, view: cancelView })).toBeUndefined();
  });
  it("locks active and paused sessions until explicitly stopped", () => {
    for (const status of [
      "running",
      "waiting",
      "paused",
      "checkpoint",
      "rerouting",
    ] as const)
      expect(sessionLocked({ ...pin, view: { ...cancelView, status } })).toBe(
        true,
      );
    for (const status of ["completed", "boundary", "stopped"] as const)
      expect(sessionLocked({ ...pin, view: { ...cancelView, status } })).toBe(
        false,
      );
    expect(sessionLocked(pin)).toBe(true);
  });
  it("completes billing using its own evidence and wording", () => {
    const e = new RouteEngine(billingRoute);
    const state = billingRoute.states.find((s) => s.id === "billing")!;
    e.start({
      platform: "web",
      application: "demo",
      origin: billingRoute.origins[0],
      pathname: "/billing",
      modal: false,
      landmarks: state.landmarks.map((l, i) => ({
        id: String(i),
        role: l.role,
        name: l.names[0],
        context: "Subscription",
        visible: true,
        enabled: true,
      })),
    });
    expect(e.view.status).toBe("completed");
    expect(e.view.routeId).toBe(billingRoute.id);
    expect(e.view.instruction).toContain("You reached Billing");
    expect(e.view.instruction).not.toContain("canceled");
  });
});
