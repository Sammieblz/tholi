// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { PageDiscovery } from "../../../packages/page-discovery/index";
import {
  beginJourney,
  planTask,
  objectiveReached,
  advanceJourney,
  saveTask,
} from "../../../packages/goal-planner/task-journey";
import { shortestRoute } from "../../../packages/goal-planner/route-graph";
import { mergeObservation } from "../../../packages/site-memory/index";
import { modelContext } from "../../../packages/goal-planner/model-context";
import type {
  SiteMemory,
  MemoryTransition,
} from "../../../packages/page-model/index";

function fixture(html: string) {
  document.body.innerHTML = html;
  document.documentElement.lang = "en";
  const rect = {
    top: 10,
    left: 10,
    right: 110,
    bottom: 40,
    width: 100,
    height: 30,
    x: 10,
    y: 10,
    toJSON: () => ({}),
  };
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function (this: HTMLElement) {
      return this.closest("[hidden]") ? ([] as any) : ([rect] as any);
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    rect,
  );
  return new PageDiscovery();
}
afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.lang = "en";
});
it("retains Spanish through a dynamically created owned language picker", () => {
  const discovery = fixture(
    '<button aria-controls="picker" aria-expanded="false">Languages</button><div id="picker" hidden></div>',
  );
  let page = discovery.snapshot(),
    task = beginJourney("I want to change language to Spanish", page.origin);
  expect(task.objective).toEqual({
    purpose: "language",
    value: "Spanish",
    language: "es",
  });
  let plan = planTask(page, task);
  expect(plan.steps.map((s) => s.label)).toEqual(["Languages"]);
  expect(plan.route).toMatchObject({
    clicks: 2,
    complete: false,
    predictions: [{ label: "Spanish", evidence: "predicted" }],
  });
  const before = page,
    opener = page.controls.find((c) => c.label === "Languages")!;
  document.querySelector("button")!.setAttribute("aria-expanded", "true");
  document.querySelector("#picker")!.removeAttribute("hidden");
  document.querySelector("#picker")!.innerHTML =
    '<a hreflang="es" href="/spanish">Español</a><a hreflang="fr" href="/french">Français</a>';
  page = discovery.snapshot();
  task = advanceJourney(task, page, opener, before.stateKey, 4000);
  expect(task.status).toBe("active");
  plan = planTask(page, task);
  expect(plan.steps.map((s) => s.label)).toEqual(["Español"]);
  expect(plan.goal).toBe(task.goal);
  expect(plan.status).toBe("guiding");
  document.querySelector("button")!.setAttribute("aria-expanded", "false");
  document.querySelector("#picker")!.setAttribute("hidden", "");
  const known = planTask(discovery.snapshot(), task);
  expect(known.steps).toHaveLength(2);
  expect(known.route).toMatchObject({
    clicks: 2,
    complete: true,
    predictions: [],
  });
  document.documentElement.lang = "fr";
  expect(objectiveReached(task, discovery.snapshot())).toBe(false);
  document.documentElement.lang = "es";
  expect(planTask(discovery.snapshot(), task).status).toBe("completed");
});
it("verifies the actual requested native option and observes option selection in revisions", () => {
  const discovery = fixture(
    "<label>Color <select><option>Red</option><option>Blue</option></select></label>",
  );
  const before = discovery.snapshot(),
    task = beginJourney("Set color to Blue", before.origin);
  expect(planTask(before, task).steps[0].label).toBe("Color");
  expect(objectiveReached(task, before)).toBe(false);
  document.querySelector("select")!.selectedIndex = 1;
  const after = discovery.snapshot();
  expect(after.revision).toBeGreaterThan(before.revision);
  expect(objectiveReached(task, after)).toBe(true);
});
it("does not infer account preference completion from the document language", () => {
  const discovery = fixture("<h1>Settings</h1>");
  document.documentElement.lang = "es";
  const page = discovery.snapshot();
  expect(
    objectiveReached(
      beginJourney("Change account language to Spanish", page.origin),
      page,
    ),
  ).toBe(false);
});
it("keeps ambiguous language destinations unresolved and never follows a risky option", () => {
  const discovery = fixture(
    '<a href="/one" hreflang="es">Español</a><a href="/two" hreflang="es">Español</a><form method="post"><button>Language Spanish</button></form>',
  );
  const page = discovery.snapshot();
  expect(
    planTask(page, beginJourney("Change language to Spanish", page.origin))
      .issue,
  ).toBe("ambiguous");
});
it("calculates fastest and fewest-click paths, avoiding cycles, predictions and stale first edges", () => {
  const discovery = fixture(
      '<a href="/slow">Direct</a><a href="/fast">Shortcut</a>',
    ),
    page = discovery.snapshot();
  const [direct, shortcut] = page.controls;
  const edge = (
    from: string,
    to: string,
    signature: string,
    ms: number,
  ): MemoryTransition => ({
    from,
    to,
    signature,
    label: signature,
    meanMs: ms,
    samples: 3,
    lastVerified: Date.now(),
    active: true,
    evidence: "observed",
  });
  const memory: SiteMemory = {
    schemaVersion: 1,
    origin: page.origin,
    version: 1,
    lastSeen: Date.now(),
    pages: [],
    templates: [],
    transitions: [
      edge(page.stateKey, "end", direct.signature, 20000),
      edge(page.stateKey, "mid", shortcut.signature, 1000),
      edge("mid", "end", "next", 1000),
      edge("mid", page.stateKey, "cycle", 1),
      { ...edge(page.stateKey, "end", "unknown", 1), evidence: "inferred" },
    ],
  };
  expect(
    shortestRoute(page, memory, new Set(["end"]), "fastest")?.map(
      (e) => e.signature,
    ),
  ).toEqual([shortcut.signature, "next"]);
  expect(
    shortestRoute(page, memory, new Set(["end"]), "fewest-clicks")?.map(
      (e) => e.signature,
    ),
  ).toEqual([direct.signature]);
  direct.risk = "consequential";
  shortcut.enabled = false;
  expect(shortestRoute(page, memory, new Set(["end"]))).toBeUndefined();
});
it("preserves menu state vertices and learns repeated transition timing", () => {
  const discovery = fixture(
    '<button aria-expanded="false" aria-controls="menu">Languages</button><div id="menu" hidden><a href="/es" hreflang="es">Español</a></div>',
  );
  const before = discovery.snapshot();
  let memory = mergeObservation(undefined, before);
  document.querySelector("button")!.setAttribute("aria-expanded", "true");
  document.querySelector("#menu")!.removeAttribute("hidden");
  const after = discovery.snapshot(),
    transition = {
      from: before.stateKey,
      to: after.stateKey,
      signature: before.controls[0].signature,
      label: "Languages",
      durationMs: 2000,
    };
  memory = mergeObservation(memory, after, transition);
  memory = mergeObservation(memory, after, { ...transition, durationMs: 4000 });
  expect(memory.states?.map((p) => p.stateKey)).toContain(before.stateKey);
  expect(
    memory.transitions.find((e) => e.evidence === "observed"),
  ).toMatchObject({ samples: 2, meanMs: 3000 });
});
it("passes bounded verified task context to the model and saves no document IDs or input values", () => {
  const discovery = fixture(
    '<label>Language<select><option>English</option><option>Spanish</option></select></label><input aria-label="Name" value="USER_PRIVATE_SENTINEL">',
  );
  const page = discovery.snapshot(),
    task = beginJourney("Change language to Spanish", page.origin);
  task.progress = Array.from({ length: 30 }, (_, i) => ({
    origin: page.origin,
    from: "state" + i,
    to: "state" + (i + 1),
    signature: "sig",
    label: "Menu",
    kind: "expand",
    durationMs: 1000,
    at: Date.now(),
  }));
  const context = modelContext(page, task.goal, task);
  expect(context.task?.verifiedProgress).toHaveLength(8);
  expect(context.task?.destination).toMatchObject({
    value: "Spanish",
    language: "es",
  });
  expect(JSON.stringify(context)).not.toContain("USER_PRIVATE_SENTINEL");
  const saved = JSON.stringify(saveTask(task));
  expect(saved).not.toContain(page.controls[0].id);
  expect(saved).not.toContain("USER_PRIVATE_SENTINEL");
});
it("compares a slow direct destination with a faster learned detour, respecting click preference", () => {
  const discovery = fixture(
      '<label>Color<select><option>Red</option><option>Blue</option></select></label><a href="/quick">Quick preferences</a>',
    ),
    page = discovery.snapshot();
  const [direct, quick] = page.controls;
  let memory = mergeObservation(undefined, page);
  const terminal = {
    ...memory.pages[0],
    stateKey: "terminal",
    controls: memory.pages[0].controls.map((c) => ({
      ...c,
      options: c.options?.map((o) => ({ ...o, selected: o.label === "Blue" })),
    })),
  };
  memory.states!.push(terminal);
  const edge = (
    from: string,
    to: string,
    signature: string,
    ms: number,
  ): MemoryTransition => ({
    from,
    to,
    signature,
    label: signature,
    meanMs: ms,
    samples: 3,
    lastVerified: Date.now(),
    active: true,
    evidence: "observed",
  });
  memory.transitions = [
    edge(page.stateKey, "terminal", direct.signature, 20000),
    edge(page.stateKey, "mid", quick.signature, 1000),
    edge("mid", "terminal", "next", 1000),
  ];
  const fastest = planTask(
    page,
    beginJourney("Set color to Blue", page.origin),
    memory,
  );
  expect(fastest.steps[0].controlId).toBe(quick.id);
  expect(fastest.route).toMatchObject({
    clicks: 2,
    complete: true,
    basis: "observed",
  });
  const fewest = planTask(
    page,
    beginJourney("Set color to Blue", page.origin, "fewest-clicks"),
    memory,
  );
  expect(fewest.steps[0].controlId).toBe(direct.id);
});
it("a restored completion is revalidated against current preference state", () => {
  const discovery = fixture(
      "<label>Color<select><option>Red</option><option>Blue</option></select></label>",
    ),
    page = discovery.snapshot();
  const task = beginJourney("Set color to Blue", page.origin);
  task.status = "completed";
  expect(planTask(page, task).status).toBe("guiding");
});
it("does not borrow predictions from a different task sharing an opener", () => {
  const discovery = fixture(
      '<button aria-controls="menu" aria-expanded="false">Languages</button><div id="menu" hidden></div>',
    ),
    page = discovery.snapshot();
  const french = beginJourney("Change language to French", page.origin);
  french.status = "completed";
  french.progress = [
    {
      origin: page.origin,
      from: page.stateKey,
      to: "picker",
      signature: page.controls[0].signature,
      label: "Languages",
      kind: "expand",
      durationMs: 1000,
      at: Date.now(),
    },
    {
      origin: page.origin,
      from: "picker",
      to: "destination",
      signature: "french",
      label: "Français",
      kind: "navigation",
      durationMs: 1000,
      at: Date.now(),
    },
  ];
  const plan = planTask(
    page,
    beginJourney("Change language to Spanish", page.origin),
    undefined,
    undefined,
    saveTask(french),
  );
  expect(plan.route).toMatchObject({
    complete: false,
    basis: "estimated",
    predictions: [{ label: "Spanish", evidence: "predicted" }],
  });
});
it("verifies boolean preferences and refuses unavailable values rather than toggling repeatedly", () => {
  const discovery = fixture(
      '<label>Notifications<input type="checkbox"></label><label>Language<select><option>English</option><option>French</option></select></label>',
    ),
    page = discovery.snapshot();
  const task = beginJourney("Set notifications to on", page.origin);
  expect(planTask(page, task).status).toBe("guiding");
  document.querySelector("input")!.checked = true;
  expect(planTask(discovery.snapshot(), task).status).toBe("completed");
  expect(
    planTask(
      discovery.snapshot(),
      beginJourney("Set notifications to Blue", page.origin),
    ).status,
  ).toBe("unresolved");
  expect(
    planTask(
      discovery.snapshot(),
      beginJourney("Change language to Spanish", page.origin),
    ).status,
  ).toBe("unresolved");
});
