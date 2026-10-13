import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import { buildProvenance } from "../support/build-provenance";
let bundle: string;
test.beforeAll(async () => {
  bundle = (
    await build({
      entryPoints: ["tests/multi-app-browser/runtime-entry.ts"],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: "chrome120",
    })
  ).outputFiles[0].text;
});
async function load(page: any, body: string) {
  await page.goto("http://127.0.0.1:5173");
  await page.setContent(body);
  await page.addScriptTag({ content: bundle });
}
test("nested dialogs, recycled nodes, open shadow roots, editable metadata and occlusion stay grounded", async ({
  page,
}) => {
  await load(
    page,
    '<nav><a href="/home">Home</a></nav><button aria-label="Menu" aria-expanded="false" aria-controls="menu">Menu</button><div id="menu" role="menu" hidden><button role="menuitem">Account</button></div><div role="combobox" aria-label="Repository" contenteditable="true">private editor contents</div><div role="listbox" aria-label="Results"><div role="option" id="recycled" aria-setsize="10000">First item</div></div><div id="host"></div>',
  );
  await page.evaluate(() => {
    const s = (window as any).fixtureEngine;
    s.discovery = new s.PageDiscovery();
    s.stop = s.discovery.observe(() => (s.page = s.discovery.snapshot()));
    s.page = s.discovery.snapshot();
  });
  const controls = () =>
    page.evaluate(
      () => (window as any).fixtureEngine.discovery.snapshot().controls,
    );
  expect(JSON.stringify(await controls())).not.toContain(
    "private editor contents",
  );
  const before = (await controls()).find((c: any) =>
    c.label.endsWith("First item"),
  );
  await page.evaluate(() => {
    document.querySelector("#recycled")!.textContent = "Second item";
    document.querySelector("#host")!.attachShadow({ mode: "open" }).innerHTML =
      '<button aria-label="Shadow control">Open</button>';
    document.querySelector("#menu")!.removeAttribute("hidden");
    const d = document.createElement("dialog");
    d.innerHTML =
      '<h2>Review</h2><button aria-label="Confirm choices">Confirm</button>';
    document.body.append(d);
    d.showModal();
  });
  await expect
    .poll(async () => JSON.stringify(await controls()))
    .toContain("Second item");
  const changed = (await controls()).find((c: any) =>
    c.label.endsWith("Second item"),
  );
  expect(changed.signature).not.toBe(before.signature);
  expect((await controls()).find((c: any) => c.label === "Home").visible).toBe(
    false,
  );
  await page.locator("dialog").evaluate((e: any) => e.close());
  await page.locator("#host").hover();
  await expect
    .poll(async () => JSON.stringify(await controls()))
    .toContain("Shadow control");
  expect(
    (await controls()).find((c: any) => c.label === "Repository").kind,
  ).toBe("focus");
  const coverage = await page.evaluate(
    () => (window as any).fixtureEngine.discovery.snapshot().coverage,
  );
  expect(coverage.some((s: any) => s.virtualized && !s.complete)).toBe(true);
});
test("browser workflow retains captions context across portalled menus and verifies the requested state", async ({
  page,
}) => {
  await load(
    page,
    '<section aria-label="Video player"><button id="settings" aria-label="Settings" aria-haspopup="menu" aria-expanded="false">Settings</button></section>',
  );
  await page.evaluate(() => {
    document.querySelector("#settings")!.addEventListener("click", () => {
      document
        .querySelector("#settings")!
        .setAttribute("aria-expanded", "true");
      const m = document.createElement("div");
      m.setAttribute("role", "menu");
      m.innerHTML =
        '<button id="captions" aria-haspopup="menu" aria-expanded="false">Subtitles/CC</button>';
      document.body.append(m);
      document.querySelector("#captions")!.addEventListener("click", () => {
        document
          .querySelector("#captions")!
          .setAttribute("aria-expanded", "true");
        const l = document.createElement("div");
        l.setAttribute("role", "menu");
        l.innerHTML =
          '<button role="menuitemradio" aria-checked="false">Spanish</button><button role="menuitemradio" aria-checked="false">French</button>';
        document.body.append(l);
        l.firstElementChild!.addEventListener("click", () =>
          l.firstElementChild!.setAttribute("aria-checked", "true"),
        );
      });
    });
    const s = (window as any).fixtureEngine;
    s.start("https://www.youtube.com");
    return s.goal("Please change captions to Spanish");
  });
  const selected = () =>
    page.evaluate(() => {
      const v = (window as any).fixtureEngine.view;
      return v.page.controls.find((c: any) => c.id === v.selectedControlId)
        ?.label;
    });
  await expect.poll(selected).toBe("Settings");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect.poll(selected).toBe("Subtitles/CC");
  await page.getByRole("button", { name: "Subtitles/CC", exact: true }).click();
  await expect.poll(selected).toBe("Spanish");
  await page
    .getByRole("menuitemradio", { name: "French", exact: true })
    .evaluate((e) => e.setAttribute("aria-checked", "true"));
  expect(
    await page.evaluate(
      () => (window as any).fixtureEngine.view.goalPlan.status,
    ),
  ).not.toBe("completed");
  await page
    .getByRole("menuitemradio", { name: "Spanish", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).fixtureEngine.view.goalPlan.status),
    )
    .toBe("completed");
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).fixtureEngine.view.request.status),
    )
    .toBe("completed");
});
test("50,000-node and 5,000-control mutation benchmark keeps priority guidance and projections bounded", async ({
  page,
}) => {
  await load(
    page,
    '<header><button aria-label="Settings" aria-haspopup="menu">Settings</button></header><main id="large"></main><footer><a href="/privacy">Privacy policy</a></footer>',
  );
  await page.evaluate(() => {
    const root = document.querySelector("#large")!,
      f = document.createDocumentFragment();
    for (let i = 0; i < 5000; i++) {
      const a = document.createElement("a");
      a.href = "/item/" + i;
      a.textContent = "Item " + i;
      f.append(a);
      for (let j = 0; j < 9; j++) f.append(document.createElement("span"));
    }
    root.append(f);
  });
  const measurements = await page.evaluate(async () => {
    const s = (window as any).fixtureEngine,
      d = new s.PageDiscovery();
    s.discovery = d;
    let latest: any;
    const start = performance.now();
    s.stop = d.observe(() => (latest = d.snapshot()));
    latest = d.snapshot();
    const initialMs = performance.now() - start;
    const priorityFound = latest.controls.some(
      (c: any) => c.label === "Settings",
    );
    await new Promise((r) => setTimeout(r, 1500));
    const warm: number[] = [],
      refresh: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      const p = d.snapshot();
      await s.core.plan({
        requestId: crypto.randomUUID(),
        documentId: "bench",
        revision: p.revision,
        text: "Find Settings",
        observation: p,
        strategy: "fastest",
        protocolVersion: 2,
        contextRevision: 0,
      });
      warm.push(performance.now() - t);
    }
    let n = 0;
    const storm = setInterval(() => {
      for (const e of [...document.querySelectorAll("#large a")].slice(
        n % 4500,
        (n % 4500) + 20,
      ))
        e.setAttribute("aria-label", "Updated item " + n++);
    }, 20);
    for (let i = 0; i < 20; i++) {
      const t = performance.now(),
        popup = document.createElement("div");
      popup.setAttribute("role", "dialog");
      popup.setAttribute("aria-label", "Current task");
      popup.innerHTML = `<button aria-label="New control ${i}">Continue</button>`;
      document.body.append(popup);
      d.setQuery("New control " + i);
      while (
        performance.now() - t < 2000 &&
        !latest?.controls.some((c: any) => c.label === "New control " + i)
      )
        await new Promise((r) => setTimeout(r, 10));
      refresh.push(performance.now() - t);
      popup.remove();
    }
    clearInterval(storm);
    const p = d.snapshot();
    s.stop();
    const p95 = (v: number[]) =>
      v.sort((a, b) => a - b)[Math.ceil(v.length * 0.95) - 1];
    return {
      initialMs,
      priorityFound,
      warmP95Ms: p95(warm),
      refreshP95Ms: p95(refresh),
      indexed: p.indexedControls,
      projected: p.controls.length,
      nodeCount: document.querySelectorAll("*").length,
      memory: (performance as any).memory?.usedJSHeapSize,
      slices: d.incremental?.slices || [],
      coverage: p.coverage,
    };
  });
  let unpackedBytes = 0;
  async function walk(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(dir + "/" + e.name);
      else unpackedBytes += (await stat(dir + "/" + e.name)).size;
    }
  }
  await walk("dist/extension");
  const passed =
    measurements.priorityFound &&
    measurements.nodeCount >= 50000 &&
    measurements.indexed <= 5000 &&
    measurements.projected <= 600 &&
    measurements.initialMs < 2000 &&
    measurements.warmP95Ms < 750 &&
    measurements.refreshP95Ms < 500 &&
    unpackedBytes < 60 * 1024 * 1024;
  await mkdir("output/multi-app", { recursive: true });
  await writeFile(
    "output/multi-app/performance.json",
    JSON.stringify(
      {
        ...(await buildProvenance()),
        ...measurements,
        unpackedBytes,
        passed,
        hardware: {
          cpu: os.cpus()[0].model,
          totalMemoryBytes: os.totalmem(),
          node: process.version,
        },
        model: "lexical foreground lane; real MiniLM measured by model corpus",
        evaluatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  expect(passed, JSON.stringify(measurements)).toBe(true);
});
