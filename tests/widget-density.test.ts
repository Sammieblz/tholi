import { describe, expect, it } from "vitest";
import { widgetDensity } from "../packages/ui/widget-density";
import {
  currentFrameAccess,
  currentTaskNotices,
} from "../apps/extension/src/ui/features/journey/current-task-notices";
import { present } from "../packages/ui/presentation";
import type { SessionView } from "../packages/shared-types";

describe("widget density protects input in narrow AND short surfaces", () => {
  it.each([
    [240, 150, "minimal"],
    [300, 250, "compact"],
    [360, 390, "standard"],
    [420, 590, "expanded"],
    [600, 200, "minimal"],
    [250, 800, "minimal"],
    [420, 400, "standard"],
  ] as const)("%s by %s uses %s", (width, height, expected) =>
    expect(widgetDensity(width, height)).toBe(expected),
  );
  it("adds an expansion buffer without delaying removal when content stops fitting", () => {
    expect(widgetDensity(340, 360, "compact")).toBe("compact");
    expect(widgetDensity(352, 372, "compact")).toBe("standard");
    expect(widgetDensity(339, 500, "standard")).toBe("compact");
  });
});
it("only exposes notices belonging to an actionable current task", () => {
  const view = {
    status: "running",
    selectedControlId: "menu",
    verifiedSteps: 0,
    history: [],
    routeId: "navigator.live",
    instruction: "Use Back once",
    goalPlan: { action: { kind: "history-back" } },
  } as unknown as SessionView;
  expect(currentTaskNotices(view, present(view))).toBe(view);
  for (const status of ["stopped", "completed", "paused"] as const) {
    const ended = { ...view, status };
    expect(currentTaskNotices(ended, present(ended))).toBeUndefined();
  }
  expect(
    currentTaskNotices(view, present(view, "Finding route")),
  ).toBeUndefined();
});

function pageExplorationView(): SessionView {
  return {
    status: "running",
    routeId: "navigator.live",
    routeVersion: "1.0.0",
    confidence: 1,
    frameAccess: ["https://ungranted.test"],
    verifiedSteps: 0,
    history: [],
    instruction: "Choose a destination",
  };
}

it("keeps current frame-access recovery available before a goal and during planning", () => {
  const view = pageExplorationView();
  expect(present(view).phase).toBe("idle");
  expect(currentTaskNotices(view, present(view))).toBeUndefined();
  expect(
    currentTaskNotices(view, present(view, "Finding route")),
  ).toBeUndefined();
  expect(currentFrameAccess(view)).toEqual(["https://ungranted.test"]);
  expect(currentFrameAccess({ ...view, frameAccess: [] })).toEqual([]);
  expect(currentFrameAccess(undefined)).toEqual([]);
});

it("does not resurrect frame prompts from paused, stopped or completed sessions", () => {
  const view = pageExplorationView();
  for (const status of [
    "stopped",
    "completed",
    "paused",
    "checkpoint",
  ] as const)
    expect(currentFrameAccess({ ...view, status })).toEqual([]);
  for (const status of ["completed", "canceled", "paused"] as const)
    expect(
      currentFrameAccess({
        ...view,
        request: { status } as SessionView["request"],
      }),
    ).toEqual([]);
});

it("keeps the expected-origin handoff actionable while the worker holds an unfinished task", () => {
  const view: SessionView = {
    ...pageExplorationView(),
    status: "paused",
    continuationOrigin: "http://localhost:5173",
    request: { status: "active" } as SessionView["request"],
  };
  expect(currentTaskNotices(view, present(view))).toBe(view);
  expect(currentFrameAccess(view)).toEqual([]);
  for (const status of ["stopped", "completed", "checkpoint"] as const) {
    const ended = { ...view, status };
    expect(currentTaskNotices(ended, present(ended))).toBeUndefined();
  }
  for (const status of ["paused", "completed", "canceled"] as const) {
    const ended = {
      ...view,
      request: { ...view.request!, status },
    };
    expect(currentTaskNotices(ended, present(ended))).toBeUndefined();
  }
  const paused = { ...view, continuationOrigin: undefined };
  expect(currentTaskNotices(paused, present(paused))).toBeUndefined();
  expect(
    currentTaskNotices(view, present(view, "Finding route")),
  ).toBeUndefined();
});
