import { test, expect, vi } from "vitest";
import { backendNlp } from "../../../apps/extension/src/platform/backend-client";
import { NavigationCore } from "../../../packages/navigation-core/index";
import {
  SemanticIndex,
  MemoryDerivedStore,
} from "../../../packages/nlp/retrieval";
import { fixture } from "../../integration/nlp/fixtures";
import {
  beginJourney,
  advanceJourney,
} from "../../../packages/goal-planner/task-journey";
import type { PageControl } from "../../../packages/page-model/index";

const core = () =>
  new NavigationCore(
    new SemanticIndex(
      {
        async embed(texts: string[]) {
          return texts.map(() => Array(384).fill(0));
        },
        async dispose() {},
      },
      new MemoryDerivedStore(),
    ),
  );
const control = (
  label: string,
  kind: PageControl["kind"] = "expand",
  index = 0,
): PageControl => ({
  ...fixture().controls[0],
  id: `w0000000000000000-${index}`,
  signature: label,
  label,
  kind,
  role: kind === "expand" ? "button" : "link",
  context: "Global navigation",
  group: "Navigation",
  expanded: kind === "expand" ? false : undefined,
  popup: kind === "expand" ? "menu" : undefined,
});
const input = (controls: PageControl[], text = "Account settings") => ({
  requestId: crypto.randomUUID(),
  documentId: "dashboard",
  revision: 1,
  text,
  strategy: "fastest" as const,
  observation: { ...fixture(), controls },
});

test("unmounted account settings retain their destination while exploring a relevant live menu", async () => {
  const c = core(),
    menu = control("Manage account");
  const initial = input([menu, control("Worker settings", "navigation", 1)]);
  const first = await c.plan(initial);
  expect(first.plan?.steps[0]?.controlId).toBe(menu.id);
  expect(first.plan?.exploration).toBe(true);
  expect(first.request?.tasks[0].target).toBe("Account settings");
  expect(first.canonicalGoal).toBe("Account settings");
  const journey = beginJourney("Account settings", initial.observation.origin);
  journey.requestTaskId = first.request!.tasks[0].id;
  const page = {
    ...initial.observation,
    revision: 2,
    stateKey: "menu-open",
    fingerprint: "menu-open",
    controls: [
      { ...menu, expanded: true },
      control("Account settings", "navigation", 2),
    ],
  };
  const next = await c.plan({
    ...initial,
    revision: 2,
    observation: page,
    request: first.request,
    journey: advanceJourney(journey, page, menu, "initial", 100),
  });
  expect(next.plan?.steps[0]?.label).toBe("Account settings");
  expect(next.plan?.exploration).not.toBe(true);
  expect(next.plan?.status).toBe("guiding");
  expect(next.request?.tasks[0].status).not.toBe("completed");
});

test("an account destination can explore a named user menu without substituting repository settings", async () => {
  const menu = control("Open user menu");
  const first = await core().plan(
    input([
      menu,
      { ...control("Settings", "navigation", 1), context: "Repository" },
    ]),
  );
  expect(first.plan?.steps[0]?.controlId).toBe(menu.id);
  expect(first.plan?.exploration).toBe(true);
  expect(first.canonicalGoal).toBe("Account settings");
});

test("Settings inside a user menu resolves the account scope and retains it after rebinding", async () => {
  const c = core();
  const p = input([
    { ...control("Settings", "navigation", 0), context: "User navigation" },
    {
      ...control("Settings", "navigation", 1),
      context: "Repository",
      signature: "repository-settings",
    },
  ]);
  const result = await c.plan(p);
  expect(result.plan?.steps[0]?.controlId).toBe(p.observation.controls[0].id);
  expect(result.request?.tasks[0].contextTarget).toBe("Account settings");
  expect(result.canonicalGoal).toBe("Account settings");
  const changed = await c.plan({
    ...p,
    observation: { ...p.observation, controls: [p.observation.controls[1]] },
    request: result.request,
  });
  expect(changed.plan?.steps).toHaveLength(0);
});

test("grounded menu exploration does not wait for embeddings to become available", async () => {
  const c = new NavigationCore(
    new SemanticIndex(
      {
        async embed(): Promise<number[][]> {
          throw new Error("Embedding resources are still loading");
        },
        async dispose() {},
      },
      new MemoryDerivedStore(),
    ),
  );
  const result = await c.plan(input([control("Account menu")]));
  expect(result.plan?.exploration).toBe(true);
  expect(result.activity.embedded).toBe(0);
});

test("a missing qualifier or committing request cannot become menu exploration", async () => {
  const c = core();
  expect(
    (
      await c.plan(
        input([control("Notifications")], "Please open red notifications"),
      )
    ).plan?.steps,
  ).toHaveLength(0);
  expect(
    (await c.plan(input([control("Account menu")], "Delete account"))).plan
      ?.steps,
  ).toHaveLength(0);
  expect(
    (
      await c.plan(
        input([control("Account menu")], "Open red account settings"),
      )
    ).plan?.steps,
  ).toHaveLength(0);
});

test("an older connected backend falls back locally before processing settings context", async () => {
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async () => ({
          backend: {
            enabled: true,
            url: "http://127.0.0.1:8787",
            token: "test-token-not-a-real-credential",
          },
        }),
      },
    },
  });
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      protocols: [1, 2],
      capabilities: ["hybrid-retrieval"],
    }),
  }));
  vi.stubGlobal("fetch", fetch);
  try {
    expect(
      await backendNlp(
        { ...input([control("Account menu")]), protocolVersion: 2 },
        false,
      ),
    ).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("exploration refuses excluded, unrelated, disabled or unknown-effect controls", async () => {
  for (const controls of [
    [control("Video menu")],
    [{ ...control("Account menu"), enabled: false }],
    [{ ...control("Account menu"), risk: "consequential" as const }],
    [control("Account menu", "action")],
  ])
    expect((await core().plan(input(controls))).plan?.steps).toHaveLength(0);
  expect(
    (
      await core().plan(
        input(
          [control("Account menu")],
          "Account settings, but do not use the account menu",
        ),
      )
    ).plan?.steps,
  ).toHaveLength(0);
});

test("an already explored or open menu is not selected again when its destination is absent", async () => {
  const menu = control("Account menu"),
    initial = input([menu]);
  const first = await core().plan(initial);
  const journey = beginJourney("Account settings", initial.observation.origin);
  journey.requestTaskId = first.request!.tasks[0].id;
  const progressed = advanceJourney(
    journey,
    initial.observation,
    menu,
    "initial",
    100,
  );
  expect(
    (
      await core().plan({
        ...initial,
        request: first.request,
        journey: progressed,
      })
    ).plan?.steps,
  ).toHaveLength(0);
  expect(
    (await core().plan(input([{ ...menu, expanded: true }]))).plan?.steps,
  ).toHaveLength(0);
});

test("long requests remain intact while exploration instructions respect the response contract", async () => {
  const text = "Account settings " + "with details ".repeat(45);
  const result = await core().plan(input([control("Account menu")], text));
  expect(result.request?.original).toBe(text.trim());
  expect(result.plan?.exploration).toBe(true);
  expect(result.plan?.reason.length).toBeLessThanOrEqual(500);
});
