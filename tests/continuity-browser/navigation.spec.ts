import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";
import { readFile } from "node:fs/promises";
test("production extension OCR recognizes packaged assets offline and masks sensitive regions", async () => {
  const app = await openNavigatorExtension();
  try {
    await app.panel.evaluate(async () => {
      if (
        !(
          await chrome.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
          })
        ).length
      )
        await chrome.offscreen.createDocument({
          url: "offscreen.html",
          reasons: [chrome.offscreen.Reason.WORKERS],
          justification: "Offline OCR acceptance",
        });
    });
    await app.context.setOffline(true);
    for (const theme of ["light", "dark"]) {
      const image =
        "data:image/png;base64," +
        (await readFile("tests/vision-fixtures/" + theme + ".png")).toString(
          "base64",
        );
      const result = await app.panel.evaluate(
        async (image) =>
          chrome.runtime.sendMessage({
            target: "offscreen",
            type: "OCR_REQUEST",
            id: crypto.randomUUID(),
            image,
            metadata: {
              width: 640,
              height: 180,
              masks: [{ x: 0, y: 100, width: 640, height: 80 }],
            },
            stamp: {
              requestId: crypto.randomUUID(),
              journeyId: crypto.randomUUID(),
              contextRevision: 2,
              documentId: "offline",
              observationRevision: 1,
              viewportRevision: 1,
              captureId: crypto.randomUUID(),
            },
          }),
        image,
      );
      expect(result.error, JSON.stringify(result)).toBeUndefined();
      expect(
        result.value.regions.some(
          (r: any) => r.text.trim() === "Deploy website" && r.confidence >= 85,
        ),
      ).toBe(true);
      expect(
        result.value.regions.some((r: any) => /Privacy/i.test(r.text)),
      ).toBe(false);
    }
    const light =
        "data:image/png;base64," +
        (await readFile("tests/vision-fixtures/light.png")).toString("base64"),
      dark =
        "data:image/png;base64," +
        (await readFile("tests/vision-fixtures/dark.png")).toString("base64");
    const compare = async (image: string) =>
      app.panel.evaluate(
        async ({ image, referenceImage }) =>
          chrome.runtime.sendMessage({
            target: "offscreen",
            type: "OCR_REQUEST",
            id: crypto.randomUUID(),
            image,
            referenceImage,
            metadata: { width: 640, height: 180 },
            compareRegion: { x: 35, y: 40, width: 350, height: 45 },
          }),
        { image, referenceImage: light },
      );
    expect((await compare(light)).value.matches).toBe(true);
    expect((await compare(dark)).value.matches).toBe(false);
  } finally {
    await app.close();
  }
});
test("browser Back uses an observed predecessor and keeps the new destination", async () => {
  const app = await openNavigatorExtension();
  try {
    await app.context.route("**/return/home", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<html lang="en"><h1>Home</h1><a href="/return/new">New repository</a><a href="/return/settings">User settings</a></html>',
      }),
    );
    await app.context.route("**/return/settings", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<html lang="en"><h1>User settings</h1><a href="/return/security">Security</a></html>',
      }),
    );
    await app.page.goto("http://localhost:5173/return/home");
    await app.start();
    const goal = (text: string) =>
      app.panel.evaluate(async (goal) => {
        const p = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
        return chrome.runtime.sendMessage({
          type: "SET_GOAL",
          goal,
          revision: p.page.revision,
        });
      }, text);
    await goal("Open User settings");
    await app.page.getByRole("link", { name: "User settings" }).click();
    await expect
      .poll(async () => (await app.view())?.page?.path)
      .toBe("/return/settings");
    const reply = await goal("Find New repository");
    expect(reply.error).toBeUndefined();
    await expect
      .poll(async () => (await app.view())?.goalPlan?.action?.kind)
      .toBe("history-back");
    expect((await app.view()).request.status).not.toBe("completed");
    await app.page.goBack();
    const returned = await app.panel.evaluate(() =>
      chrome.runtime.sendMessage({ type: "CHECK_ROUTE_ACTION" }),
    );
    expect(returned.error, JSON.stringify(returned)).toBeUndefined();
    await expect
      .poll(async () => {
        const v = await app.view();
        return v?.page?.controls.find((c: any) => c.id === v.selectedControlId)
          ?.label;
      })
      .toBe("New repository");
  } finally {
    await app.close();
  }
});
test("new destinations park unfinished requests and resume with values retained", async () => {
  const app = await openNavigatorExtension();
  try {
    await app.context.route("**/continuity/home", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><h1>Workspace</h1><details><summary>Languages</summary><label><input type="radio" name="language" checked>English</label><label><input type="radio" name="language">Spanish</label></details><a href="/continuity/privacy">Privacy policy</a></html>',
      }),
    );
    await app.page.goto("http://localhost:5173/continuity/home");
    await app.start();
    const goal = (text: string) =>
      app.panel.evaluate(async (goal) => {
        const current = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
        return chrome.runtime.sendMessage({
          type: "SET_GOAL",
          goal,
          revision: current.page.revision,
        });
      }, text);
    const first = await goal("I want to change language to Spanish");
    expect(first.error).toBeUndefined();
    const requestId = first.view.request.id;
    const second = await goal("Help me find the privacy policy");
    expect(second.error).toBeUndefined();
    const parked = await app.panel.evaluate(() =>
      chrome.runtime.sendMessage({ type: "GET_JOURNEYS" }),
    );
    expect(parked.journeys).toHaveLength(1);
    const cdp = await app.context.newCDPSession(app.page);
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.stopAllWorkers");
    const restored = await app.panel.evaluate(
      (id) => chrome.runtime.sendMessage({ type: "RESUME_JOURNEY", id }),
      parked.journeys[0].id,
    );
    expect(restored.error).toBeUndefined();
    await expect
      .poll(async () => (await app.view())?.request?.id)
      .toBe(requestId);
    await expect
      .poll(async () => (await app.view())?.journey?.objective?.value)
      .toBe("Spanish");
    await app.page.locator("summary").click();
    await app.page.getByRole("radio", { name: "Spanish" }).check();
    try {
      await expect
        .poll(async () => (await app.view())?.request?.status, {
          timeout: 5000,
        })
        .toBe("completed");
    } catch {
      const state = await app.view();
      throw new Error(
        JSON.stringify({
          request: state.request,
          journey: state.journey,
          plan: state.goalPlan,
          controls: state.page?.controls,
          instruction: state.instruction,
        }),
      );
    }
  } finally {
    await app.close();
  }
});
