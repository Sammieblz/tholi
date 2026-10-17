import { it, expect, vi, afterEach } from "vitest";
import { BrowserAdapter } from "../packages/browser-adapter";
import { PageDiscovery } from "../packages/page-discovery";
import { PageCoach } from "../apps/extension/src/page-coach";
import { fixture } from "./nlp/fixtures";
import { interpretRequest } from "../packages/nlp/interpret";
import { beginJourney } from "../packages/goal-planner/task-journey";
import type {
  NavigationRequest,
  PlanResult,
} from "../packages/navigation-core";
import type { PageSnapshot } from "../packages/page-model";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
it("replans from fresh evidence when the scan changes during automatic plan installation", async () => {
  const page = { ...fixture(), controls: [] },
    snapshot = vi
      .spyOn(PageDiscovery.prototype, "snapshot")
      .mockReturnValue(page),
    request = interpretRequest("Open Help"),
    journey = beginJourney(request.original, page.origin),
    coach = new PageCoach(vi.fn());
  journey.requestTaskId = request.tasks[0].id;
  coach.view.request = request;
  coach.view.journey = journey;
  let first = true;
  const planner = vi.fn(
    async (_request: NavigationRequest, observation: PageSnapshot) => {
      if (first) {
        first = false;
        snapshot.mockReturnValue({ ...page, revision: 2 });
      }
      return {
        requestId: request.id,
        documentId: "doc",
        revision: observation.revision,
        status: "plan",
        request,
        canonicalGoal: "Help",
        plan: {
          goal: request.original,
          source: "semantics",
          status: "unresolved",
          issue: "ambiguous",
          confidence: 0,
          reason: `Scan ${observation.revision}`,
          steps: [],
        },
        reason: "Choose a current control",
        activity: {
          embedded: 0,
          cacheHits: 0,
          llmCalls: 0,
          modelRevision: "test",
        },
      } satisfies PlanResult;
    },
  );
  Object.assign(coach, { requestPlanner: planner });
  coach.recheckJourney();
  const initialRevision = coach.view.page!.revision;
  try {
    await vi.waitFor(() => expect(planner).toHaveBeenCalledTimes(2));
    expect(
      planner.mock.calls.map(([, observation]) => observation.revision),
    ).toEqual([initialRevision, initialRevision + 1]);
    expect(coach.view.goalPlan?.reason).toBe(`Scan ${initialRevision + 1}`);
    expect(coach.view.request?.id).toBe(request.id);
    expect(coach.view.verifiedSteps).toBe(0);
  } finally {
    coach.stop();
  }
});
it("resuming a review request clears paused guidance while preserving the boundary", () => {
  const coach = new PageCoach(vi.fn());
  coach.view.goalPlan = {
    goal: "Deploy application",
    status: "unresolved",
    issue: "consequential",
    source: "semantics",
    confidence: 0,
    steps: [],
    reason: "Review the deployment on the website before continuing.",
  };
  coach.pause();
  expect(coach.view.instruction).toContain("paused");
  try {
    coach.resume();
    expect(coach.view.status).toBe("running");
    expect(coach.view.instruction).not.toContain("Navigation paused");
    expect(coach.view.goalPlan.issue).toBe("consequential");
    expect(coach.view.goalPlan.status).not.toBe("completed");
  } finally {
    coach.stop();
  }
});
it("disconnects DOM and open-shadow observers, every event subscription and pending timers", async () => {
  vi.useFakeTimers();
  const host = document.createElement("custom-box");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = "<button>Help</button>";
  const removeWindow = vi.spyOn(window, "removeEventListener"),
    removeDocument = vi.spyOn(document, "removeEventListener"),
    removeShadow = vi.spyOn(shadow, "removeEventListener"),
    disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  const callback = vi.fn();
  const stop = new BrowserAdapter().observe(callback);
  window.dispatchEvent(new Event("scroll"));
  document.body.append(document.createElement("button"));
  await Promise.resolve();
  stop();
  expect(vi.getTimerCount()).toBe(0);
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(removeWindow.mock.calls.map((c) => c[0])).toEqual(
    expect.arrayContaining(["scroll", "resize", "popstate", "hashchange"]),
  );
  expect(removeDocument.mock.calls.map((c) => c[0])).toEqual(
    expect.arrayContaining(["focusin", "change"]),
  );
  expect(removeShadow).toHaveBeenCalledWith("change", expect.any(Function));
  shadow.append(document.createElement("button"));
  window.dispatchEvent(new Event("resize"));
  await Promise.resolve();
  vi.advanceTimersByTime(1200);
  expect(callback).not.toHaveBeenCalled();
});
it("pause and stop cancel pending verification and resume installs observation only once", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  document.body.innerHTML =
    '<input type="search" aria-label="Search catalogue"><button>Help</button>';
  const rect = {
    top: 20,
    bottom: 50,
    left: 20,
    right: 220,
    width: 200,
    height: 30,
    x: 20,
    y: 20,
    toJSON: () => ({}),
  };
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    rect,
  ] as any);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    rect,
  );
  const publish = vi.fn(),
    coach = new PageCoach(publish);
  coach.start();
  const field = coach.view.controls!.find((c) => c.kind === "focus")!;
  coach.guide(field.id);
  document
    .querySelector("input")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(coach.view.status).toBe("waiting");
  coach.pause();
  const paused = publish.mock.calls.length;
  expect(vi.getTimerCount()).toBe(0);
  expect(document.getElementById("internet-navigator-overlay")).toBeNull();
  document.body.append(document.createElement("button"));
  document.dispatchEvent(new Event("change"));
  await Promise.resolve();
  vi.advanceTimersByTime(9000);
  expect(publish).toHaveBeenCalledTimes(paused);
  coach.resume();
  const timers = vi.getTimerCount();
  coach.resume();
  expect(vi.getTimerCount()).toBe(timers);
  expect(timers).toBe(1);
  coach.stop("Origin boundary");
  const stopped = publish.mock.calls.length;
  expect(vi.getTimerCount()).toBe(0);
  window.dispatchEvent(new Event("scroll"));
  await Promise.resolve();
  vi.advanceTimersByTime(9000);
  expect(publish).toHaveBeenCalledTimes(stopped);
  expect(coach.view.status).toBe("stopped");
});
