import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApi } from "../../apps/api/src/server";
const first =
  '<!doctype html><html lang="en"><body><h1>Workspace</h1><details><summary>Languages</summary><fieldset><legend>Language</legend><label><input type="radio" name="language" checked>English</label><label><input type="radio" name="language">Spanish</label></fieldset></details><a href="/nlp/preferences">Preferences</a><nav aria-label="Page"><details><summary>Settings</summary><button>Help</button></details></nav><nav aria-label="Account"><details><summary>Settings</summary><button>Profile</button></details></nav><form action="/nlp/results"><label>Search<input type="search" name="q"></label><button>Search</button></form></body></html>';
const preferences =
  '<!doctype html><html lang="en"><body><h1>Preferences</h1><fieldset><legend>Text size</legend><label><input type="radio" name="size" checked>Standard</label><label><input type="radio" name="size">Large</label></fieldset></body></html>';
type App = Awaited<ReturnType<typeof openNavigatorExtension>>;
async function prepare() {
  const app = await openNavigatorExtension();
  await app.context.route("http://localhost:5173/nlp/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: r.request().url().includes("preferences")
        ? preferences
        : r.request().url().includes("destination")
          ? '<html lang="en"><h1>Saturn</h1><a href="#Saturn">Saturn</a><h2 id="Saturn">Saturn</h2></html>'
          : r.request().url().includes("results")
            ? '<html lang="en"><h1>Search results</h1><a href="/nlp/destination">Saturn</a><a href="/nlp/wrong">Jupiter</a></html>'
            : first,
    }),
  );
  await app.page.goto("http://localhost:5173/nlp/start");
  await app.start();
  return app;
}
async function goal(app: App, text: string) {
  const reply = await app.panel.evaluate(async (goal) => {
    const page = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
    return chrome.runtime.sendMessage({
      type: "SET_GOAL",
      goal,
      revision: page.page.revision,
    });
  }, text);
  expect(reply.error, JSON.stringify(reply)).toBeUndefined();
  return reply.view;
}
async function selected(app: App, label: string) {
  await expect
    .poll(
      async () => {
        const v = await app.view();
        return v?.page?.controls.find((c: any) => c.id === v.selectedControlId)
          ?.label;
      },
      { timeout: 15000 },
    )
    .toBe(label);
}
test("blocked durable memory cannot hold menu guidance or Stop, and Clear drains older writes", async () => {
  const app = await prepare();
  try {
    await goal(app, "Show languages");
    await app.panel.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("navigator-site-memory", 5);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction(
        ["sites", "embeddings", "indexes"],
        "readwrite",
      );
      let hold = true;
      const done = new Promise<void>((resolve) => {
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      });
      (window as any).releaseMemory = async () => {
        hold = false;
        await done;
      };
      await new Promise<void>((resolve) => {
        const pump = () => {
          const request = tx.objectStore("sites").get("http://localhost:5173");
          request.onsuccess = () => {
            resolve();
            if (hold) pump();
          };
        };
        pump();
      });
    });
    await app.page
      .locator("summary")
      .filter({ hasText: /^Languages$/ })
      .click();
    await expect
      .poll(async () => (await app.view()).goalPlan?.status, { timeout: 2000 })
      .toBe("awaiting-choice");
    const preference = await goal(app, "Change language to Spanish");
    await app.page.getByLabel("English", { exact: true }).check();
    expect((await app.view()).goalPlan.status).toBe("guiding");
    await app.page.getByLabel("Spanish", { exact: true }).check();
    await expect
      .poll(async () => (await app.view()).goalPlan?.status, { timeout: 1500 })
      .toBe("completed");
    expect((await app.view()).request.status).toBe("completed");
    const completedSteps = (await app.view()).verifiedSteps;
    const stale = await app.panel.evaluate(async (previous) => {
      const session = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
      return chrome.tabs.sendMessage(session.tabId, {
        type: "INSTALL_REQUEST",
        sessionId: session.sessionId,
        result: {
          status: "plan",
          requestId: previous.request.id,
          documentId: session.documentId,
          revision: previous.page.revision,
          request: previous.request,
          plan: previous.goalPlan,
          reason: previous.goalPlan.reason,
          canonicalGoal: previous.journey.canonicalGoal,
          activity: previous.embeddingActivity,
          protocolVersion: 2,
          contextRevision: 0,
        },
      });
    }, preference);
    expect(stale.error).toBeUndefined();
    expect(stale.view.goalPlan.status).toBe("completed");
    expect(stale.view.request.status).toBe("completed");
    expect(stale.view.verifiedSteps).toBe(completedSteps);
    expect(stale.view.selectedControlId).toBeUndefined();
    const queryStarted = performance.now();
    const missing = await goal(app, "Find the unicorn portal");
    expect(missing.goalPlan.status).toBe("unresolved");
    expect(missing.selectedControlId).toBeUndefined();
    expect(performance.now() - queryStarted).toBeLessThan(2000);
    const started = performance.now();
    await app.stop();
    expect(performance.now() - started).toBeLessThan(1000);
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    await app.panel.evaluate(() => (window as any).releaseMemory());
    const cleared = await app.panel.evaluate(() =>
      chrome.runtime.sendMessage({ type: "CLEAR_MEMORY" }),
    );
    expect(cleared.error).toBeUndefined();
    const counts = await app.panel.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("navigator-site-memory", 5);
        r.onsuccess = () => resolve(r.result);
      });
      try {
        return await Promise.all(
          ["sites", "tasks"].map(
            (name) =>
              new Promise<number>((resolve) => {
                const r = db.transaction(name).objectStore(name).count();
                r.onsuccess = () => resolve(r.result);
              }),
          ),
        );
      } finally {
        db.close();
      }
    });
    expect(counts).toEqual([0, 0]);
  } finally {
    await app.panel
      .evaluate(() => (window as any).releaseMemory?.())
      .catch(() => {});
    await app.close();
  }
});
test("bundled CPU inference works offline and three tasks continue through a menu and a document", async () => {
  const app = await prepare();
  try {
    await app.context.setOffline(true);
    const coldStart = performance.now();
    await goal(app, "Could you help me find Preferences?");
    const coldPlanningMs = performance.now() - coldStart;
    const timings: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      await goal(app, "Could you help me find Preferences?");
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    const warmPlanningP95Ms = timings[Math.floor(timings.length * 0.95)];
    expect(warmPlanningP95Ms).toBeLessThan(750);
    await mkdir("output/nlp", { recursive: true });
    await writeFile(
      "output/nlp/browser-performance.json",
      JSON.stringify(
        {
          coldPlanningMs,
          warmPlanningP95Ms,
          samples: timings.length,
          browser: app.context.browser()!.version(),
          fixtureControls: (await app.view()).page.controls.length,
          offline: true,
        },
        null,
        2,
      ),
    );
    const view = await goal(
      app,
      "Could you help me change language to Spanish and then open Preferences and then choose Large?",
    );
    expect(view.request.tasks).toHaveLength(3);
    expect(view.embeddingActivity.embedded).toBeGreaterThan(0);
    expect(view.embeddingActivity.llmCalls).toBe(0);
    await selected(app, "Languages");
    await app.page.getByText("Languages", { exact: true }).click();
    await selected(app, "Language: Spanish");
    await app.page.getByLabel("Spanish", { exact: true }).check();
    await selected(app, "Preferences");
    await app.context.setOffline(false);
    await app.page
      .getByRole("link", { name: "Preferences", exact: true })
      .click();
    await selected(app, "Text size: Large");
    const finalTask = await app.view();
    expect(finalTask.journey.goal).toBe("choose Large");
    expect(finalTask.journey.canonicalGoal).toBe("Large");
    expect(finalTask.journey.requestTaskId).toBe(finalTask.request.tasks[2].id);
    await app.page.getByLabel("Large", { exact: true }).check();
    await expect
      .poll(async () => (await app.view()).request.status)
      .toBe("completed");
    expect((await app.view()).request.tasks.map((t: any) => t.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
  } finally {
    await app.close();
  }
});
test("clarification keeps the sentence and binds a grounded choice; pause retains and Stop cancels", async () => {
  const app = await prepare();
  try {
    const v = await goal(app, "Could you show me settings?");
    expect(v.clarification.choices).toHaveLength(2);
    expect(v.request.original).toBe("Could you show me settings?");
    const choice = v.clarification.choices.find((c: any) =>
      /Account/.test(c.label),
    );
    expect(choice).toBeDefined();
    const r = await app.panel.evaluate(
      async (choice) => chrome.runtime.sendMessage({ type: "CLARIFY", choice }),
      choice.id,
    );
    expect(r.error).toBeUndefined();
    await selected(app, "Settings");
    await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "PAUSE" }),
    );
    expect((await app.view()).request.status).toBe("paused");
    await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "RESUME" }),
    );
    await app.stop();
    expect((await app.view()).request.status).toBe("canceled");
    expect((await app.view()).request.tasks[0].status).not.toBe("completed");
  } finally {
    await app.close();
  }
});
test("opening a menu finishes that explicit task before a compatible pronoun task starts", async () => {
  const app = await prepare();
  try {
    await goal(app, "Please open languages and then change it to Spanish.");
    await selected(app, "Languages");
    await app.page.getByText("Languages", { exact: true }).click();
    await selected(app, "Language: Spanish");
    const v = await app.view();
    expect(v.request.active).toBe(1);
    expect(v.request.tasks[0].status).toBe("completed");
    expect(v.request.tasks[1].target.toLowerCase()).toBe("languages");
    await app.page.getByLabel("Spanish", { exact: true }).check();
    await expect
      .poll(async () => (await app.view()).request.status)
      .toBe("completed");
  } finally {
    await app.close();
  }
});
test("a plain task queue survives an expected popup and explicit continuation", async () => {
  const app = await prepare();
  try {
    await app.page
      .getByRole("link", { name: "Preferences", exact: true })
      .evaluate((el) => el.setAttribute("target", "_blank"));
    await goal(app, "Open Preferences and then choose Large.");
    await selected(app, "Preferences");
    const popupPromise = app.context.waitForEvent("page");
    await app.page
      .getByRole("link", { name: "Preferences", exact: true })
      .click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await expect
      .poll(async () => (await app.view()).continuationOrigin)
      .toBe("http://localhost:5173");
    await popup.bringToFront();
    const reply = await app.panel.evaluate(() =>
      chrome.runtime.sendMessage({ type: "CONTINUE_TASK" }),
    );
    expect(reply.error).toBeUndefined();
    await selected(app, "Text size: Large");
    expect((await app.view()).request.active).toBe(1);
    await popup.getByLabel("Large", { exact: true }).check();
    await expect
      .poll(async () => (await app.view()).request.status)
      .toBe("completed");
  } finally {
    await app.close();
  }
});
test("search retains the query, never completes on field focus, and waits for the requested result arrival", async () => {
  const app = await prepare();
  try {
    await goal(app, "Please search for Saturn and then open Languages.");
    await selected(app, "Search");
    await app.page.getByRole("searchbox").focus();
    await expect
      .poll(async () => (await app.view()).request.tasks[0].searchPhase)
      .toBe("results");
    expect((await app.view()).request.active).toBe(0);
    await app.panel.evaluate(() =>
      chrome.runtime.sendMessage({ type: "PAUSE" }),
    );
    await app.page.evaluate(() => {
      const a = document.createElement("a");
      a.id = "async-result";
      a.href = "/nlp/destination";
      a.textContent = "Saturn";
      document.body.append(a);
    });
    await app.panel.evaluate(() =>
      chrome.runtime.sendMessage({ type: "RESUME" }),
    );
    await selected(app, "Saturn");
    expect((await app.view()).request.active).toBe(0);
    await app.page.locator("#async-result").evaluate((el) => el.remove());
    await app.page.getByRole("searchbox").fill("Saturn");
    await app.page.getByRole("button", { name: "Search", exact: true }).click();
    await selected(app, "Saturn");
    expect((await app.view()).request.active).toBe(0);
    await app.page.getByRole("link", { name: "Saturn", exact: true }).click();
    await expect
      .poll(async () => (await app.view()).request.active, { timeout: 15000 })
      .toBe(1);
    expect((await app.view()).request.tasks[0].desiredValue).toBe("Saturn");
    expect((await app.view()).request.tasks[0].status).toBe("completed");
  } finally {
    await app.close();
  }
});
test("backend outage falls back locally, migration preserves knowledge, restart and Forget remove derived data", async () => {
  const app = await prepare();
  try {
    await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({
        type: "SET_BACKEND",
        url: "http://127.0.0.1:1",
        token: "a".repeat(64),
        enabled: true,
      }),
    );
    await goal(app, "Please open languages.");
    const before = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_MEMORY" }),
    );
    expect(before.memory.pages.length).toBeGreaterThan(0);
    await app.stop();
    await app.restart();
    await app.page.goto("http://localhost:5173/nlp/start");
    await app.start();
    const memory = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_MEMORY" }),
    );
    expect(memory.memory.pages.length).toBeGreaterThan(0);
    await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "FORGET_SITE" }),
    ); // disconnected mirror failure is surfaced, browser deletion already happened
    const deleted = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_MEMORY" }),
    );
    expect(deleted.memory).toBeUndefined();
    await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({
        type: "SET_BACKEND",
        url: "http://127.0.0.1:8787",
        token: "",
        enabled: false,
      }),
    );
    const derived = await app.panel.evaluate(
      () =>
        new Promise<any>((resolve, reject) => {
          const r = indexedDB.open("navigator-site-memory");
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction(["indexes", "embeddings"]);
            let indexes = 0,
              embeddings = 0;
            const a = tx.objectStore("indexes").count(),
              b = tx.objectStore("embeddings").count();
            a.onsuccess = () => {
              indexes = a.result;
            };
            b.onsuccess = () => {
              embeddings = b.result;
            };
            tx.oncomplete = () => {
              db.close();
              resolve({ indexes, embeddings });
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    expect(derived).toEqual({ indexes: 0, embeddings: 0 });
  } finally {
    await app.close();
  }
});
test("browser CPU and optional HTTP service return the same grounded plan and recover from API failure", async () => {
  const app = await prepare(),
    directory = await mkdtemp(join(tmpdir(), "navigator-browser-api-")),
    token = "b".repeat(64);
  const api = await createApi({
    token,
    origins: ["chrome-extension://" + new URL(app.worker.url()).host],
    database: join(directory, "mirror.sqlite"),
    models: resolve("assets/models"),
    worker: new URL("../../apps/api/dist/inference.js", import.meta.url),
  });
  let remotePlans = 0;
  api.addHook("onResponse", async (request) => {
    if (/^\/v[12]\/plans$/.test(request.url)) remotePlans++;
  });
  try {
    const local = await goal(app, "Can you help me find Preferences?");
    await api.listen({ host: "127.0.0.1", port: 0 });
    const address = api.server.address();
    if (!address || typeof address === "string") throw new Error("No API port");
    await app.panel.evaluate(
      async (settings) =>
        chrome.runtime.sendMessage({ type: "SET_BACKEND", ...settings }),
      { url: "http://127.0.0.1:" + address.port, token, enabled: true },
    );
    const remote = await goal(app, "Can you help me find Preferences?");
    expect(remotePlans).toBe(1);
    expect(remote.goalPlan).toEqual(local.goalPlan);
    await api.close();
    const fallback = await goal(app, "Can you help me find Preferences?");
    expect(fallback.goalPlan).toEqual(local.goalPlan);
    expect(fallback.embeddingActivity.cacheHits).toBeGreaterThan(0);
  } finally {
    await api.close();
    await app.close();
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(tmpdir())) ||
      !target.includes("navigator-browser-api-")
    )
      throw new Error("Unsafe test cleanup");
    await rm(target, { recursive: true, force: true });
  }
});
