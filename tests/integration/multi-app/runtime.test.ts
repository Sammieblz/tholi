import { test, expect } from "vitest";
import {
  NavigationCore,
  workflowGuides,
  advanceQueue,
  pauseQueue,
  resumeQueue,
  stopQueue,
  matchesStamp,
} from "../../../packages/navigation-core/index";
import {
  recordWorkflowAction,
  continueWorkflow,
} from "../../../packages/navigation-core/workflows";
import {
  SemanticIndex,
  MemoryDerivedStore,
} from "../../../packages/nlp/retrieval";
import { appFixture } from "./fixtures";
import type {
  PageControl,
  PageSnapshot,
} from "../../../packages/page-model/index";
import type { PlanResult } from "../../../packages/navigation-core/index";
import { returnFromHandoff } from "../../../packages/route-registry/handoff";
import { sessionSchema } from "../../../packages/route-registry/session";
const engine = () =>
  new NavigationCore(
    new SemanticIndex(
      {
        async embed(texts) {
          return texts.map(() => Array(384).fill(0));
        },
        async dispose() {},
      },
      new MemoryDerivedStore(),
    ),
  );
const origin = {
  cloudflare: "https://dash.cloudflare.com",
  github: "https://github.com",
  jira: "https://team.atlassian.net",
  youtube: "https://www.youtube.com",
  netflix: "https://www.netflix.com",
  amazon: "https://www.amazon.com",
};
function screen(
  platform: keyof typeof origin,
  labels: string[],
  revision: number,
  kind: PageControl["kind"] = "expand",
  context = "",
): PageSnapshot {
  const p = appFixture(platform, origin[platform]);
  return {
    ...p,
    revision,
    fingerprint: "screen" + revision,
    stateKey: "screen" + revision,
    path: platform === "github" ? "/owner/demo" : "/",
    controls: labels.map((label, i) => ({
      ...p.controls[0],
      id: `w0000000000000000-${i}`,
      signature: label,
      label,
      context,
      kind,
      risk: kind === "action" ? "consequential" : "ordinary",
    })),
  };
}
const input = (text: string, p: PageSnapshot, previous?: PlanResult) => ({
  requestId: previous?.requestId || crypto.randomUUID(),
  documentId: "doc" + p.revision,
  revision: p.revision,
  text,
  observation: p,
  strategy: "fastest" as const,
  protocolVersion: 2 as const,
  contextRevision: previous?.workflow?.revision || 0,
  request: previous?.request,
  workflow: previous?.workflow,
});
test("an excluded workflow cannot displace the positive request or supply its entities", async () => {
  const core = engine(),
    p = screen("netflix", ["Help", "Account"], 1, "navigation"),
    r = await core.plan(input("Show Help but do not cancel my membership", p));
  expect(r.workflow).toBeUndefined();
  expect(r.plan?.steps[0]?.label).toBe("Help");
  const cf = screen("cloudflare", ["Workers & Pages"], 1, "navigation"),
    deploy = await core.plan(
      input(
        'Deploy Pages from GitHub but do not use repository "private-excluded"',
        cf,
      ),
    );
  expect(
    deploy.workflow?.entities.some((e) => e.value === "private-excluded"),
  ).toBe(false);
});
test("a named Jira project can be chosen from a live list and a conflicting form selection overrides old scope", async () => {
  const core = engine(),
    p = screen("jira", ["Foo"], 1, "choice", "Project"),
    text = 'Create a work item titled "Broken layout" in project "Foo"';
  const first = await core.plan(input(text, p));
  expect(first.plan?.steps[0]?.label).toBe("Foo");
  expect(first.workflow?.pendingAction?.milestone).toBe("entity:project");
  first.workflow = recordWorkflowAction(first.workflow!, p.controls[0]);
  expect(first.workflow.pendingAction?.acted).toBe(true);
  const next = screen("jira", ["Project", "Create work item"], 2);
  next.controls[0].kind = "select";
  next.controls[0].options = [
    { label: "Foo", selected: true, enabled: true },
    { label: "Other", selected: false, enabled: true },
  ];
  const selected = await core.plan(input(text, next, first));
  expect(selected.plan?.steps[0]?.label).toBe("Create work item");
  selected.workflow!.entities.find((e) => e.type === "project")!.binding = {
    origin: next.origin,
    path: next.path,
    frameId: 0,
  };
  next.controls[0].options[0].selected = false;
  next.controls[0].options[1].selected = true;
  const wrong = await core.plan(
    input(
      text,
      { ...next, revision: 3, fingerprint: "wrong-project" },
      selected,
    ),
  );
  expect(wrong.plan?.steps[0]?.label).toBe("Project");
  expect(wrong.plan?.status).not.toBe("completed");
});
async function journey(
  platform: keyof typeof origin,
  text: string,
  steps: {
    labels: string[];
    kind?: PageControl["kind"];
    context?: string;
    target: string;
    manual?: boolean;
  }[],
) {
  const core = engine();
  let previous: PlanResult | undefined;
  for (const [i, s] of steps.entries()) {
    const p = screen(platform, s.labels, i + 1, s.kind, s.context),
      r = await core.plan(input(text, p, previous));
    expect(
      r.plan?.steps[0]?.label || r.workflow?.pendingAction?.label,
      JSON.stringify(r),
    ).toBe(s.target);
    expect(r.plan?.status).not.toBe("completed");
    expect(r.request?.active).toBe(0);
    const c = p.controls.find((c) => c.label === s.target)!;
    r.workflow = recordWorkflowAction(
      r.workflow!,
      c,
      r.workflow?.status !== "review",
      p,
    );
    if (s.manual)
      r.workflow = continueWorkflow(
        r.workflow,
        workflowGuides.find((g) => g.id === r.workflow!.guideId)!,
      );
    previous = r;
  }
  return { core, previous: previous! };
}
test("Cloudflare Git objective survives permission handoff, repository choice, configuration and processing", async () => {
  const text =
    'Deploy a Pages website from GitHub repository "demo" for project named sample';
  const { core, previous } = await journey("cloudflare", text, [
    {
      labels: ["Workers & Pages"],
      kind: "navigation",
      target: "Workers & Pages",
    },
    { labels: ["Create application"], target: "Create application" },
    {
      labels: ["Get started"],
      kind: "navigation",
      context: "Pages",
      target: "Get started",
    },
    {
      labels: ["Connect to Git"],
      kind: "navigation",
      target: "Connect to Git",
    },
    { labels: ["demo"], kind: "choice", context: "Repository", target: "demo" },
    {
      labels: ["Project name"],
      kind: "focus",
      target: "Project name",
      manual: true,
    },
    { labels: ["Save and Deploy"], kind: "action", target: "Save and Deploy" },
  ]);
  const busy = {
    ...screen("cloudflare", [], 8),
    busy: true,
    signals: [
      {
        kind: "status" as const,
        subject: "Deployment sample",
        text: "Deployment successful",
        revision: 8,
      },
    ],
  };
  expect((await core.plan(input(text, busy, previous))).plan?.status).not.toBe(
    "completed",
  );
  const done = await core.plan(
    input(
      text,
      { ...busy, busy: false, revision: 9, fingerprint: "done" },
      previous,
    ),
  );
  expect(done.plan?.status).toBe("completed");
  // A permission screen must not substitute its own success for the deployment.
  const permission = screen(
    "github",
    ["Authorize Cloudflare"],
    1,
    "action",
    "Cloudflare",
  );
  const handoff = await core.plan(
    input(text, permission, {
      ...previous,
      workflow: {
        ...previous.workflow!,
        status: "active",
        pendingAction: undefined,
        activeMilestone: 3,
      },
    }),
  );
  expect(handoff.workflow?.pendingAction?.milestone).toBe("handoff:permission");
  expect(handoff.workflow?.original).toBe(text);
  expect(handoff.plan?.steps).toEqual([]);
});
test("Cloudflare Direct Upload treats file selection as a manual handoff", async () => {
  const text = "Deploy Pages using prebuilt files for project named sample";
  const { core, previous } = await journey("cloudflare", text, [
    {
      labels: ["Upload files"],
      kind: "focus",
      target: "Upload files",
      manual: true,
    },
    { labels: ["Deploy site"], kind: "action", target: "Deploy site" },
  ]);
  const p = screen("cloudflare", [], 3);
  p.signals = [
    {
      kind: "status",
      subject: "Deployment sample",
      text: "Deployment successful",
      revision: 3,
    },
  ];
  expect((await core.plan(input(text, p, previous))).plan?.status).toBe(
    "completed",
  );
});
test("GitHub branch changes require the named repository and a fresh requested state", async () => {
  const text = 'Change default branch to develop in repository "demo"';
  const { core, previous } = await journey("github", text, [
    {
      labels: ["Settings"],
      kind: "navigation",
      context: "Repository demo",
      target: "Settings",
    },
    { labels: ["Default branch"], target: "Default branch" },
    { labels: ["develop"], kind: "choice", target: "develop" },
    { labels: ["Update"], kind: "action", target: "Update" },
  ]);
  const p = screen("github", [], 5);
  p.signals = [
    { kind: "state", subject: "Default branch", text: "main", revision: 5 },
  ];
  expect((await core.plan(input(text, p, previous))).plan?.status).not.toBe(
    "completed",
  );
  p.signals = [
    { kind: "state", subject: "Default branch", text: "develop", revision: 5 },
  ];
  expect((await core.plan(input(text, p, previous))).plan?.status).toBe(
    "completed",
  );
  p.path = "/owner/other";
  p.controls = screen(
    "github",
    ["Settings"],
    1,
    "navigation",
    "Repository other",
  ).controls;
  expect((await core.plan(input(text, p))).plan?.steps).toEqual([]);
});
test("Jira creation cannot finish on field focus, existing item text or an unrelated toast", async () => {
  const text = 'Create a work item titled "Broken layout"';
  const { core, previous } = await journey("jira", text, [
    { labels: ["Projects"], kind: "navigation", target: "Projects" },
    { labels: ["Create work item"], target: "Create work item" },
    { labels: ["Summary"], kind: "focus", target: "Summary", manual: true },
    { labels: ["Create"], kind: "action", target: "Create" },
  ]);
  const p = screen("jira", [], 5);
  p.signals = [
    {
      kind: "status",
      subject: "Work item Broken layout",
      text: "Opened existing issue",
      revision: 5,
    },
  ];
  expect((await core.plan(input(text, p, previous))).plan?.status).not.toBe(
    "completed",
  );
  p.signals = [
    {
      kind: "status",
      subject: "Work item",
      text: "Broken layout created",
      revision: 5,
    },
  ];
  expect((await core.plan(input(text, p, previous))).plan?.status).toBe(
    "completed",
  );
});
for (const [name, text, menu, value] of [
  ["captions", "Change captions to Spanish", "Subtitles/CC", "Spanish"],
  ["speed", "Change playback speed to 2", "Playback speed", "2"],
])
  test(`YouTube ${name} verifies the chosen preference, including optional menu branches`, async () => {
    const { core, previous } = await journey("youtube", text, [
      { labels: ["Settings"], context: "Video player", target: "Settings" },
      { labels: [menu], target: menu },
      { labels: [value], kind: "choice", context: menu, target: value },
    ]);
    const p = screen("youtube", [value], 4, "choice", menu);
    p.controls[0].checked = true;
    expect((await core.plan(input(text, p, previous))).plan?.status).toBe(
      "completed",
    );
  });
for (const platform of ["netflix", "amazon"] as const)
  test(`${platform} cancellation rejects negative status and remains incomplete until verified`, async () => {
    const text =
      platform === "netflix"
        ? "Cancel my Netflix membership"
        : "Cancel my Prime membership";
    const steps =
      platform === "netflix"
        ? [
            {
              labels: ["Account"],
              kind: "navigation" as const,
              target: "Account",
            },
            {
              labels: ["Cancel membership"],
              kind: "navigation" as const,
              target: "Cancel membership",
            },
            {
              labels: ["Finish Cancellation"],
              kind: "action" as const,
              target: "Finish Cancellation",
            },
          ]
        : [
            { labels: ["Prime"], kind: "navigation" as const, target: "Prime" },
            { labels: ["Manage membership"], target: "Manage membership" },
            {
              labels: ["End membership"],
              kind: "action" as const,
              target: "End membership",
            },
          ];
    const { core, previous } = await journey(platform, text, steps),
      p = screen(platform, [], 4);
    p.signals = [
      {
        kind: "status",
        subject: "Membership",
        text: "Membership not cancelled",
        revision: 4,
      },
    ];
    expect((await core.plan(input(text, p, previous))).plan?.status).not.toBe(
      "completed",
    );
    p.signals = [
      {
        kind: "status",
        subject: "Membership",
        text: "Membership cancelled",
        revision: 4,
      },
    ];
    expect((await core.plan(input(text, p, previous))).plan?.status).toBe(
      "completed",
    );
  });
test("queue ordering, pause/restart stamps, skip and Stop retain honest task state", async () => {
  const p = screen("netflix", ["Account"], 1, "navigation"),
    r = await engine().plan(input("Cancel my membership then open Help", p));
  expect(r.request?.tasks).toHaveLength(2);
  expect(advanceQueue(r.request!, "wrong").active).toBe(0);
  const restored = resumeQueue(
    JSON.parse(JSON.stringify(pauseQueue(r.request!))),
  );
  expect(restored.active).toBe(0);
  expect(advanceQueue(restored, "skipped").tasks[0].status).toBe("skipped");
  expect(advanceQueue(stopQueue(restored), "verified").status).toBe("canceled");
  expect(
    matchesStamp(
      { requestId: "x", documentId: "d", revision: 1, contextRevision: 2 },
      { requestId: "x", documentId: "d", revision: 1, contextRevision: 3 },
    ),
  ).toBe(false);
});
test("Netflix plan review continues through confirmation without completing on a preview", async () => {
  const text = "Change my plan to Premium",
    { core, previous } = await journey("netflix", text, [
      { labels: ["Account"], kind: "navigation", target: "Account" },
      { labels: ["Change Plan"], kind: "navigation", target: "Change Plan" },
      { labels: ["Premium"], kind: "choice", target: "Premium" },
      { labels: ["Continue"], kind: "action", target: "Continue" },
    ]);
  const preview = screen("netflix", ["Confirm Change"], 5, "action");
  preview.signals = [
    { kind: "status", subject: "Plan", text: "Premium plan", revision: 5 },
  ];
  const confirm = await core.plan(input(text, preview, previous));
  expect(confirm.plan?.status).not.toBe("completed");
  expect(confirm.workflow?.status).toBe("review");
  expect(confirm.workflow?.pendingAction?.label).toBe("Confirm Change");
  confirm.workflow = recordWorkflowAction(
    confirm.workflow!,
    preview.controls[0],
  );
  const after = screen("netflix", [], 6);
  after.signals = [
    {
      kind: "status",
      subject: "Plan",
      text: "Premium plan changed",
      revision: 6,
    },
  ];
  expect((await core.plan(input(text, after, confirm))).plan?.status).toBe(
    "completed",
  );
});
test("guide changes invalidate pending predictions and foreign-frame status cannot establish success", async () => {
  const core = engine(),
    p = screen("netflix", ["Finish Cancellation"], 1, "action"),
    text = "Cancel my membership",
    first = await core.plan(input(text, p));
  const acted = {
      ...first,
      workflow: recordWorkflowAction(first.workflow!, p.controls[0]),
    },
    after = screen("netflix", [], 2);
  after.signals = [
    {
      kind: "status",
      subject: "Membership",
      text: "Membership cancelled",
      revision: 2,
      frameId: 3,
    },
  ];
  expect((await core.plan(input(text, after, acted))).plan?.status).not.toBe(
    "completed",
  );
  first.workflow!.guideVersion = "old-version";
  first.workflow!.activeMilestone = 90;
  const rebuilt = await core.plan(
    input(text, screen("netflix", ["Account"], 3, "navigation"), first),
  );
  expect(rebuilt.workflow?.activeMilestone).toBe(0);
  expect(rebuilt.plan?.steps[0]?.label).toBe("Account");
});
test("closing an authorization popup returns to its recorded opener without asserting success", async () => {
  const p = screen("cloudflare", ["Workers & Pages"], 1, "navigation"),
    r = await engine().plan(input("Deploy Pages from GitHub", p));
  const session = sessionSchema.parse({
    sessionId: crypto.randomUUID(),
    tabId: 25,
    origin: "https://github.com",
    routeId: "navigator.live",
    routeVersion: "0.1.0",
    handoffReturn: { tabId: 10, origin: p.origin },
    view: {
      instruction: "Review authorization",
      confidence: 1,
      routeId: "navigator.live",
      routeVersion: "0.1.0",
      status: "running",
      verifiedSteps: 0,
      history: [],
      request: r.request,
      journey: {
        id: crypto.randomUUID(),
        goal: r.request!.original,
        objective: { purpose: r.workflow!.objective },
        origin: p.origin,
        strategy: "fastest",
        startedAt: Date.now(),
        updatedAt: Date.now(),
        status: "active",
        progress: [],
        reroutes: 0,
        workflow: r.workflow,
      },
    },
  });
  const returned = returnFromHandoff(session, 25, {
    id: 10,
    url: p.origin + "/account",
  });
  expect(returned?.tabId).toBe(10);
  expect(returned?.view?.request?.original).toBe(r.request!.original);
  expect(returned?.view?.status).toBe("paused");
  expect(returned?.view?.journey?.workflow?.status).not.toBe("completed");
  expect(returned?.documentId).toBeUndefined();
  expect(
    returnFromHandoff(session, 25, { id: 10, url: "https://other.test/" }),
  ).toBeUndefined();
  session.view!.journey!.workflow!.status = "canceled";
  expect(
    returnFromHandoff(session, 25, { id: 10, url: p.origin }),
  ).toBeUndefined();
});
