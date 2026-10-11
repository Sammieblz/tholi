import { it, expect, vi, afterEach } from "vitest";
import { PageDiscovery } from "../packages/page-discovery";
import { planGoal } from "../packages/goal-planner";
import {
  beginJourney,
  planTask,
  advanceJourney,
  saveTask,
  resumeJourney,
} from "../packages/goal-planner/task-journey";
import {
  journeySchema,
  pageSnapshotSchema,
  savedTaskSchema,
} from "../packages/page-model";
import { modelContext } from "../packages/goal-planner/model-context";

function fixture(html: string) {
  document.body.innerHTML = html;
  const rect = {
    top: 10,
    left: 10,
    right: 210,
    bottom: 40,
    width: 200,
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
}
afterEach(() => vi.restoreAllMocks());

it.each(["login", "How to log in", "Sign in to my account"])(
  "finds the declared login entry for %s without treating it as submission",
  (goal) => {
    fixture(
      '<nav><a href="/index?view=login">Log in</a><a href="/register">Create account</a></nav>',
    );
    const page = new PageDiscovery().snapshot(),
      task = beginJourney(goal, page.origin);
    expect(task.objective.workflow).toBe("login");
    expect(planTask(page, task).steps.map((s) => s.label)).toEqual(["Log in"]);
    expect(page.controls[0].risk).toBe("ordinary");
  },
);
it.each(["Create an account", "Register", "Sign up"])(
  "finds the registration entry for %s and preserves its original wording",
  (goal) => {
    fixture(
      '<button aria-expanded="false" aria-controls="account">Account</button><div id="account" hidden><a href="/enrol">Create account</a></div>',
    );
    const page = new PageDiscovery().snapshot(),
      task = beginJourney(goal, page.origin);
    expect(task.objective.workflow).toBe("register");
    expect(planTask(page, task).steps.map((s) => s.label)).toEqual([
      "Account",
      "Create account",
    ]);
    expect(planTask(page, task).goal).toBe(goal);
  },
);
it("distinguishes auth entry navigation from submission and a destructive endpoint", () => {
  fixture(
    '<a href="/login">Log in</a><button type="button" aria-haspopup="dialog">Sign in</button><form method="post"><input aria-label="Username"><button>Log in</button></form><button>Create account</button><a href="/delete/account">Sign in</a>',
  );
  const controls = new PageDiscovery().snapshot().controls;
  expect(
    controls
      .filter((c) => c.label === "Log in")
      .map((c) => c.risk)
      .sort(),
  ).toEqual(["consequential", "ordinary"]);
  expect(
    controls.find((c) => c.label === "Sign in" && c.kind === "expand")?.risk,
  ).toBe("ordinary");
  expect(controls.find((c) => c.label === "Create account")?.risk).toBe(
    "consequential",
  );
  expect(
    controls.find((c) => c.destination?.path === "/delete/account")?.risk,
  ).toBe("consequential");
});
it("carries an auth objective into a form, progresses safe fields, and stops at review without exposing secrets", () => {
  fixture(
    '<main><h1>Create account</h1><form method="post"><label>Username<input id="identity" value="PRIVATE_IDENTITY_SENTINEL"></label><label>Password<input type="password" autocomplete="new-password" value="PRIVATE_PASSWORD_SENTINEL"></label><label>Email (optional)<input type="email" value="PRIVATE_EMAIL_SENTINEL"></label><button>Create your account</button></form></main>',
  );
  const page = pageSnapshotSchema.parse(new PageDiscovery().snapshot());
  let task = journeySchema.parse(beginJourney("create account", page.origin));
  const first = planTask(page, task);
  expect(first.steps[0].label).toBe("Username");
  expect(first.route?.complete).toBe(false);
  const field = page.controls.find((c) => c.id === first.steps[0].controlId)!;
  task = advanceJourney(task, page, field, page.stateKey, 300);
  const second = planTask(page, task);
  expect(second.steps[0].label).toBe("Email (optional)");
  task = advanceJourney(
    task,
    page,
    page.controls.find((c) => c.id === second.steps[0].controlId)!,
    page.stateKey,
    300,
  );
  const review = planTask(page, task);
  expect(review).toMatchObject({
    status: "unresolved",
    issue: "consequential",
    steps: [],
  });
  expect(task.status).toBe("active");
  expect(review.route?.available).toBe(false);
  const serialized = JSON.stringify([
    page,
    modelContext(page, task.goal, task),
    savedTaskSchema.parse(saveTask(task, page, review)),
  ]);
  expect(serialized).not.toMatch(/PRIVATE_|PRIVATE_PASSWORD_SENTINEL/);
});
it("does not reuse an already-followed auth link or mistake a heading for success", () => {
  fixture(
    '<main><h1>Create account</h1><a href="/register">Create account</a></main>',
  );
  const page = new PageDiscovery().snapshot();
  let task = beginJourney("Create account", page.origin);
  const entry = page.controls.find((c) => c.kind === "navigation")!;
  task = advanceJourney(task, page, entry, "previous-state", 500);
  expect(planTask(page, task).status).toBe("unresolved");
  document.querySelector("a")!.remove();
  expect(planTask(new PageDiscovery().snapshot(), task).status).toBe(
    "unresolved",
  );
  expect(task.status).toBe("active");
});
it("leaves unmatched tasks without a numeric route promise and keeps intent qualifiers", () => {
  fixture('<a href="/login">Log in</a>');
  const page = new PageDiscovery().snapshot();
  expect(
    planTask(page, beginJourney("Open invoices", page.origin)).route?.available,
  ).toBe(false);
  expect(planGoal(page, "Log in with Google").status).toBe("unresolved");
  expect(planGoal(page, "Delete account").status).toBe("unresolved");
});
it("does not classify unrelated appearance/search forms from an authentication page heading", () => {
  fixture(
    '<main><h1>Log in</h1><form aria-label="Appearance"><label><input type="radio" checked>Large</label></form><form role="search"><input aria-label="Search"><button>Search</button></form><form method="post"><label>Username<input></label><input type="password"><button>Log in</button></form></main>',
  );
  const page = new PageDiscovery().snapshot();
  expect(
    page.controls
      .filter((c) => c.form?.authentication === "login")
      .map((c) => c.label),
  ).toEqual(["Username", "Log in"]);
  expect(
    planTask(page, beginJourney("How to log in", page.origin)).steps[0]?.label,
  ).toBe("Username");
});
it("upgrades a stored plain auth task without keeping its earlier premature completion", () => {
  fixture(
    '<main><h1>Log in</h1><form method="post"><label>Username<input></label><input type="password"><button>Log in</button></form></main>',
  );
  const page = new PageDiscovery().snapshot(),
    task = beginJourney("login", page.origin);
  delete task.objective.workflow;
  task.status = "completed";
  const restored = resumeJourney(task);
  expect(restored).toMatchObject({
    id: task.id,
    status: "active",
    objective: { workflow: "login" },
  });
  expect(planTask(page, task).steps[0].label).toBe("Username");
  expect(task.status).toBe("completed");
});
