import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";
import { readFile } from "node:fs/promises";
import { liveReportSchema } from "../../packages/live-diagnostics";
function fixture(compact: boolean, suffix = "one") {
  return `<!doctype html><html lang="en"><head><style>body{font:16px sans-serif;margin:24px}label{display:inline-block;padding:10px}input[type=radio]{width:20px;height:20px}.spacer{height:1800px}h2{scroll-margin-top:30px}</style></head><body>
<h1>A completely unseen library</h1><form role="search"><label for="field-${suffix}">Search library</label><input type="search" id="field-${suffix}"><button>Search</button></form>
<details ${compact ? "" : "open"}><summary>Appearance</summary><fieldset><legend>Color</legend><input type="radio" name="theme" id="light-${suffix}" checked><label for="light-${suffix}">Light</label><input type="radio" name="theme" id="dark-${suffix}"><label for="dark-${suffix}">Dark</label></fieldset><fieldset><legend>Text size</legend><input type="radio" name="size" id="normal-${suffix}" checked><label for="normal-${suffix}">Standard</label><input type="radio" name="size" id="large-${suffix}"><label for="large-${suffix}">Large</label></fieldset></details>
<nav aria-label="Contents"><a href="#sources-${suffix}">2 References</a></nav><a href="/library/next">Next article</a><a href="https://example.com/">Another website</a><button>Delete account</button>
<input type="password" value="SENTINEL_PASSWORD"><div contenteditable>SENTINEL_MESSAGE</div><div class="spacer"></div><h2 id="sources-${suffix}">References</h2><div style="height:900px"></div></body></html>`;
}
async function prepare(info: any) {
  const app = await openNavigatorExtension(info.project.use.viewport);
  await app.context.route("http://localhost:5173/library/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: fixture(
        info.project.name === "narrow",
        r.request().url().endsWith("next") ? "two" : "one",
      ),
    }),
  );
  await app.page.goto("http://localhost:5173/library/unseen");
  await app.start();
  return app;
}

test("live inspector explains goal candidates and exports private verification evidence without changing navigation", async ({}, info) => {
  const app = await prepare(info);
  try {
    await app.page.locator("input[type=search]").fill("SENTINEL_QUERY");
    await goal(app, "make text larger");
    const before = await app.view();
    await app.panel
      .getByText("Local route tools", { exact: true })
      .evaluate((e) => (e as HTMLElement).click());
    await app.panel
      .getByLabel("Show route debug inspector")
      .evaluate((e) => (e as HTMLInputElement).click());
    const inspector = app.panel.getByRole("region", {
      name: "Route debug inspector",
    });
    await expect(inspector).toContainText("Live observation");
    await expect(
      inspector.getByRole("table", { name: "Live target candidates" }),
    ).toContainText("selected");
    expect((await app.view()).selectedControlId).toBe(before.selectedControlId);
    if (info.project.name === "narrow")
      await app.page.getByText("Appearance", { exact: true }).click();
    await app.page.getByLabel("Large", { exact: true }).check();
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("completed");
    await expect(inspector).toContainText("checked-change");
    const download = app.panel.waitForEvent("download");
    await inspector
      .getByRole("button", { name: "Export diagnostics" })
      .evaluate((e) => (e as HTMLButtonElement).click());
    const report = liveReportSchema.parse(
      JSON.parse(await readFile((await (await download).path())!, "utf8")),
    );
    expect(
      report.diagnostics!.events.some(
        (e) => e.outcome === "verified" && e.evidence === "checked-change",
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(
      /SENTINEL|localhost|\/library|"goal":"|"label":"/,
    );
    const selected = (await app.view()).selectedControlId;
    await app.panel
      .getByLabel("Show route debug inspector")
      .evaluate((e) => (e as HTMLInputElement).click());
    expect((await app.view()).selectedControlId).toBe(selected);
    await app.panel
      .getByLabel("Show route debug inspector")
      .evaluate((e) => (e as HTMLInputElement).click());
    await inspector.screenshot({
      path: `output/qa/live-inspector-${info.project.name}.png`,
    });
  } finally {
    await app.close();
  }
});
test("open shadow roots refresh and verify controls without reading field values", async ({}, info) => {
  const app = await prepare(info);
  try {
    await app.page.evaluate(() => {
      const host = document.createElement("custom-box");
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = '<button aria-expanded="false">Open details</button>';
      shadow.querySelector("button")!.addEventListener("click", () => {
        shadow.querySelector("button")!.setAttribute("aria-expanded", "true");
        const label = document.createElement("label");
        label.id = "field-label";
        label.textContent = "Search component";
        const field = document.createElement("input");
        field.type = "search";
        field.setAttribute("aria-labelledby", "field-label");
        shadow.append(label, field);
      });
      document.body.prepend(host);
    });
    await expect
      .poll(async () =>
        (await app.view()).controls?.some(
          (c: any) => c.label === "Open details",
        ),
      )
      .toBe(true);
    await guide(app, "Open details");
    await app.page
      .getByRole("button", { name: "Open details", exact: true })
      .click();
    await expect.poll(async () => (await app.view()).verifiedSteps).toBe(1);
    await expect
      .poll(async () =>
        (await app.view()).controls?.some(
          (c: any) => c.label === "Search component",
        ),
      )
      .toBe(true);
    await guide(app, "Search component");
    await app.page.locator("custom-box input").click();
    await expect.poll(async () => (await app.view()).verifiedSteps).toBe(2);
    await app.page.locator("custom-box input").fill("SENTINEL_SHADOW_QUERY");
    await app.page.evaluate(() => {
      const button = document.createElement("button");
      button.textContent = "Extra help";
      document.querySelector("custom-box")!.shadowRoot!.append(button);
    });
    await expect
      .poll(async () =>
        (await app.view()).controls?.some((c: any) => c.label === "Extra help"),
      )
      .toBe(true);
    const memory = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_MEMORY" }),
    );
    expect(JSON.stringify(memory)).not.toContain("SENTINEL");
  } finally {
    await app.close();
  }
});
test("same-document navigation with replaced DOM verifies once and preserves the session", async ({}, info) => {
  const app = await prepare(info);
  try {
    const before = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_SESSION" }),
    );
    await goal(app, "Next article");
    await app.page.evaluate(() =>
      document
        .querySelector('a[href="/library/next"]')!
        .addEventListener("click", (event) => {
          event.preventDefault();
          history.pushState(null, "", "/library/next");
          document.body.innerHTML =
            "<h1>New SPA article</h1><button>Help</button>";
        }),
    );
    await app.page
      .getByRole("link", { name: "Next article", exact: true })
      .click();
    await expect
      .poll(async () => (await app.view()).page?.path)
      .toBe("/library/next");
    await expect.poll(async () => (await app.view()).verifiedSteps).toBe(1);
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("completed");
    const after = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_SESSION" }),
    );
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.documentId).toBe(before.documentId);
  } finally {
    await app.close();
  }
});
async function goal(app: Awaited<ReturnType<typeof prepare>>, text: string) {
  await app.page.bringToFront();
  const reply = await app.panel.evaluate(async (goal) => {
    const context = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
    return chrome.runtime.sendMessage({
      type: "SET_GOAL",
      goal,
      revision: context.page.revision,
    });
  }, text);
  expect(reply.error).toBeUndefined();
  return reply.view.goalPlan;
}
async function guide(app: Awaited<ReturnType<typeof prepare>>, label: string) {
  await app.page.bringToFront();
  const reply = await app.panel.evaluate(async (label) => {
    const view = (await chrome.runtime.sendMessage({ type: "GET_SESSION" }))
      .view;
    const c = view.controls.find((c: any) => c.label === label);
    return chrome.runtime.sendMessage({
      type: "GUIDE_CONTROL",
      controlId: c.id,
    });
  }, label);
  expect(reply.error).toBeUndefined();
}

test("edit entry points use page and section context, then stop at publishing or an undeclared edit effect", async ({}, info) => {
  const app = await prepare(info);
  try {
    await app.context.route("http://localhost:5173/document-editor**", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<html><body><h1>Document editor</h1><form method="post" action="/edit"><input aria-label="Draft title"><button>Publish changes</button><button type="button">Edit</button></form></body></html>',
      }),
    );
    await app.page.evaluate(() => {
      const nav = document.createElement("nav");
      nav.innerHTML = '<a href="/document-editor">Edit</a>';
      document.body.prepend(nav);
      const sections = document.createElement("main");
      sections.innerHTML =
        '<div><h2>Abstract</h2><span><a href="/document-editor?section=1">edit</a></span></div><div><h2>Background</h2><span><a href="/document-editor?section=2">edit</a></span></div>';
      document.body.append(sections);
    });
    for (const text of ["Edit", "How do I edit this page?"]) {
      expect((await goal(app, text)).status).toBe("guiding");
      const view = await app.view();
      expect(view.instruction).toContain("link to open its destination");
      expect(view.instruction).not.toContain("menu");
      expect(
        view.page.controls.find((c: any) => c.id === view.selectedControlId),
      ).toMatchObject({ label: "Edit", scope: "page", risk: "ordinary" });
    }
    const sectionPlan = await goal(app, "Edit section Abstract");
    expect(sectionPlan.status).toBe("guiding");
    const section = await app.view();
    expect(
      section.page.controls.find(
        (c: any) => c.id === section.selectedControlId,
      ),
    ).toMatchObject({ label: "edit", context: "Abstract", scope: "section" });
    await goal(app, "Edit");
    await app.page.getByRole("link", { name: "Edit", exact: true }).click();
    await expect(
      app.page.getByRole("heading", { name: "Document editor" }),
    ).toBeVisible();
    await expect
      .poll(async () => (await app.view()).goalPlan?.status, { timeout: 10000 })
      .toBe("completed");
    expect((await app.view()).verifiedSteps).toBe(1);
    expect((await goal(app, "Draft title")).status).toBe("guiding");
    expect((await goal(app, "Publish changes")).issue).toBe("consequential");
    const plan = app.panel.getByRole("region", { name: "Goal plan" });
    await expect(plan.getByRole("heading")).toHaveText("Review required");
    await expect(plan).toContainText("Action boundary");
    await expect(plan).not.toContainText("Uncertain match");
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    expect((await goal(app, "Edit")).issue).toBe("unknown-effect");
    await expect(plan.getByRole("heading")).toHaveText(
      "Control effect unclear",
    );
    await expect(plan).not.toContainText("performs a consequential action");
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
  } finally {
    await app.close();
  }
});

test("language intent selects the primary popup, awaits a choice, then verifies the chosen destination", async ({}, info) => {
  const app = await prepare(info);
  try {
    await app.context.route("http://localhost:5173/library/french", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<html lang="fr"><body><h1>Document en français</h1></body></html>',
      }),
    );
    await app.page.evaluate(() => {
      const strip = document.createElement("div");
      strip.innerHTML =
        '<input type="checkbox" role="button" aria-haspopup="true" aria-label="Languages (7)" aria-description="Read this document in another language" aria-controls="choices-random" id="opener-random"><label for="opener-random" aria-hidden="true">Languages (7)</label><div id="choices-random" hidden><nav aria-label="Suggested languages"><a href="/library/french">French</a></nav><nav aria-label="All languages"><a href="/library/french">French</a></nav></div><details><summary>More controls</summary><button>Change language variant</button></details><button hidden>Languages (7)</button>';
      document.body.prepend(strip);
      const input = strip.querySelector("input")!;
      input.addEventListener(
        "change",
        () =>
          (strip.querySelector<HTMLElement>("#choices-random")!.hidden =
            !input.checked),
      );
    });
    const plan = await goal(app, "Show me how to change language");
    expect(plan.status).toBe("guiding");
    expect(plan.steps.map((s: any) => s.label)).toEqual(["Languages (7)"]);
    const before = await app.view();
    expect(
      before.page.controls.find((c: any) => c.id === before.selectedControlId)
        .kind,
    ).toBe("expand");
    await app.page
      .getByRole("button", { name: "Languages (7)", exact: true })
      .click();
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("awaiting-choice");
    await expect(
      app.page.getByRole("link", { name: "French", exact: true }).first(),
    ).toBeVisible();
    expect((await app.view()).verifiedSteps).toBe(1);
    expect((await goal(app, "Change language")).status).toBe("awaiting-choice");
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    const next = await goal(app, "French");
    expect(next.steps.map((s: any) => s.label)).toEqual(["French"]);
    await app.page
      .getByRole("link", { name: "French", exact: true })
      .first()
      .click();
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("completed");
    expect((await app.view()).page.language).toBe("fr");
    expect((await app.view()).verifiedSteps).toBe(2);
    const events = (await app.view()).liveDiagnostics.events;
    expect(
      events.some((e: any) => e.outcome === "verified" && e.kind === "expand"),
    ).toBe(true);
    expect(
      events.some(
        (e: any) =>
          e.outcome === "verified" && e.evidence === "destination-arrival",
      ),
    ).toBe(true);
  } finally {
    await app.close();
  }
});

test("detached popups need matching purpose and user interaction, and description changes rescan the target", async ({}, info) => {
  const app = await prepare(info);
  try {
    await app.page.evaluate(() => {
      const button = document.createElement("button");
      button.textContent = "Categories (3)";
      button.setAttribute("aria-haspopup", "dialog");
      button.addEventListener("click", () => {
        const popup = document.createElement("div");
        popup.setAttribute("role", "dialog");
        popup.setAttribute("aria-label", "Categories");
        popup.innerHTML =
          '<input type="search" aria-label="Search categories"><button>History</button>';
        document.body.append(popup);
        popup.querySelector("input")!.focus();
      });
      document.body.prepend(button);
    });
    await goal(app, "Show category");
    await app.page.evaluate(() => {
      const popup = document.createElement("div");
      popup.setAttribute("role", "dialog");
      popup.setAttribute("aria-label", "Notifications");
      popup.innerHTML =
        '<input type="search" aria-label="Search notifications">';
      document.body.append(popup);
      popup.querySelector("input")!.focus();
    });
    // GET_PAGE performs a fresh scan; a visible but unrelated popup is not completion evidence.
    const stillGuiding = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_PAGE" }),
    );
    expect(
      stillGuiding.page.controls.find((c: any) => c.label === "Categories (3)")
        .expanded,
    ).not.toBe(true);
    expect((await app.view()).verifiedSteps).toBe(0);
    expect((await app.view()).goalPlan.status).toBe("guiding");
    await app.page
      .getByRole("button", { name: "Categories (3)", exact: true })
      .click();
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("awaiting-choice");
    expect((await app.view()).verifiedSteps).toBe(1);
    await app.page.evaluate(() => {
      const button = document.createElement("button");
      button.textContent = "🌐";
      button.setAttribute("aria-description", "Change language");
      button.setAttribute("aria-haspopup", "listbox");
      document.body.prepend(button);
    });
    const plan = await goal(app, "Change language");
    expect(plan.steps[0].label).toBe("🌐");
    const old = (await app.view()).selectedControlId;
    await app.page
      .getByRole("button", { name: "🌐", exact: true })
      .evaluate((e) => e.setAttribute("aria-description", "Change currency"));
    await expect
      .poll(async () => (await app.view()).selectedControlId)
      .toBeUndefined();
    expect((await app.view()).goalPlan.status).toBe("unresolved");
    const latest = await goal(app, "Change currency");
    expect(latest.steps[0].controlId).toBe(old);
    const memory = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_MEMORY" }),
    );
    expect(
      memory.memory.pages[0].controls.some(
        (c: any) => c.description === "Change language" && c.active === false,
      ),
    ).toBe(true);
  } finally {
    await app.close();
  }
});
test("generic discovery plans menu and preference steps, validates arrival, and redacts memory", async ({}, info) => {
  const app = await prepare(info);
  try {
    const plan = await goal(app, "switch to dark mode");
    expect(plan.steps.map((s: any) => s.label)).toEqual(
      info.project.name === "narrow"
        ? ["Appearance", "Color: Dark"]
        : ["Color: Dark"],
    );
    if (info.project.name === "narrow") {
      await app.page.getByText("Appearance", { exact: true }).click();
      await expect
        .poll(async () => (await app.view()).selectedControlId)
        .toBe(
          (await app.view()).controls.find(
            (c: any) => c.label === "Color: Dark",
          )?.id,
        );
    }
    await app.page.locator("#dark-one").check();
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("completed");
    expect((await app.view()).verifiedSteps).toBe(
      info.project.name === "narrow" ? 2 : 1,
    );
    await goal(app, "make text larger");
    await app.page.locator("#large-one").check();
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("completed");
    await guide(app, "Search library");
    await app.page.locator("input[type=search]").click();
    await app.page.locator("input[type=search]").fill("SENTINEL_QUERY");
    await goal(app, "find references");
    expect((await app.view()).goalPlan.status).toBe("guiding");
    await app.page.locator('a[href="#sources-one"]').click();
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("completed");
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    const data = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_MEMORY" }),
    );
    expect(data.memory.pages.length).toBe(1);
    expect(
      data.memory.transitions.some((t: any) => t.evidence === "observed"),
    ).toBe(true);
    expect(JSON.stringify(data)).not.toContain("SENTINEL");
    await app.panel.screenshot({
      path: `output/qa/generic-panel-${info.project.name}.png`,
    });
  } finally {
    await app.close();
  }
});
test("page loads verify the actual destination, reject stale IDs, preserve pause and stop", async ({}, info) => {
  const app = await prepare(info);
  try {
    const old = (await app.view()).controls[0].id;
    await goal(app, "Next article");
    await app.page
      .getByRole("link", { name: "Next article", exact: true })
      .click();
    await expect
      .poll(async () => (await app.view()).page?.path)
      .toBe("/library/next");
    await expect.poll(async () => (await app.view()).verifiedSteps).toBe(1);
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("completed");
    const stale = await app.panel.evaluate(
      async (controlId) =>
        chrome.runtime.sendMessage({ type: "GUIDE_CONTROL", controlId }),
      old,
    );
    expect(stale.error).toContain("stale");
    await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "PAUSE" }),
    );
    await app.page.goto("http://localhost:5173/library/another");
    await expect.poll(async () => (await app.view()).status).toBe("paused");
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    await app.page.bringToFront();
    await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "RESUME" }),
    );
    await expect
      .poll(async () => (await app.view()).controls?.length)
      .toBeGreaterThan(0);
    await app.stop();
    await app.page.goto("http://localhost:5173/library/stopped");
    await expect.poll(async () => (await app.view()).status).toBe("stopped");
  } finally {
    await app.close();
  }
});
test("changed controls invalidate pending plans and memory, and forgetting stops observation", async ({}, info) => {
  const app = await prepare(info);
  try {
    await guide(app, "Search library");
    const old = (await app.view()).selectedControlId;
    await app.page.evaluate(() => {
      const field = document.querySelector("input[type=search]")!;
      const next = field.cloneNode() as HTMLInputElement;
      next.id = "different";
      next.setAttribute("aria-label", "Search archive");
      field.replaceWith(next);
    });
    await expect
      .poll(async () => (await app.view()).selectedControlId)
      .toBeUndefined();
    const result = await app.panel.evaluate(
      async (controlId) =>
        chrome.runtime.sendMessage({ type: "GUIDE_CONTROL", controlId }),
      old,
    );
    expect(result.error).toContain("stale");
    await expect
      .poll(async () =>
        (await app.view()).controls?.some(
          (c: any) => c.label === "Search archive",
        ),
      )
      .toBe(true);
    const data = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_MEMORY" }),
    );
    expect(data.memory.pages[0].version).toBeGreaterThan(1);
    expect(
      data.memory.pages[0].controls.find(
        (c: any) => c.label === "Search library",
      ).active,
    ).toBe(false);
    await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "FORGET_SITE" }),
    );
    await expect.poll(async () => (await app.view()).status).toBe("stopped");
    await app.page.evaluate(() => {
      const button = document.createElement("button");
      button.textContent = "New control";
      document.body.append(button);
    });
    const forgotten = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_MEMORY" }),
    );
    expect(forgotten.memory).toBeUndefined();
  } finally {
    await app.close();
  }
});
test("goal form uses semantic fallback, model proposals are checked, and consequential controls stop guidance", async ({}, info) => {
  const app = await prepare(info);
  try {
    await app.panel.getByLabel("Navigation goal").fill("Search library");
    await app.page.bringToFront();
    await app.panel
      .getByRole("button", { name: "Find a route", exact: true })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect
      .poll(async () => (await app.view()).goalPlan?.source)
      .toBe("semantics");
    await guide(app, "Delete account");
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    expect((await app.view()).instruction).toContain("consequential");
    const invented = await app.panel.evaluate(async () => {
      const context = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
      return chrome.runtime.sendMessage({
        type: "SET_GOAL",
        goal: "Help",
        revision: context.page.revision,
        proposal: { controlIds: ["w0000000000000000-999"], confidence: 1 },
      });
    });
    expect(invented.view.goalPlan.status).toBe("unresolved");
    const current = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_PAGE" }),
    );
    await app.page.evaluate(() => {
      const b = document.createElement("button");
      b.textContent = "Help";
      document.body.append(b);
    });
    const stale = await app.panel.evaluate(
      async (revision) =>
        chrome.runtime.sendMessage({
          type: "SET_GOAL",
          goal: "Help",
          revision,
        }),
      current.page.revision,
    );
    expect(stale.error).toContain("page changed");
  } finally {
    await app.close();
  }
});
test("site knowledge survives a complete browser restart and clear-all removes it", async ({}, info) => {
  const app = await prepare(info);
  try {
    await goal(app, "Search library");
    await app.page.locator("input[type=search]").click();
    const before = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_MEMORY" }),
    );
    await app.stop();
    await app.restart();
    await app.context.route("http://localhost:5173/library/**", (r) =>
      r.fulfill({ contentType: "text/html", body: fixture(false, "new") }),
    );
    await app.page.goto("http://localhost:5173/library/unseen");
    await app.page.bringToFront();
    const after = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_MEMORY" }),
    );
    expect(after.memory.pages[0].fingerprint).toBe(
      before.memory.pages[0].fingerprint,
    );
    expect(after.memory.version).toBe(before.memory.version);
    await app.start();
    await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "CLEAR_MEMORY" }),
    );
    expect((await app.view()).status).toBe("stopped");
    expect(
      (
        await app.panel.evaluate(async () =>
          chrome.runtime.sendMessage({ type: "GET_MEMORY" }),
        )
      ).memory,
    ).toBeUndefined();
  } finally {
    await app.close();
  }
});
