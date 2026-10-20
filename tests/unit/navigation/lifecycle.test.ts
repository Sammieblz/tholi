// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { BrowserAdapter } from "../../../packages/browser-adapter/index";
import { PageDiscovery } from "../../../packages/page-discovery/index";
import { PageCoach } from "../../../apps/extension/src/content/page-coach";
import { fixture } from "../../integration/nlp/fixtures";
import { interpretRequest } from "../../../packages/nlp/interpret";
import { beginJourney } from "../../../packages/goal-planner/task-journey";
import type {
  NavigationRequest,
  PlanResult,
} from "../../../packages/navigation-core/index";
import type { PageSnapshot } from "../../../packages/page-model/index";
import { assistanceKind } from "../../../packages/safety-policy/assistance";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
it("foreground planning fences old recovery callbacks and ignores an older lease release", async () => {
  vi.useFakeTimers();
  const page = { ...fixture(), controls: [] };
  vi.spyOn(PageDiscovery.prototype, "snapshot").mockReturnValue(page);
  const request = interpretRequest("Open Help");
  const coach = new PageCoach(vi.fn());
  coach.view.request = request;
  let release: ((result: PlanResult) => void) | undefined;
  const planner = vi.fn(
    () =>
      new Promise<PlanResult>((resolve) => {
        release = resolve;
      }),
  );
  Object.assign(coach, { requestPlanner: planner });
  try {
    coach.recheckJourney();
    expect(planner).toHaveBeenCalledOnce();
    const oldIntent = crypto.randomUUID(),
      currentIntent = crypto.randomUUID();
    coach.getPage("New destination", { id: oldIntent, phase: "begin" });
    coach.getPage("Newest destination", { id: currentIntent, phase: "begin" });
    coach.getPage(undefined, { id: oldIntent, phase: "end" });
    release!({
      requestId: request.id,
      documentId: "doc",
      revision: page.revision,
      status: "pending-indexing",
      request,
      reason: "Checking the old destination",
      activity: {
        embedded: 0,
        cacheHits: 0,
        llmCalls: 0,
        modelRevision: "test",
      },
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(planner).toHaveBeenCalledOnce();
    expect(coach.view.status).toBe("running");
    expect(coach.view.request?.original).toBe(request.original);
    expect(coach.view.verifiedSteps).toBe(0);
    coach.getPage(undefined, { id: currentIntent, phase: "end" });
    expect(planner).toHaveBeenCalledTimes(2);
  } finally {
    coach.stop();
  }
});
it.each(["pause", "stop"] as const)(
  "a foreground planning lease cannot override manual %s",
  async (action) => {
    vi.useFakeTimers();
    vi.spyOn(PageDiscovery.prototype, "snapshot").mockReturnValue({
      ...fixture(),
      controls: [],
    });
    const coach = new PageCoach(vi.fn());
    const request = interpretRequest("Open Help");
    coach.view.request = request;
    const planner = vi.fn();
    Object.assign(coach, { requestPlanner: planner });
    const intent = crypto.randomUUID();
    try {
      coach.getPage("New destination", { id: intent, phase: "begin" });
      coach[action]();
      coach.getPage(undefined, { id: intent, phase: "end" });
      await vi.advanceTimersByTimeAsync(5000);
      expect(coach.view.status).toBe(action === "pause" ? "paused" : "stopped");
      expect(planner).not.toHaveBeenCalled();
      expect(coach.view.verifiedSteps).toBe(0);
    } finally {
      coach.stop();
    }
  },
);
it("assistance opens a fresh reversible menu once and leaves forms and final actions to the user", async () => {
  document.body.innerHTML =
    '<button aria-expanded="false" aria-controls="account-menu">Account menu</button><nav id="account-menu" hidden><a href="/settings">Settings</a></nav>';
  const rect = {
    x: 10,
    y: 10,
    top: 10,
    left: 10,
    right: 210,
    bottom: 50,
    width: 200,
    height: 40,
    toJSON: () => ({}),
  };
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    rect,
  ] as any);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    rect,
  );
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const button = document.querySelector("button")!;
  const clicks = vi.fn(() => {
    button.setAttribute("aria-expanded", "true");
    document.querySelector("nav")!.hidden = false;
  });
  button.addEventListener("click", clicks);
  const coach = new PageCoach(vi.fn());
  coach.start();
  try {
    const page = coach.getPage()!,
      request = interpretRequest("Show account menu");
    coach.goal("Account menu", page.revision);
    coach.view.request = request;
    const target = coach.view.controls!.find(
      (c) => c.label === "Account menu",
    )!;
    expect(
      coach.assistStep(target.id, coach.view.page!.revision - 1, request.id)
        .assisted,
    ).toBe(false);
    expect(clicks).not.toHaveBeenCalled();
    const result = coach.assistStep(
      target.id,
      coach.view.page!.revision,
      request.id,
    );
    expect(result.assisted).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(clicks).toHaveBeenCalledOnce();
    expect(
      coach.assistStep(target.id, coach.view.page!.revision, request.id)
        .assisted,
    ).toBe(false);
    for (const label of [
      "Deploy website",
      "Delete account",
      "Create application",
      "Sign in",
      "Approve access",
    ])
      expect(
        assistanceKind({ ...target, label }, request.tasks[0]),
      ).toBeUndefined();
    const revision = coach.view.page!.revision;
    coach.pause();
    expect(coach.assistStep(target.id, revision, request.id).assisted).toBe(
      false,
    );
  } finally {
    coach.stop();
  }
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
    const retained = coach.installRequest({
      requestId: request.id,
      documentId: "doc",
      revision: initialRevision,
      status: "pending-indexing",
      request,
      reason: "Checking the changing page",
      activity: {
        embedded: 0,
        cacheHits: 0,
        llmCalls: 0,
        modelRevision: "test",
      },
    });
    expect(retained).not.toHaveProperty("error");
    expect(coach.view.request?.id).toBe(request.id);
    expect(coach.view.selectedControlId).toBeUndefined();
    expect(coach.view.goalPlan?.recoveryStage).toBe("retrieval");
    expect(coach.view.verifiedSteps).toBe(0);
  } finally {
    coach.stop();
  }
});
it("coalesces scan churn and bounds recovery across changing fingerprints without losing the destination", async () => {
  vi.useFakeTimers();
  let page = { ...fixture(), controls: [] };
  const snapshot = vi
    .spyOn(PageDiscovery.prototype, "snapshot")
    .mockImplementation(() => page);
  const request = interpretRequest("Cancel my Prime membership");
  const coach = new PageCoach(vi.fn());
  coach.view.request = request;
  let release: (() => void) | undefined;
  const planner = vi.fn(
    async (_request: NavigationRequest, observation: PageSnapshot) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        requestId: request.id,
        documentId: "doc",
        revision: observation.revision,
        status: "pending-indexing",
        request,
        reason: "Checking the changing page",
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
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      for (let mutation = 0; mutation < 10; mutation++) {
        page = {
          ...page,
          revision: page.revision + 1,
          fingerprint: `${attempt}:${mutation}`,
        };
        coach.recheckJourney();
      }
      expect(planner).toHaveBeenCalledTimes(attempt + 1);
      release!();
      await vi.advanceTimersByTimeAsync(1100);
    }
    expect(coach.view.status).toBe("paused");
    expect(coach.view.request?.original).toBe(request.original);
    expect(coach.view.verifiedSteps).toBe(0);
    expect(coach.view.instruction).toContain("avoid slowing");
    await vi.advanceTimersByTimeAsync(30000);
    expect(planner).toHaveBeenCalledTimes(4);
    expect(snapshot).toHaveBeenCalled();
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

it.each([
  "matching",
  "no interaction",
  "unrelated dialog",
  "collapsed",
  "occluded",
  "consequential",
  "other task",
  "desired value",
  "other frame",
])("pending detached picker: %s", async (scenario) => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  const rect = {
    x: 20,
    y: 20,
    top: 20,
    bottom: 50,
    left: 20,
    right: 220,
    width: 200,
    height: 30,
    toJSON: () => ({}),
  };
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    rect,
  ] as any);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    rect,
  );
  document.body.innerHTML =
    '<button aria-haspopup="dialog" aria-expanded="false">Languages</button>';
  const original = PageDiscovery.prototype.snapshot;
  vi.spyOn(PageDiscovery.prototype, "snapshot").mockImplementation(function (
    this: PageDiscovery,
  ) {
    const page = original.call(this);
    if (document.getElementById("picker")) {
      page.partial = true;
      // Model a bounded projection omitting the obscured opener, while its
      // actual DOM node remains connected and its checkbox remains unchanged.
      for (const control of page.controls) {
        if (control.label === "Languages") this.bindings.delete(control.id);
        if (control.role === "combobox") {
          if (scenario === "occluded") control.occluded = true;
          if (scenario === "consequential") control.risk = "consequential";
          if (scenario === "other frame")
            control.reference = { frameId: 2 } as any;
        }
      }
      page.controls = page.controls.filter(
        (control) => control.label !== "Languages",
      );
    }
    return page;
  });
  const coach = new PageCoach(vi.fn());
  coach.start();
  const reply = coach.goal("Change language", coach.view.page!.revision);
  expect(reply).not.toHaveProperty("error");
  expect(coach.view.goalPlan?.status).toBe("guiding");
  const request = interpretRequest("Change language");
  coach.view.request = request;
  coach.view.journey!.requestTaskId =
    scenario === "other task" ? "old-task" : request.tasks[0].id;
  if (scenario === "desired value") request.tasks[0].desiredValue = "French";
  try {
    if (scenario !== "no interaction")
      document
        .querySelector("button")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dialog = document.createElement("div");
    dialog.id = "picker";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute(
      "aria-label",
      scenario === "unrelated dialog" ? "Notifications" : "Languages",
    );
    dialog.innerHTML = `<input type="search" role="combobox" aria-label="Search languages" aria-expanded="${scenario !== "collapsed"}">`;
    document.body.append(dialog);
    coach.getPage();
    await vi.waitFor(() => {
      const page = coach.getPage();
      expect(
        page?.controls.some((control) => control.role === "combobox"),
      ).toBe(true);
    });
    expect(coach.view.verifiedSteps).toBe(scenario === "matching" ? 1 : 0);
    expect(coach.view.goalPlan?.status).not.toBe("completed");
    expect(coach.view.request?.status).not.toBe("completed");
    if (scenario === "matching") {
      expect(coach.view.goalPlan?.status).toBe("awaiting-choice");
      expect(coach.view.liveDiagnostics?.events.at(-1)).toMatchObject({
        outcome: "verified",
        evidence: "related-controls-added",
      });
    }
  } finally {
    coach.stop();
  }
});
